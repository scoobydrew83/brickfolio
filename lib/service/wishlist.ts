// The wishlist: sets you want and the price you'd pay. Prices are BrickLink average sold prices for the
// condition you want, refreshed by the daily sync (2 BrickLink calls per item).
import { asc, eq } from 'drizzle-orm';
import type { Lookup } from '../bricklink/client';
import type { DB } from '../db/types';
import { wishlist } from '../db/schema';
import { setNo as fullSetNo } from '../sets';
import { addSet, getCurrency, type Result } from './sets';

export type WishRow = typeof wishlist.$inferSelect;
export type WishInput = { setNo: string; name?: string | null; condition?: 'New' | 'Used'; target?: number | null; notes?: string | null };

const nowIso = () => new Date().toISOString();

/** Validates add/edit input. With `partial`, only the set number is required. */
export function parseWishInput(raw: unknown, partial = false): { ok: true; value: WishInput } | { ok: false; error: string } {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const no = String(r.setNo ?? '').trim();
  if (!/^\d{3,7}(-\d{1,2})?$/.test(no)) return { ok: false, error: 'Set number should look like 10316 or 10316-1.' };
  const value: WishInput = { setNo: fullSetNo(no) };
  if (r.name !== undefined) {
    const name = String(r.name ?? '').trim();
    if (name.length > 120) return { ok: false, error: 'Name is too long (120 characters at most).' };
    value.name = name || null;
  }
  if (r.condition !== undefined && r.condition !== '') {
    if (r.condition !== 'New' && r.condition !== 'Used') return { ok: false, error: 'Condition must be New or Used.' };
    value.condition = r.condition;
  } else if (!partial) value.condition = 'New';
  if (r.target !== undefined) {
    const t = r.target === '' || r.target === null ? null : Number(r.target);
    if (t !== null && (!Number.isFinite(t) || t < 0 || t > 1_000_000)) return { ok: false, error: 'Target price must be a positive number.' };
    value.target = t === null ? null : Math.round(t * 100) / 100;
  }
  if (r.notes !== undefined) {
    const notes = String(r.notes ?? '').trim();
    if (notes.length > 2000) return { ok: false, error: 'Notes are too long (2,000 characters at most).' };
    value.notes = notes || null;
  }
  return { ok: true, value };
}

export async function listWishlist(db: DB): Promise<WishRow[]> {
  return db.select().from(wishlist).orderBy(asc(wishlist.createdAt), asc(wishlist.id)).all();
}

export async function getWish(db: DB, no: string): Promise<WishRow | undefined> {
  return db.select().from(wishlist).where(eq(wishlist.setNo, fullSetNo(no))).get();
}

/** Looks up one wish on BrickLink and stores its name, photo and sold prices (or the error). */
export async function lookupWish(db: DB, w: Pick<WishRow, 'id' | 'setNo' | 'condition' | 'name'>, lookup: Lookup, currency: string): Promise<string | null> {
  try {
    const r = await lookup(w.setNo, w.condition === 'New' ? 'N' : 'U', currency);
    await db.update(wishlist)
      .set({ name: w.name || r.blName, year: r.year, imageUrl: r.imageUrl, avgSold: r.avgSold, minSold: r.minSold, qtySold: r.qtySold, blError: null, lastUpdated: nowIso() })
      .where(eq(wishlist.id, w.id));
    return null;
  } catch (e) {
    const error = (e instanceof Error ? e.message : String(e)).slice(0, 300);
    await db.update(wishlist).set({ blError: error, lastUpdated: nowIso() }).where(eq(wishlist.id, w.id));
    return error;
  }
}

export async function addWish(db: DB, input: WishInput, lookup: Lookup | null): Promise<Result<{ wish: WishRow }>> {
  if (await getWish(db, input.setNo)) return { ok: false, status: 409, error: `#${input.setNo} is already on your wishlist.` };
  const [row] = await db.insert(wishlist)
    .values({ setNo: input.setNo, name: input.name ?? null, condition: input.condition ?? 'New', target: input.target ?? null, notes: input.notes ?? null })
    .onConflictDoNothing().returning().all();
  if (!row) return { ok: false, status: 409, error: `#${input.setNo} is already on your wishlist.` };
  if (lookup) await lookupWish(db, row, lookup, await getCurrency(db));
  return { ok: true, wish: (await getWish(db, input.setNo))! };
}

/** Changes target, condition, name or notes. A condition change re-prices it. */
export async function editWish(db: DB, input: WishInput, lookup: Lookup | null): Promise<Result<{ wish: WishRow }>> {
  const before = await getWish(db, input.setNo);
  if (!before) return { ok: false, status: 404, error: `#${input.setNo} isn't on your wishlist.` };
  const { setNo: _, ...changes } = input;
  if (Object.keys(changes).length) await db.update(wishlist).set(changes).where(eq(wishlist.id, before.id));
  const after = (await getWish(db, input.setNo))!;
  if (lookup && after.condition !== before.condition) await lookupWish(db, after, lookup, await getCurrency(db));
  return { ok: true, wish: (await getWish(db, input.setNo))! };
}

export async function removeWish(db: DB, no: string): Promise<Result> {
  const r = await db.delete(wishlist).where(eq(wishlist.setNo, fullSetNo(no))).returning({ id: wishlist.id }).all();
  return r.length ? { ok: true } : { ok: false, status: 404, error: `#${fullSetNo(no)} isn't on your wishlist.` };
}

/** You got it: adds it to the collection (another copy if you already have one) and takes it off the wishlist. */
export async function acquireWish(db: DB, no: string, lookup: Lookup | null): Promise<Result> {
  const w = await getWish(db, no);
  if (!w) return { ok: false, status: 404, error: `#${fullSetNo(no)} isn't on your wishlist.` };
  const added = await addSet(db, { setNo: w.setNo, name: w.name || w.setNo, condition: w.condition }, { another: true, lookup });
  if (!added.ok) return added;
  await db.delete(wishlist).where(eq(wishlist.id, w.id));
  return { ok: true };
}

/** Re-prices every wish. Returns how many lookups failed. */
export async function syncWishlist(db: DB, lookup: Lookup, currency: string): Promise<number> {
  let errors = 0;
  for (const w of await listWishlist(db)) if (await lookupWish(db, w, lookup, currency)) errors++;
  return errors;
}
