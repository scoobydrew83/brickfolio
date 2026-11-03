// Each set's parts list (the sheet's Parts tab) and BrickLink color names.
import { and, asc, eq, like, or, sql } from 'drizzle-orm';
import { partCounts, type Color, type SetPart } from '../bricklink/client';
import { insertChunked } from '../db/chunk';
import { colors, setParts, sets } from '../db/schema';
import type { DB } from '../db/types';
import { reconcileMissing } from './missing';

export type { SetPart } from '../bricklink/client';
export type PartRow = SetPart & { colorName: string | null; rgb: string | null };
export type PartSearchRow = PartRow & { setNo: string; setName: string };

export async function hasParts(db: DB, setId: number): Promise<boolean> {
  return !!(await db.select({ id: setParts.id }).from(setParts).where(eq(setParts.setId, setId)).limit(1).get());
}

/** Replaces a set's parts list and updates its piece and lot counts from it. */
export async function replaceParts(db: DB, setId: number, parts: SetPart[]): Promise<void> {
  await db.delete(setParts).where(eq(setParts.setId, setId));
  await insertChunked(parts.map((p) => ({ setId, ...p })), (c) => db.insert(setParts).values(c));
  await db.update(sets).set(partCounts(parts)).where(eq(sets.id, setId));
  await reconcileMissing(db, setId); // keep marked missing parts in step with the new list
}

/** Fills the colors table from BrickLink the first time it's needed (one API call). Errors are ignored: names are optional. */
export async function ensureColors(db: DB, fetchColors: (() => Promise<Color[]>) | null): Promise<void> {
  if (!fetchColors || (await db.select({ id: colors.id }).from(colors).limit(1).get())) return;
  try {
    const list = await fetchColors();
    await insertChunked(list, (c) => db.insert(colors).values(c).onConflictDoNothing());
  } catch (e) {
    console.error('Could not load BrickLink colors:', e);
  }
}

const partColumns = {
  matchNo: setParts.matchNo, partNo: setParts.partNo, name: setParts.name, type: setParts.type, colorId: setParts.colorId,
  qty: setParts.qty, extra: setParts.extra, alternate: setParts.alternate, counterpart: setParts.counterpart,
  colorName: colors.name, rgb: colors.rgb,
};

/** A set's parts with color names: regular parts first, then alternates grouped by what they replace. */
export async function listSetParts(db: DB, setId: number): Promise<PartRow[]> {
  return db.select(partColumns).from(setParts).leftJoin(colors, eq(colors.id, setParts.colorId))
    .where(eq(setParts.setId, setId))
    .orderBy(asc(setParts.alternate), asc(setParts.matchNo), asc(setParts.type), asc(setParts.partNo)).all();
}

export type PartSearch = { q?: string; type?: string; limit?: number; offset?: number };

/** Searches parts across every set, like filtering the Parts tab. Matches part #, name or color. */
export async function searchParts(db: DB, f: PartSearch): Promise<{ parts: PartSearchRow[]; total: number }> {
  const q = f.q?.trim();
  const where = and(
    f.type ? eq(setParts.type, f.type) : undefined,
    q ? or(like(setParts.partNo, `%${q}%`), like(setParts.name, `%${q}%`), like(colors.name, `%${q}%`), like(sets.setNo, `%${q}%`)) : undefined,
  );
  const [{ n }] = await db.select({ n: sql<number>`count(*)` }).from(setParts)
    .innerJoin(sets, eq(sets.id, setParts.setId)).leftJoin(colors, eq(colors.id, setParts.colorId)).where(where).all();
  const parts = await db.select({ ...partColumns, setNo: sets.setNo, setName: sets.name }).from(setParts)
    .innerJoin(sets, eq(sets.id, setParts.setId)).leftJoin(colors, eq(colors.id, setParts.colorId))
    .where(where)
    .orderBy(asc(setParts.partNo), asc(setParts.colorId), asc(sets.setNo))
    .limit(Math.min(Math.max(f.limit ?? 200, 1), 1000)).offset(Math.max(f.offset ?? 0, 0)).all();
  return { parts, total: n };
}

/** Part types present, for the filter. */
export async function partTypes(db: DB): Promise<string[]> {
  return (await db.selectDistinct({ type: setParts.type }).from(setParts).orderBy(asc(setParts.type)).all()).map((r) => r.type);
}
