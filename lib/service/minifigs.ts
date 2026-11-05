// Minifigures you own as items of their own, priced from BrickLink sold history like sets (2 calls each),
// plus the Collectible Minifigures checklist from Rebrickable's catalog.
import { and, asc, eq, gt, inArray, isNotNull, lte, sql } from 'drizzle-orm';
import type { MinifigLookup } from '../bricklink/client';
import type { FigSource } from '../rebrickable/client';
import type { DB } from '../db/types';
import { cmfFigs, minifigs, themes } from '../db/schema';
import { recordPrice } from './prices';
import { getCurrency, today, type Result } from './sets';
import { FIG_NO } from '../minifigs';

export type MinifigRow = typeof minifigs.$inferSelect & { estValue: number | null };
export type MinifigInput = {
  figNo?: string | null; rbFigNo?: string | null; name?: string; qty?: number; condition?: 'New' | 'Used';
  location?: string | null; notes?: string | null; imageUrl?: string | null;
};

const nowIso = () => new Date().toISOString();
const RECHECK_DAYS = 30;

const RB_FIG_NO = /^fig-\d{6}$/i;

/** Validates form or JSON input. `partial` = edit (the key is the existing figure). */
export function parseFigInput(raw: unknown, locations: readonly string[], partial = false): { ok: true; value: MinifigInput } | { ok: false; error: string } {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const str = (k: string) => (r[k] === undefined || r[k] === null ? undefined : String(r[k]).trim());
  const value: MinifigInput = {};
  const fig = str('figNo');
  if (fig) {
    if (!FIG_NO.test(fig)) return { ok: false, error: 'BrickLink minifig number should look like sw0001 or col25-3.' };
    value.figNo = fig.toLowerCase();
  } else if (fig === '' && partial) value.figNo = null;
  const rb = str('rbFigNo');
  if (rb) {
    if (!RB_FIG_NO.test(rb)) return { ok: false, error: 'Rebrickable number should look like fig-000123.' };
    value.rbFigNo = rb.toLowerCase();
  }
  if (!partial && !value.figNo && !value.rbFigNo) return { ok: false, error: 'Enter the BrickLink minifig number, e.g. sw0001.' };
  const name = str('name');
  if (name !== undefined) {
    if (name.length > 120) return { ok: false, error: 'Name is too long (120 characters at most).' };
    if (name) value.name = name;
  }
  const cond = str('condition');
  if (cond) {
    if (cond !== 'New' && cond !== 'Used') return { ok: false, error: 'Condition must be New or Used.' };
    value.condition = cond;
  }
  const loc = str('location');
  if (loc !== undefined) {
    if (loc && !locations.includes(loc)) return { ok: false, error: `Location must be one of: ${locations.join(', ')}` };
    value.location = loc || null;
  }
  const qty = str('qty');
  if (qty) {
    const q = Number(qty);
    if (!Number.isInteger(q) || q < 1 || q > 999) return { ok: false, error: 'Qty must be a whole number 1–999.' };
    value.qty = q;
  }
  const notes = str('notes');
  if (notes !== undefined) {
    if (notes.length > 2000) return { ok: false, error: 'Notes are too long (2,000 characters at most).' };
    value.notes = notes || null;
  }
  const img = str('imageUrl');
  if (img && /^https:\/\//.test(img)) value.imageUrl = img;
  return { ok: true, value };
}

const withValue = (m: typeof minifigs.$inferSelect): MinifigRow => ({ ...m, estValue: m.avgSold });

export async function listMinifigs(db: DB): Promise<MinifigRow[]> {
  return (await db.select().from(minifigs).orderBy(asc(minifigs.name), asc(minifigs.id)).all()).map(withValue);
}

/** One figure by its BrickLink or Rebrickable number. */
export async function getMinifig(db: DB, key: string): Promise<MinifigRow | undefined> {
  const k = key.trim().toLowerCase();
  const m = await db.select().from(minifigs).where(RB_FIG_NO.test(k) ? eq(minifigs.rbFigNo, k) : eq(minifigs.figNo, k)).get();
  return m && withValue(m);
}

export const figKey = (m: Pick<MinifigRow, 'figNo' | 'rbFigNo'>) => (m.figNo ?? m.rbFigNo)!;

/** Looks up one figure on BrickLink and stores its name, photo and sold prices (or the error). */
export async function lookupFig(db: DB, m: Pick<MinifigRow, 'id' | 'figNo' | 'condition' | 'name'>, lookup: MinifigLookup, currency: string): Promise<string | null> {
  if (!m.figNo) return null; // Rebrickable-only figures can't be priced
  const guide = m.condition === 'New' ? 'N' : 'U';
  try {
    const r = await lookup(m.figNo, guide, currency);
    await db.update(minifigs).set({
      name: m.name && m.name !== m.figNo ? m.name : r.blName, blName: r.blName, year: r.year, categoryId: r.categoryId, imageUrl: r.imageUrl,
      avgSold: r.avgSold, minSold: r.minSold, maxSold: r.maxSold, qtySold: r.qtySold, blError: null, lastUpdated: nowIso(), updatedAt: nowIso(),
    }).where(eq(minifigs.id, m.id));
    await recordPrice(db, {
      itemKind: 'minifig', itemId: m.figNo, source: 'bricklink', type: 'sold_avg', condition: guide, currency,
      amount: r.avgSold, low: r.minSold, high: r.maxSold, sampleSize: r.qtySold, observedOn: today(),
    });
    return null;
  } catch (e) {
    const error = (e instanceof Error ? e.message : String(e)).slice(0, 300);
    await db.update(minifigs).set({ blError: error, lastUpdated: nowIso() }).where(eq(minifigs.id, m.id));
    return error;
  }
}

/**
 * Adds a figure, or one more copy when it's already there (`qty` more with `merge`). With a lookup and a
 * BrickLink number it's priced right away; pass `lookup: null` to leave that to the next sync.
 */
export async function addMinifig(db: DB, input: MinifigInput, opts: { lookup: MinifigLookup | null; merge?: boolean }): Promise<Result<{ minifig: MinifigRow; merged: boolean }>> {
  const key = input.figNo ?? input.rbFigNo;
  if (!key) return { ok: false, status: 400, error: 'A minifig number is required.' };
  let have = await getMinifig(db, key);
  // Ticked off the checklist earlier without a BrickLink number: attach this one.
  if (!have && input.figNo && input.rbFigNo) have = await getMinifig(db, input.rbFigNo);
  if (have) {
    if (!opts.merge) return { ok: false, status: 409, error: `You already have ${have.qty} of ${have.name}.`, existing: { name: have.name, qty: have.qty } };
    await db.update(minifigs).set({
      qty: sql`${minifigs.qty} + ${input.qty ?? 1}`, figNo: have.figNo ?? input.figNo ?? null, rbFigNo: have.rbFigNo ?? input.rbFigNo ?? null, updatedAt: nowIso(),
    }).where(eq(minifigs.id, have.id));
    return { ok: true, minifig: (await getMinifig(db, key))!, merged: true };
  }
  const [row] = await db.insert(minifigs).values({
    figNo: input.figNo ?? null, rbFigNo: input.rbFigNo ?? null, name: input.name ?? key, qty: input.qty ?? 1,
    condition: input.condition ?? 'Used', location: input.location ?? null, notes: input.notes ?? null, imageUrl: input.imageUrl ?? null,
  }).returning().all();
  if (opts.lookup && row.figNo) await lookupFig(db, { ...row, name: input.name ?? '' }, opts.lookup, await getCurrency(db));
  return { ok: true, minifig: (await getMinifig(db, key))!, merged: false };
}

/** Changes the given fields. A condition change re-prices the figure. */
export async function editMinifig(db: DB, key: string, input: MinifigInput, lookup: MinifigLookup | null): Promise<Result<{ minifig: MinifigRow }>> {
  const before = await getMinifig(db, key);
  if (!before) return { ok: false, status: 404, error: `${key} isn't in your minifigures.` };
  const { rbFigNo: _rb, imageUrl: _img, ...fields } = input;
  if (fields.figNo === null && !before.rbFigNo) delete fields.figNo; // keep at least one number
  try {
    await db.update(minifigs).set({ ...fields, updatedAt: nowIso() }).where(eq(minifigs.id, before.id));
  } catch {
    return { ok: false, status: 409, error: `${fields.figNo} is already in your minifigures.` };
  }
  const after = { ...before, ...fields };
  if (lookup && after.figNo && (after.condition !== before.condition || after.figNo !== before.figNo)) await lookupFig(db, { ...after, name: fields.name ?? before.name }, lookup, await getCurrency(db));
  return { ok: true, minifig: (await getMinifig(db, figKey(after)))! };
}

/** Removes one copy: lowers qty when there are several, deletes the figure on the last one. */
export async function removeMinifig(db: DB, key: string): Promise<Result<{ remaining: number }>> {
  const m = await getMinifig(db, key);
  if (!m) return { ok: false, status: 404, error: `${key} isn't in your minifigures.` };
  const lowered = await db.update(minifigs).set({ qty: sql`${minifigs.qty} - 1`, updatedAt: nowIso() }).where(and(eq(minifigs.id, m.id), gt(minifigs.qty, 1))).returning({ qty: minifigs.qty }).all();
  if (lowered.length) return { ok: true, remaining: lowered[0].qty };
  await db.delete(minifigs).where(and(eq(minifigs.id, m.id), lte(minifigs.qty, 1)));
  return { ok: true, remaining: 0 };
}

/** Re-prices every figure with a BrickLink number. Returns how many lookups failed. */
export async function syncMinifigs(db: DB, lookup: MinifigLookup, currency?: string): Promise<number> {
  const cur = currency ?? (await getCurrency(db));
  const all = await db.select().from(minifigs).where(isNotNull(minifigs.figNo)).all();
  let errors = 0;
  for (const m of all) if (await lookupFig(db, m, lookup, cur)) errors++;
  return errors;
}

export { FIG_NO, minifigTotals } from '../minifigs';

// ---- Collectible Minifigures checklist ----

export type CmfSeries = { themeId: number; name: string };
export type CmfFig = { rbFigNo: string; name: string; imageUrl: string | null; owned: number };

/** Series are the subthemes of Rebrickable's "Collectible Minifigures" theme (from the theme sync), newest first. */
export async function cmfSeries(db: DB): Promise<CmfSeries[]> {
  const parents = await db.select({ id: themes.id }).from(themes).where(sql`lower(${themes.name}) = 'collectible minifigures'`).all();
  if (!parents.length) return [];
  const rows = await db.select().from(themes).where(inArray(themes.parentId, parents.map((p) => p.id))).all();
  return rows.map((t) => ({ themeId: t.id, name: t.name })).sort((a, b) => b.themeId - a.themeId);
}

/**
 * The figures in one series, with how many of each you own (matched on the Rebrickable number). Asks
 * Rebrickable once and caches the list for 30 days.
 */
export async function cmfChecklist(db: DB, themeId: number, src: FigSource | null): Promise<Result<{ figs: CmfFig[]; owned: number; total: number }>> {
  const stale = new Date(Date.now() - RECHECK_DAYS * 86_400_000).toISOString();
  let cached = await db.select().from(cmfFigs).where(eq(cmfFigs.themeId, themeId)).all();
  if ((!cached.length || cached.some((c) => c.fetchedAt < stale)) && src) {
    try {
      const figs = await src.themeFigs(themeId);
      const at = nowIso();
      await db.delete(cmfFigs).where(eq(cmfFigs.themeId, themeId));
      for (const f of figs) await db.insert(cmfFigs).values({ rbFigNo: f.figNo.toLowerCase(), themeId, name: f.name, numParts: f.numParts, imageUrl: f.imageUrl, fetchedAt: at }).onConflictDoNothing();
      cached = await db.select().from(cmfFigs).where(eq(cmfFigs.themeId, themeId)).all();
    } catch (e) {
      if (!cached.length) return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }
  if (!cached.length && !src) return { ok: false, status: 400, error: 'Set REBRICKABLE_API_KEY to load the checklist.' };
  const mine = cached.length ? await db.select({ rb: minifigs.rbFigNo, qty: minifigs.qty }).from(minifigs).where(inArray(minifigs.rbFigNo, cached.map((c) => c.rbFigNo))).all() : [];
  const qty = new Map(mine.map((m) => [m.rb!, m.qty]));
  const figs = cached.map((c) => ({ rbFigNo: c.rbFigNo, name: c.name, imageUrl: c.imageUrl, owned: qty.get(c.rbFigNo) ?? 0 })).sort((a, b) => a.name.localeCompare(b.name));
  return { ok: true, figs, owned: figs.filter((f) => f.owned).length, total: figs.length };
}
