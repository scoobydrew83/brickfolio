// The command palette's search (#107): sets, minifigures, wishlist items, parts and loose parts, plus pages, cut to what
// the caller may read. Sets, minifigures and set parts follow the caller's collections (#49, #50); the wishlist and
// loose parts are shared lists any member reads; Store and Orders are pages for admins only.
import { and, asc, eq, sql, type AnyColumn } from 'drizzle-orm';
import type { DB } from '../db/types';
import { colors, minifigs, partLots, setParts, sets, wishlist } from '../db/schema';
import { matchPages, SEARCH_PER_GROUP, type SearchHit } from '../search';
import { displayNo } from '../sets';
import { scopeIds, type ReadScope } from './collections';
import { can, readable, type Access } from './permissions';

/** `col` contains `q` (case-insensitive for ASCII, as SQLite's LIKE), with `%`, `_` and `\` in `q` taken literally. */
const has = (col: AnyColumn, q: string) => sql`${col} like ${`%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`} escape '\\'`;
/** `col` starts with `q`, for ranking. */
const starts = (col: AnyColumn, q: string) => sql`${col} like ${`${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`} escape '\\'`;

/**
 * Ids in a scope as an `in (…)` subquery bound as ONE parameter (a JSON array, read with json_each), so any number of
 * collections stays under D1's 100 bound parameters. Works on SQLite, D1 and libSQL.
 */
export const inIds = (ids: number[]) => sql`select value from json_each(${JSON.stringify(ids)})`;

/**
 * Everything matching `q` that `access` may read, at most SEARCH_PER_GROUP per group. `scope` is the collections to
 * search (already cut to what `access` reads, e.g. by clampScope); it defaults to all of theirs. `q` must be checked
 * with parseQuery first. Someone with no collection finds nothing but pages they may open.
 */
export async function searchEverything(db: DB, access: Access, q: string, opts: { scope?: ReadScope; account?: boolean } = {}): Promise<SearchHit[]> {
  const pages = matchPages(q, access.admin, opts.account).slice(0, SEARCH_PER_GROUP);
  if (!can(access, 'member')) return pages.filter((p) => p.href === '/settings' || p.href === '/account');
  const ids = scopeIds(opts.scope ?? readable(access));
  if (ids && !ids.length) return pages;
  const n = SEARCH_PER_GROUP;
  // Collection checks, as listSets and searchParts make them: a copy (or figure) in one of `ids`.
  const setInScope = (setId: AnyColumn) =>
    ids ? sql`exists (select 1 from "set_copies" c where c."set_id" = ${setId} and coalesce(c."collection_id", 1) in (${inIds(ids)}))` : undefined;
  const noQ = displayNo(q);

  const [setRows, figRows, wishRows, partRows, lotRows] = await Promise.all([
    db.select({ setNo: sets.setNo, name: sets.name, year: sets.year, imageUrl: sets.imageUrl }).from(sets)
      .where(and(setInScope(sets.id), sql`(${has(sets.setNo, noQ)} or ${has(sets.name, q)} or ${has(sets.blName, q)})`))
      .orderBy(sql`${starts(sets.setNo, noQ)} desc`, asc(sets.setNo)).limit(n).all(),
    // One row per figure, though it has a row in each collection it's in.
    db.select({ figNo: minifigs.figNo, rbFigNo: minifigs.rbFigNo, name: sql<string>`min(${minifigs.name})`, imageUrl: sql<string | null>`max(${minifigs.imageUrl})`, qty: sql<number>`sum(${minifigs.qty})` }).from(minifigs)
      .where(and(ids ? sql`${minifigs.collectionId} in (${inIds(ids)})` : undefined, sql`(${has(minifigs.name, q)} or ${has(minifigs.figNo, q)} or ${has(minifigs.rbFigNo, q)})`))
      .groupBy(minifigs.figNo, minifigs.rbFigNo).orderBy(sql`min(${minifigs.name})`).limit(n).all(),
    db.select({ setNo: wishlist.setNo, name: wishlist.name, year: wishlist.year, imageUrl: wishlist.imageUrl }).from(wishlist)
      .where(sql`(${has(wishlist.setNo, noQ)} or ${has(wishlist.name, q)})`).orderBy(asc(wishlist.setNo)).limit(n).all(),
    db.select({ partNo: setParts.partNo, name: sql<string>`min(${setParts.name})`, color: sql<string | null>`min(${colors.name})`, inSets: sql<number>`count(distinct ${setParts.setId})` }).from(setParts)
      .leftJoin(colors, eq(colors.id, setParts.colorId))
      .where(and(setInScope(setParts.setId), sql`(${starts(setParts.partNo, q)} or ${has(setParts.name, q)})`))
      .groupBy(setParts.partNo, setParts.colorId).orderBy(sql`${starts(setParts.partNo, q)} desc`, asc(setParts.partNo), asc(setParts.colorId)).limit(n).all(),
    db.select({ partNo: partLots.partNo, name: partLots.name, color: colors.name, qty: partLots.qty, location: partLots.location }).from(partLots)
      .leftJoin(colors, eq(colors.id, partLots.colorId))
      .where(sql`(${starts(partLots.partNo, q)} or ${has(partLots.name, q)} or ${has(partLots.location, q)})`)
      .orderBy(sql`${starts(partLots.partNo, q)} desc`, asc(partLots.partNo), asc(partLots.colorId), asc(partLots.id)).limit(n).all(),
  ]);

  const join = (...parts: (string | number | null | undefined)[]) => parts.filter((p) => p !== null && p !== undefined && p !== '').join(' · ') || null;
  return [
    ...pages,
    ...setRows.map((s): SearchHit => ({ group: 'Sets', label: s.name, hint: join(displayNo(s.setNo), s.year), href: `/sets/${encodeURIComponent(displayNo(s.setNo))}`, image: s.imageUrl })),
    ...figRows.map((f): SearchHit => ({ group: 'Minifigures', label: f.name, hint: join(f.figNo ?? f.rbFigNo, `${Number(f.qty)}x`), href: '/minifigs', image: f.imageUrl })),
    ...wishRows.map((w): SearchHit => ({ group: 'Wishlist', label: w.name ?? displayNo(w.setNo), hint: join(displayNo(w.setNo), w.year), href: '/wishlist', image: w.imageUrl })),
    ...partRows.map((p): SearchHit => ({ group: 'Parts', label: p.name, hint: join(p.partNo, p.color, `in ${Number(p.inSets)} set${Number(p.inSets) === 1 ? '' : 's'}`), href: `/parts?q=${encodeURIComponent(p.partNo)}` })),
    ...lotRows.map((l): SearchHit => ({ group: 'Loose parts', label: l.name ?? l.partNo, hint: join(l.partNo, l.color, `${l.qty}x`, l.location), href: `/parts/lots?q=${encodeURIComponent(l.partNo)}` })),
  ];
}
