// "Complete your Partial sets": the parts you've marked missing from a set's parts list. They set Missing % exactly
// (missing pieces ÷ pieces in the set, the same model Est. Value already uses) and export as a BrickLink Wanted List.
import { and, desc, eq } from 'drizzle-orm';
import type { Lookup } from '../bricklink/client';
import { partKey as keyOf, toWantedListXml } from '../bricklink/wanted';
import { colors, priceSnapshots, setCopies, setMissingParts, setParts, sets } from '../db/schema';
import type { DB } from '../db/types';
import { displayNo, setGuide, type CopyRow, type SetRow } from '../sets';
import { getCurrency, getSet, lookupInto, type Result } from './sets';
import { partout } from './partout';
import { repriceCopies } from './copies';

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

/** What's marked missing from one copy of a set, with names, colors and totals. */
export async function listMissing(db: DB, setId: number, copyId: number | null): Promise<MissingSummary> {
  const parts = await markable(db, setId);
  const rows = copyId == null ? [] : await db.select().from(setMissingParts).where(and(eq(setMissingParts.setId, setId), eq(setMissingParts.copyId, copyId))).all();
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

/** Whether a set (or one of its copies) has parts marked missing (then Missing % is computed, not typed). */
export async function hasMissing(db: DB, setId: number, copyId?: number): Promise<boolean> {
  const where = copyId === undefined ? eq(setMissingParts.setId, setId) : and(eq(setMissingParts.setId, setId), eq(setMissingParts.copyId, copyId));
  return !!(await db.select({ id: setMissingParts.id }).from(setMissingParts).where(where).limit(1).get());
}

/**
 * The copy the missing parts belong to. Asked for by id, or else the only copy, the only Partial copy (or the only
 * one with marked parts). For reading, the first copy otherwise; for writing that's ambiguous, so null.
 */
export function pickCopy(s: Pick<SetRow, 'copies'>, copyId: number | null | undefined, forWrite: boolean): CopyRow | null {
  if (copyId != null) return s.copies.find((c) => c.id === copyId) ?? null;
  if (s.copies.length === 1) return s.copies[0];
  const marked = s.copies.filter((c) => c.missingMarked);
  if (marked.length === 1) return marked[0];
  const partial = s.copies.filter((c) => c.condition === 'Partial');
  if (partial.length === 1) return partial[0];
  return forWrite ? null : (marked[0] ?? partial[0] ?? s.copies[0] ?? null);
}

/** Writes a copy's Missing % (and Partial) from its marked parts, and re-prices it. */
/** `hadMarks`: the copy had marked parts before, so clearing them clears Missing % (a typed % is kept otherwise). */
async function applyMissing(db: DB, setNo: string, copyId: number, lookup: Lookup | null, hadMarks = true): Promise<void> {
  const s = (await getSet(db, setNo))!;
  const c = s.copies.find((x) => x.id === copyId);
  if (!c) return;
  const { lots, pct } = await listMissing(db, s.id, c.id);
  const condition = lots ? 'Partial' : c.condition;
  const status = lots && c.status === 'sealed' ? 'built' : c.status; // a copy with parts missing isn't sealed
  // Weighted by part price once nearly every part is priced (lib/service/partout.ts); by piece count until then.
  const byValue = lots ? (await partout(db, s.id, condition, await getCurrency(db), c.id)).missingPctByValue : null;
  const missingPct = lots ? (byValue ?? pct) : (hadMarks ? null : c.missingPct);
  await db.update(setCopies).set({ condition, status, missingPct, updatedAt: new Date().toISOString() }).where(eq(setCopies.id, c.id));
  const copies = s.copies.map((x) => (x.id === c.id ? { ...x, condition, status } : x));
  const latest = await db.select({ guide: priceSnapshots.guide }).from(priceSnapshots).where(eq(priceSnapshots.setId, s.id)).orderBy(desc(priceSnapshots.date)).limit(1).get();
  if (lookup && latest && latest.guide !== setGuide(copies)) await lookupInto(db, { ...s, copies }, lookup, await getCurrency(db));
  else await repriceCopies(db, s.id);
}

/**
 * Replaces one copy's missing parts. Each must be on the set's regular parts list; quantities are capped at what the
 * set has, and 0 removes a part. Marking anything makes the copy Partial; clearing everything clears Missing %.
 */
export async function saveMissing(db: DB, setNo: string, copyId: number | null, items: MissingItem[], lookup: Lookup | null = null): Promise<Result<{ missing: MissingSummary; copyId: number }>> {
  const s = await getSet(db, setNo);
  if (!s) return { ok: false, status: 404, error: `#${displayNo(setNo)} isn't in the collection.` };
  const copy = pickCopy(s, copyId, true);
  if (!copy) return { ok: false, status: 400, error: copyId == null ? `#${displayNo(setNo)} has ${s.copies.length} copies. Say which one (copy).` : `Copy ${copyId} isn't a copy of #${displayNo(setNo)}.` };
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
  await db.delete(setMissingParts).where(eq(setMissingParts.copyId, copy.id));
  if (rows.size) {
    await db.insert(setMissingParts).values([...rows.values()].map((r) => ({ setId: s.id, copyId: copy.id, partNo: r.partNo, colorId: r.colorId ?? NO_COLOR, type: r.type, qty: r.qty })));
  }
  await applyMissing(db, s.setNo, copy.id, lookup, !!copy.missingMarked);
  return { ok: true, missing: await listMissing(db, s.id, copy.id), copyId: copy.id };
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
  for (const copyId of new Set(rows.map((r) => r.copyId).filter((v): v is number => v != null))) await applyMissing(db, setNo, copyId, null);
}

/** A copy's missing parts as a BrickLink Wanted List, or null when the set (or copy) isn't in the collection. */
export async function missingWantedList(db: DB, setNo: string, copyId: number | null = null): Promise<{ xml: string; items: number; name: string } | null> {
  const s = await getSet(db, setNo);
  if (!s) return null;
  const copy = pickCopy(s, copyId, false);
  if (!copy) return null;
  const { items } = await listMissing(db, s.id, copy.id);
  return { xml: toWantedListXml(items, `Missing parts for ${s.name} (${displayNo(s.setNo)})`), items: items.length, name: s.name };
}

/** Recomputes Missing % for every copy with marked parts, e.g. after part prices were refreshed. */
export async function reapplyMissing(db: DB): Promise<void> {
  const ids = await db.selectDistinct({ copyId: setMissingParts.copyId, setNo: sets.setNo }).from(setMissingParts).innerJoin(sets, eq(sets.id, setMissingParts.setId)).all();
  for (const { copyId, setNo } of ids) if (copyId != null) await applyMissing(db, setNo, copyId, null);
}
