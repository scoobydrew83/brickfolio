// "Complete your Partial sets": the parts you've marked missing from a set's parts list. They set Missing % exactly
// (missing pieces ÷ pieces in the set, the same model Est. Value already uses) and export as a BrickLink Wanted List.
import { and, eq } from 'drizzle-orm';
import type { Lookup } from '../bricklink/client';
import { partKey as keyOf, toWantedListXml } from '../bricklink/wanted';
import { colors, setMissingParts, setParts, sets } from '../db/schema';
import type { DB } from '../db/types';
import { displayNo, estValue, priceGuide } from '../sets';
import { getCurrency, getSet, lookupInto, type Result } from './sets';
import { partout } from './partout';

export type MissingItem = { partNo: string; colorId: number | null; type: string; qty: number };
export type MissingRow = MissingItem & { name: string; colorName: string | null; rgb: string | null; inSet: number };
export type MissingSummary = { items: MissingRow[]; lots: number; pieces: number; setPieces: number; pct: number | null };

const NO_COLOR = -1; // stored for parts without a color, so the unique key works

/** The parts that can be marked missing: the regular parts list (no alternates or counterparts), merged by part and color. */
async function markable(db: DB, setId: number) {
  const rows = await db
    .select({ partNo: setParts.partNo, colorId: setParts.colorId, type: setParts.type, name: setParts.name, qty: setParts.qty, colorName: colors.name, rgb: colors.rgb })
    .from(setParts).leftJoin(colors, eq(colors.id, setParts.colorId))
    .where(and(eq(setParts.setId, setId), eq(setParts.alternate, false), eq(setParts.counterpart, false))).all();
  const map = new Map<string, (typeof rows)[number]>();
  for (const r of rows) {
    const k = keyOf(r.type, r.partNo, r.colorId);
    const m = map.get(k);
    if (m) m.qty += r.qty; else map.set(k, { ...r });
  }
  return map;
}

const pctOf = (pieces: number, setPieces: number) => (setPieces ? Math.round((pieces / setPieces) * 1000) / 10 : null);

/** What's marked missing for a set, with names, colors and totals. */
export async function listMissing(db: DB, setId: number): Promise<MissingSummary> {
  const parts = await markable(db, setId);
  const rows = await db.select().from(setMissingParts).where(eq(setMissingParts.setId, setId)).all();
  const items: MissingRow[] = [];
  for (const r of rows) {
    const colorId = r.colorId === NO_COLOR ? null : r.colorId;
    const p = parts.get(keyOf(r.type, r.partNo, colorId));
    if (p) items.push({ partNo: p.partNo, colorId, type: r.type, qty: r.qty, name: p.name, colorName: p.colorName, rgb: p.rgb, inSet: p.qty });
  }
  const setPieces = [...parts.values()].reduce((t, p) => t + p.qty, 0);
  const pieces = items.reduce((t, i) => t + i.qty, 0);
  return { items, lots: items.length, pieces, setPieces, pct: items.length ? pctOf(pieces, setPieces) : null };
}

/** Whether a set has parts marked missing (then Missing % is computed, not typed). */
export async function hasMissing(db: DB, setId: number): Promise<boolean> {
  return !!(await db.select({ id: setMissingParts.id }).from(setMissingParts).where(eq(setMissingParts.setId, setId)).limit(1).get());
}

/** Writes Missing % (and Partial) from the marked parts, and re-prices when the condition's price guide changes. */
async function applyMissing(db: DB, setNo: string, lookup: Lookup | null): Promise<void> {
  const s = (await getSet(db, setNo))!;
  const { lots, pct } = await listMissing(db, s.id);
  const condition = lots ? 'Partial' : s.condition;
  // Weighted by part price once nearly every part is priced (lib/service/partout.ts); by piece count until then.
  const byValue = lots ? (await partout(db, s.id, condition, await getCurrency(db))).missingPctByValue : null;
  const missingPct = lots ? (byValue ?? pct) : null;
  await db.update(sets).set({ condition, missingPct, estValue: estValue(s.avgSold, missingPct), updatedAt: new Date().toISOString() }).where(eq(sets.id, s.id));
  if (lookup && priceGuide(s.condition) !== priceGuide(condition)) await lookupInto(db, { ...s, condition, missingPct }, lookup, await getCurrency(db));
}

