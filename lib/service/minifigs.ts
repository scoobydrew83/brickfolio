// Minifigures you own as items of their own, priced from BrickLink sold history like sets (2 calls each),
// plus the Collectible Minifigures checklist from Rebrickable's catalog.
import { collectionExists, scopeIds, targetCollection, type ReadScope } from './collections';
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
  /** The collection (#49). A figure has one row per collection it's in. */
  collectionId?: number;
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
  const col = str('collectionId') ?? str('collection');
  if (col) {
    if (!/^[1-9]\d{0,8}$/.test(col)) return { ok: false, error: 'Collection must be a collection id.' };
    value.collectionId = Number(col);
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

/** Every minifigure row, or one collection's (#49). A figure in two collections is two rows. */
export async function listMinifigs(db: DB, opts: { collectionId?: ReadScope } = {}): Promise<MinifigRow[]> {
  const ids = scopeIds(opts.collectionId ?? 'all');
  if (ids && !ids.length) return [];
  const q = db.select().from(minifigs);
  return (await (ids ? q.where(inArray(minifigs.collectionId, ids)) : q).orderBy(asc(minifigs.name), asc(minifigs.id)).all()).map(withValue);
}

const byKey = (k: string) => (RB_FIG_NO.test(k) ? eq(minifigs.rbFigNo, k) : eq(minifigs.figNo, k));

/** Every row of one figure (one per collection it's in), oldest first. */
export async function figRows(db: DB, key: string): Promise<MinifigRow[]> {
  return (await db.select().from(minifigs).where(byKey(key.trim().toLowerCase())).orderBy(asc(minifigs.id)).all()).map(withValue);
}

/**
 * One figure by its BrickLink or Rebrickable number: its row in `collectionId`, or (without one) its first row. Use
 * figRow() where a figure in several collections must be told apart.
 */
export async function getMinifig(db: DB, key: string, collectionId?: number): Promise<MinifigRow | undefined> {
  const k = key.trim().toLowerCase();
  const m = await db.select().from(minifigs).where(collectionId === undefined ? byKey(k) : and(byKey(k), eq(minifigs.collectionId, collectionId))).orderBy(asc(minifigs.id)).get();
  return m && withValue(m);
}

/** The row to change: the one in `collectionId`, or the only one. A figure in several collections needs the collection. */
async function figRow(db: DB, key: string, collectionId: number | undefined): Promise<Result<{ row: MinifigRow }>> {
  if (collectionId !== undefined) {
    const row = await getMinifig(db, key, collectionId);
    return row ? { ok: true, row } : { ok: false, status: 404, error: `${key} isn't in that collection.` };
  }
  const rows = await figRows(db, key);
  if (!rows.length) return { ok: false, status: 404, error: `${key} isn't in your minifigures.` };
  if (rows.length > 1) return { ok: false, status: 409, error: `${key} is in ${rows.length} collections. Say which one (collection).` };
  return { ok: true, row: rows[0] };
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
export async function addMinifig(db: DB, input: MinifigInput, opts: { lookup: MinifigLookup | null; merge?: boolean; collectionId?: number | 'all' }): Promise<Result<{ minifig: MinifigRow; merged: boolean }>> {
  const key = input.figNo ?? input.rbFigNo;
  if (!key) return { ok: false, status: 400, error: 'A minifig number is required.' };
  const col = await targetCollection(db, input.collectionId ?? opts.collectionId);
  if (!col.ok) return col;
  let have = await getMinifig(db, key, col.id);
  // Ticked off the checklist earlier without a BrickLink number: attach this one.
  if (!have && input.figNo && input.rbFigNo) have = await getMinifig(db, input.rbFigNo, col.id);
  if (have) {
    if (!opts.merge) return { ok: false, status: 409, error: `You already have ${have.qty} of ${have.name}.`, existing: { name: have.name, qty: have.qty } };
    await db.update(minifigs).set({
      qty: sql`${minifigs.qty} + ${input.qty ?? 1}`, figNo: have.figNo ?? input.figNo ?? null, rbFigNo: have.rbFigNo ?? input.rbFigNo ?? null, updatedAt: nowIso(),
    }).where(eq(minifigs.id, have.id));
    return { ok: true, minifig: (await getMinifig(db, key, col.id))!, merged: true };
  }
  // In another collection already: copy what BrickLink said about it, so it needn't be looked up again.
  const twin = (await figRows(db, key))[0];
  const known = twin ? { blName: twin.blName, year: twin.year, categoryId: twin.categoryId, imageUrl: input.imageUrl ?? twin.imageUrl, lastUpdated: twin.lastUpdated, ...(twin.condition === (input.condition ?? 'Used') ? { avgSold: twin.avgSold, minSold: twin.minSold, maxSold: twin.maxSold, qtySold: twin.qtySold } : {}) } : {};
  const [row] = await db.insert(minifigs).values({
    figNo: input.figNo ?? twin?.figNo ?? null, rbFigNo: input.rbFigNo ?? twin?.rbFigNo ?? null, name: input.name ?? twin?.blName ?? twin?.name ?? key, qty: input.qty ?? 1,
    condition: input.condition ?? 'Used', location: input.location ?? null, notes: input.notes ?? null, imageUrl: input.imageUrl ?? null,
    collectionId: col.id, ...known,
  }).returning().all();
  const priced = twin && twin.condition === row.condition && twin.avgSold != null;
  if (opts.lookup && row.figNo && !priced) await lookupFig(db, { ...row, name: input.name ?? '' }, opts.lookup, await getCurrency(db));
  return { ok: true, minifig: (await getMinifig(db, key, col.id))!, merged: false };
}

/**
 * Changes the given fields of the figure's row in `collectionId` (needed when it's in several). A condition change
 * re-prices it. A new `input.collectionId` moves it; if the figure is already in that collection, the two rows merge
 * (quantities add up; the destination's other fields win).
 */
export async function editMinifig(db: DB, key: string, input: MinifigInput, lookup: MinifigLookup | null, collectionId?: number): Promise<Result<{ minifig: MinifigRow }>> {
  const found = await figRow(db, key, collectionId);
  if (!found.ok) return found;
  const before = found.row;
  const { rbFigNo: _rb, imageUrl: _img, collectionId: to, ...fields } = input;
  if (to !== undefined && to !== before.collectionId) {
    if (!(await collectionExists(db, to))) return { ok: false, status: 400, error: `Collection ${to} doesn't exist.` };
    const there = await getMinifig(db, figKey(before), to);
    if (there) {
      await db.update(minifigs).set({ qty: sql`${minifigs.qty} + ${before.qty}`, updatedAt: nowIso() }).where(eq(minifigs.id, there.id));
      await db.delete(minifigs).where(eq(minifigs.id, before.id));
      return { ok: true, minifig: (await getMinifig(db, figKey(there), to))! };
    }
    (fields as typeof fields & { collectionId?: number }).collectionId = to;
  }
  if (fields.figNo === null && !before.rbFigNo) delete fields.figNo; // keep at least one number
  try {
    await db.update(minifigs).set({ ...fields, updatedAt: nowIso() }).where(eq(minifigs.id, before.id));
  } catch {
    return { ok: false, status: 409, error: `${fields.figNo} is already in that collection's minifigures.` };
  }
  const after = { ...before, ...fields };
  if (lookup && after.figNo && (after.condition !== before.condition || after.figNo !== before.figNo)) await lookupFig(db, { ...after, name: fields.name ?? before.name }, lookup, await getCurrency(db));
  return { ok: true, minifig: (await getMinifig(db, figKey(after), to ?? before.collectionId))! };
}

/** Removes one copy from the figure's row in `collectionId`: lowers qty when there are several, deletes the row on the last one. */
export async function removeMinifig(db: DB, key: string, collectionId?: number): Promise<Result<{ remaining: number }>> {
  const found = await figRow(db, key, collectionId);
  if (!found.ok) return found;
  const m = found.row;
  const lowered = await db.update(minifigs).set({ qty: sql`${minifigs.qty} - 1`, updatedAt: nowIso() }).where(and(eq(minifigs.id, m.id), gt(minifigs.qty, 1))).returning({ qty: minifigs.qty }).all();
  if (lowered.length) return { ok: true, remaining: lowered[0].qty };
  await db.delete(minifigs).where(and(eq(minifigs.id, m.id), lte(minifigs.qty, 1)));
  return { ok: true, remaining: 0 };
}

/**
 * Re-prices every figure with a BrickLink number. A figure in several collections in the same condition is looked
 * up once and the answer copied to its other rows. Returns how many lookups failed.
 */
export async function syncMinifigs(db: DB, lookup: MinifigLookup, currency?: string): Promise<number> {
  const cur = currency ?? (await getCurrency(db));
  const all = await db.select().from(minifigs).where(isNotNull(minifigs.figNo)).orderBy(asc(minifigs.id)).all();
  const done = new Map<string, number>(); // figNo|condition → the row that was looked up
  let errors = 0;
  for (const m of all) {
    const k = `${m.figNo}|${m.condition}`;
    const first = done.get(k);
    if (first !== undefined) {
      const src = (await db.select().from(minifigs).where(eq(minifigs.id, first)).get())!;
      await db.update(minifigs).set({ blName: src.blName, year: src.year, categoryId: src.categoryId, imageUrl: src.imageUrl, avgSold: src.avgSold, minSold: src.minSold, maxSold: src.maxSold, qtySold: src.qtySold, blError: src.blError, lastUpdated: src.lastUpdated }).where(eq(minifigs.id, m.id));
      continue;
    }
    done.set(k, m.id);
    if (await lookupFig(db, m, lookup, cur)) errors++;
  }
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
/** `scope`: the collections whose figures count as owned (#49, #50). */
export async function cmfChecklist(db: DB, themeId: number, src: FigSource | null, scope: ReadScope = 'all'): Promise<Result<{ figs: CmfFig[]; owned: number; total: number }>> {
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
  const ids = scopeIds(scope);
  const mine = cached.length && (!ids || ids.length) ? await db.select({ rb: minifigs.rbFigNo, qty: minifigs.qty }).from(minifigs).where(and(inArray(minifigs.rbFigNo, cached.map((c) => c.rbFigNo)), ids ? inArray(minifigs.collectionId, ids) : undefined)).all() : [];
  const qty = new Map<string, number>();
  for (const m of mine) qty.set(m.rb!, (qty.get(m.rb!) ?? 0) + m.qty); // a figure can be in several collections
  const figs = cached.map((c) => ({ rbFigNo: c.rbFigNo, name: c.name, imageUrl: c.imageUrl, owned: qty.get(c.rbFigNo) ?? 0 })).sort((a, b) => a.name.localeCompare(b.name));
  return { ok: true, figs, owned: figs.filter((f) => f.owned).length, total: figs.length };
}
