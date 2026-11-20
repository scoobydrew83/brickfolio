// Collections (#49): named groups of copies and minifigures with their own totals, history and share links. The
// wishlist, store, orders, Designer projects, barcodes, prices and loose parts stay shared by the whole install.
// `set_copies.collection_id` and `minifigs.collection_id` have no FK (adding one would rebuild those tables on D1),
// so every write checks the id here.
import { asc, eq, sql } from 'drizzle-orm';
import type { DB } from '../db/types';
import { collectionMembers, collections, minifigs, setCopies, shareLinks } from '../db/schema';
import type { Result } from './sets';

export type CollectionRow = { id: number; name: string; sort: number };
/** A page's scope: one collection, or every collection ('all'). */
export type Scope = number | 'all';
/** What a read covers: a scope, or a list of collections (someone's "all", #50). An empty list is nothing. */
export type ReadScope = Scope | number[];
/** Whether a copy or minifigure in collection `id` (null = the first collection, 1) is in `s`. */
export const inScope = (s: ReadScope, id: number | null | undefined) => s === 'all' || (Array.isArray(s) ? s.includes(id ?? 1) : (id ?? 1) === s);
/** The ids a scope names, or null for every collection. */
export const scopeIds = (s: ReadScope): number[] | null => (s === 'all' ? null : Array.isArray(s) ? s : [s]);

export function parseCollectionName(raw: unknown): { ok: true; value: string } | { ok: false; error: string } {
  const v = String(raw ?? '').trim();
  if (!v || v.length > 40) return { ok: false, error: 'A collection name must be 1–40 characters.' };
  if (v.toLowerCase() === 'all' || v.toLowerCase() === 'all collections') return { ok: false, error: '"All collections" is reserved.' };
  return { ok: true, value: v };
}

/** Parses a `?collection=` value: absent or `all` → 'all', a positive whole number → that id, else null (invalid). */
export function parseScope(raw: unknown): Scope | null {
  const v = String(raw ?? '').trim().toLowerCase();
  if (!v || v === 'all') return 'all';
  return /^[1-9]\d{0,8}$/.test(v) ? Number(v) : null;
}

export async function listCollections(db: DB): Promise<CollectionRow[]> {
  return db.select({ id: collections.id, name: collections.name, sort: collections.sort }).from(collections).orderBy(asc(collections.sort), asc(collections.id)).all();
}

/** Where new copies and minifigures go when "All collections" is selected: the first in the list. */
export async function defaultCollectionId(db: DB): Promise<number> {
  return (await listCollections(db))[0]?.id ?? 1;
}

/** The collection a new item goes to for a scope: the selected one, or the default under "All". */
export async function defaultFor(db: DB, scope: Scope): Promise<number> {
  return scope === 'all' ? defaultCollectionId(db) : scope;
}

/** Whether a collection id exists. */
export async function collectionExists(db: DB, id: number): Promise<boolean> {
  return !!(await db.select({ id: collections.id }).from(collections).where(eq(collections.id, id)).get());
}

/** The collection to add to: the scope when it names one, else the default. Unknown ids are refused. */
export async function targetCollection(db: DB, scope: Scope | null | undefined): Promise<Result<{ id: number }>> {
  if (scope === undefined || scope === null || scope === 'all') return { ok: true, id: await defaultCollectionId(db) };
  return (await collectionExists(db, scope)) ? { ok: true, id: scope } : { ok: false, status: 400, error: `Collection ${scope} doesn't exist.` };
}

/** A scope from a request, checked: unknown ids are an error (the REST API answers 400). */
export async function checkScope(db: DB, raw: unknown): Promise<Result<{ scope: Scope }>> {
  const s = parseScope(raw);
  if (s === null) return { ok: false, status: 400, error: 'collection must be a collection id or "all".' };
  if (s !== 'all' && !(await collectionExists(db, s))) return { ok: false, status: 400, error: `Collection ${s} doesn't exist.` };
  return { ok: true, scope: s };
}