/**
 * Replaces a set's missing parts. Each must be on the set's regular parts list; quantities are capped at what the
 * set has, and 0 removes a part. Marking anything makes the set Partial; clearing everything clears Missing %.
 */
export async function saveMissing(db: DB, setNo: string, items: MissingItem[], lookup: Lookup | null = null): Promise<Result<{ missing: MissingSummary }>> {
  const s = await getSet(db, setNo);
  if (!s) return { ok: false, status: 404, error: `#${displayNo(setNo)} isn't in the collection.` };
  const parts = await markable(db, s.id);
  if (!parts.size) return { ok: false, status: 400, error: `#${displayNo(setNo)} has no parts list yet. Fetch it from BrickLink or import the Parts tab first.` };
  const rows = new Map<string, MissingItem>();
  for (const i of items) {
    const qty = Math.floor(Number(i.qty));
    if (!Number.isFinite(qty) || qty < 0) return { ok: false, status: 400, error: `Missing quantity for ${i.partNo} must be 0 or more.` };
    const k = keyOf(String(i.type ?? 'PART'), String(i.partNo ?? ''), i.colorId ?? null);
    const p = parts.get(k);
    if (!p) return { ok: false, status: 400, error: `${i.partNo} isn't on this set's parts list.` };
    if (qty) rows.set(k, { partNo: p.partNo, colorId: p.colorId, type: p.type, qty: Math.min(qty, p.qty) });
  }
  await db.delete(setMissingParts).where(eq(setMissingParts.setId, s.id));
  if (rows.size) {
    await db.insert(setMissingParts).values([...rows.values()].map((r) => ({ setId: s.id, partNo: r.partNo, colorId: r.colorId ?? NO_COLOR, type: r.type, qty: r.qty })));
  }
  await applyMissing(db, s.setNo, lookup);
  return { ok: true, missing: await listMissing(db, s.id) };
}

/** After a parts list is replaced: drops marks for parts no longer on it, caps quantities, and updates Missing %. */
export async function reconcileMissing(db: DB, setId: number): Promise<void> {
  const rows = await db.select().from(setMissingParts).where(eq(setMissingParts.setId, setId)).all();
  if (!rows.length) return;
  const parts = await markable(db, setId);
  for (const r of rows) {
    const p = parts.get(keyOf(r.type, r.partNo, r.colorId === NO_COLOR ? null : r.colorId));
    if (!p) await db.delete(setMissingParts).where(eq(setMissingParts.id, r.id));
    else if (r.qty > p.qty) await db.update(setMissingParts).set({ qty: p.qty }).where(eq(setMissingParts.id, r.id));
  }
  const [{ setNo }] = await db.select({ setNo: sets.setNo }).from(sets).where(eq(sets.id, setId)).all();
  await applyMissing(db, setNo, null);
}

/** The missing parts as a BrickLink Wanted List, or null when the set isn't in the collection. */
export async function missingWantedList(db: DB, setNo: string): Promise<{ xml: string; items: number; name: string } | null> {
  const s = await getSet(db, setNo);
  if (!s) return null;
  const { items } = await listMissing(db, s.id);
  return { xml: toWantedListXml(items, `Missing parts for ${s.name} (${displayNo(s.setNo)})`), items: items.length, name: s.name };
}

/** Recomputes Missing % for every set with marked parts, e.g. after part prices were refreshed. */
export async function reapplyMissing(db: DB): Promise<void> {
  const ids = await db.selectDistinct({ setId: setMissingParts.setId }).from(setMissingParts).all();
  for (const { setId } of ids) {
    const row = await db.select({ setNo: sets.setNo }).from(sets).where(eq(sets.id, setId)).get();
    if (row) await applyMissing(db, row.setNo, null);
  }
}