export async function addCollection(db: DB, raw: unknown): Promise<Result<{ collection: CollectionRow }>> {
  const p = parseCollectionName(raw);
  if (!p.ok) return { ...p, status: 400 };
  const [{ max }] = await db.select({ max: sql<number>`coalesce(max(${collections.sort}), -1)` }).from(collections).all();
  const r = await db.insert(collections).values({ name: p.value, sort: Number(max) + 1 }).onConflictDoNothing().returning().all();
  return r.length ? { ok: true, collection: { id: r[0].id, name: r[0].name, sort: r[0].sort } } : { ok: false, status: 409, error: `${p.value} already exists.` };
}

export async function renameCollection(db: DB, id: number, raw: unknown): Promise<Result> {
  const p = parseCollectionName(raw);
  if (!p.ok) return { ...p, status: 400 };
  const clash = await db.select({ id: collections.id }).from(collections).where(eq(collections.name, p.value)).get();
  if (clash && clash.id !== id) return { ok: false, status: 409, error: `${p.value} already exists.` };
  const r = await db.update(collections).set({ name: p.value }).where(eq(collections.id, id)).returning().all();
  return r.length ? { ok: true } : { ok: false, status: 404, error: `Collection ${id} doesn't exist.` };
}

/** Puts collections in the given order; ids left out keep their place after the ones given. */
export async function reorderCollections(db: DB, ids: number[]): Promise<Result> {
  const all = await listCollections(db);
  const known = new Set(all.map((c) => c.id));
  if (ids.some((id) => !known.has(id))) return { ok: false, status: 400, error: 'Unknown collection in the new order.' };
  const order = [...new Set(ids), ...all.map((c) => c.id).filter((id) => !ids.includes(id))];
  for (const [i, id] of order.entries()) await db.update(collections).set({ sort: i }).where(eq(collections.id, id));
  return { ok: true };
}

/** How many copies and minifigure rows each collection holds. */
export async function collectionCounts(db: DB): Promise<Map<number, { copies: number; minifigs: number }>> {
  const out = new Map<number, { copies: number; minifigs: number }>();
  for (const r of await db.select({ id: setCopies.collectionId, n: sql<number>`count(*)` }).from(setCopies).groupBy(setCopies.collectionId).all()) {
    out.set(r.id ?? 1, { copies: Number(r.n), minifigs: 0 });
  }
  for (const r of await db.select({ id: minifigs.collectionId, n: sql<number>`coalesce(sum(${minifigs.qty}), 0)` }).from(minifigs).groupBy(minifigs.collectionId).all()) {
    out.set(r.id, { copies: out.get(r.id)?.copies ?? 0, minifigs: Number(r.n) });
  }
  return out;
}

/** Deletes an empty collection. One that still holds copies or minifigures, or the last one, is refused. */
export async function deleteCollection(db: DB, id: number): Promise<Result> {
  const all = await listCollections(db);
  const c = all.find((x) => x.id === id);
  if (!c) return { ok: false, status: 404, error: `Collection ${id} doesn't exist.` };
  if (all.length === 1) return { ok: false, status: 409, error: `${c.name} is the only collection, so it can't be deleted.` };
  const n = (await collectionCounts(db)).get(id) ?? { copies: 0, minifigs: 0 };
  if (n.copies || n.minifigs) {
    const what = [n.copies && `${n.copies} cop${n.copies === 1 ? 'y' : 'ies'}`, n.minifigs && `${n.minifigs} minifigure${n.minifigs === 1 ? '' : 's'}`].filter(Boolean).join(' and ');
    return { ok: false, status: 409, error: `${c.name} still holds ${what}. Move them first.` };
  }
  const [links] = await db.select({ n: sql<number>`count(*)` }).from(shareLinks).where(eq(shareLinks.collectionId, id)).all();
  if (Number(links.n)) return { ok: false, status: 409, error: `${Number(links.n)} share link${Number(links.n) === 1 ? ' shows' : 's show'} ${c.name}. Revoke ${Number(links.n) === 1 ? 'it' : 'them'} first.` };
  await db.delete(collections).where(eq(collections.id, id));
  await db.delete(collectionMembers).where(eq(collectionMembers.collectionId, id)); // its roles go with it (#50)
  return { ok: true };
}
