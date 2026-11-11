// Loose parts set aside for builds. A reserved piece counts as available only for the build it's reserved for; for every
// other build it's gone. One helper, availability(), counts what you own for "What can I build?" and layouts alike.
import { and, asc, eq, getTableColumns, inArray, sql } from 'drizzle-orm';
import { partKey } from '../bricklink/wanted';
import { buildParts, builds, colors, locations, partAllocations, partLots, setParts, sets } from '../db/schema';
import type { DB } from '../db/types';
import type { Result } from './sets';

/** The key a build line, a set part and a lot share (part numbers case-blind; no colour = -1). */
export const keyOf = (type: string, partNo: string, colorId: number | null) => partKey(type, partNo, colorId === -1 ? null : colorId);
/** Build lines are always parts. */
export const partKeyOf = (partNo: string, colorId: number | null) => keyOf('PART', partNo, colorId);

const add = <K>(m: Map<K, number>, k: K, n: number) => m.set(k, (m.get(k) ?? 0) + n);

/** Every part in your sets, counted across copies that aren't parted out (alternates and counterparts left out). */
export async function ownedParts(db: DB): Promise<Map<string, number>> {
  const rows = await db
    .select({ partNo: setParts.partNo, colorId: setParts.colorId, n: sql<number>`sum(${setParts.qty} * (select count(*) from "set_copies" c where c."set_id" = ${sets.id} and c."status" <> 'parted_out'))` })
    .from(setParts).innerJoin(sets, eq(sets.id, setParts.setId))
    .where(and(eq(setParts.alternate, false), eq(setParts.counterpart, false)))
    .groupBy(setParts.partNo, setParts.colorId).all();
  const out = new Map<string, number>();
  for (const r of rows) add(out, partKeyOf(r.partNo, r.colorId), Number(r.n));
  return out;
}

export type Availability = {
  /** Parts in your sets. */
  owned: Map<string, number>;
  /** Loose parts nobody has reserved, by key (mapped lots only). */
  freeLots: Map<string, number>;
  /** What's reserved for each build, by build id and key. */
  reservedBy: Map<number, Map<string, number>>;
};

/** What you have: parts in sets, free loose parts, and reservations per build. One grouped query each. */
export async function availability(db: DB): Promise<Availability> {
  const lots = await db.select({ type: partLots.type, partNo: partLots.partNo, colorId: partLots.colorId, qty: sql<number>`sum(${partLots.qty})` })
    .from(partLots).where(eq(partLots.mapped, true)).groupBy(partLots.type, sql`lower(${partLots.partNo})`, partLots.colorId).all();
  const res = await db.select({ buildId: partAllocations.buildId, type: partLots.type, partNo: partLots.partNo, colorId: partLots.colorId, qty: sql<number>`sum(${partAllocations.qty})` })
    .from(partAllocations).innerJoin(partLots, eq(partLots.id, partAllocations.lotId)).where(eq(partLots.mapped, true))
    .groupBy(partAllocations.buildId, partLots.type, sql`lower(${partLots.partNo})`, partLots.colorId).all();
  const freeLots = new Map<string, number>(), reservedBy = new Map<number, Map<string, number>>();
  for (const l of lots) add(freeLots, keyOf(l.type, l.partNo, l.colorId), Number(l.qty));
  for (const r of res) {
    const k = keyOf(r.type, r.partNo, r.colorId);
    add(freeLots, k, -Number(r.qty));
    const m = reservedBy.get(r.buildId) ?? new Map<string, number>();
    add(m, k, Number(r.qty));
    reservedBy.set(r.buildId, m);
  }
  return { owned: await ownedParts(db), freeLots, reservedBy };
}

/* ---------- reading reservations ---------- */

export type Reservation = {
  buildId: number; mocNo: string; buildName: string; lotId: number; qty: number;
  type: string; partNo: string; colorId: number | null; name: string | null; colorName: string | null; rgb: string | null; location: string | null; approximate: boolean;
};

const reservationColumns = {
  buildId: partAllocations.buildId, mocNo: builds.mocNo, buildName: builds.name, lotId: partAllocations.lotId, qty: partAllocations.qty,
  type: partLots.type, partNo: partLots.partNo, colorId: partLots.colorId, name: partLots.name, colorName: colors.name, rgb: colors.rgb, location: partLots.location, approximate: partLots.approximate,
};

/** Reservations for one build, or on one lot, with part, colour, lot location and build name. */
export async function listReservations(db: DB, by: { mocNo: string } | { lotId: number }): Promise<Reservation[]> {
  const where = 'mocNo' in by ? eq(builds.mocNo, by.mocNo) : eq(partAllocations.lotId, by.lotId);
  const rows = await db.select(reservationColumns).from(partAllocations)
    .innerJoin(builds, eq(builds.id, partAllocations.buildId)).innerJoin(partLots, eq(partLots.id, partAllocations.lotId))
    .leftJoin(colors, eq(colors.id, partLots.colorId))
    .where(where).orderBy(asc(partLots.partNo), asc(partLots.colorId), asc(partAllocations.id)).all();
  return rows.map((r) => ({ ...r, colorId: r.colorId === -1 ? null : r.colorId }));
}

/** Per lot: pieces reserved and by which builds. For the given lots, or all. */
export async function lotReservations(db: DB, lotIds?: number[]): Promise<Map<number, { qty: number; builds: { mocNo: string; name: string; qty: number }[] }>> {
  const out = new Map<number, { qty: number; builds: { mocNo: string; name: string; qty: number }[] }>();
  if (lotIds && !lotIds.length) return out;
  const q = db.select({ lotId: partAllocations.lotId, qty: partAllocations.qty, mocNo: builds.mocNo, name: builds.name })
    .from(partAllocations).innerJoin(builds, eq(builds.id, partAllocations.buildId));
  const rows = [];
  if (lotIds) for (let i = 0; i < lotIds.length; i += 90) rows.push(...await q.where(inArray(partAllocations.lotId, lotIds.slice(i, i + 90))).all());
  else rows.push(...await q.all());
  for (const r of rows) {
    const o = out.get(r.lotId) ?? { qty: 0, builds: [] };
    o.qty += r.qty;
    o.builds.push({ mocNo: r.mocNo, name: r.name, qty: r.qty });
    out.set(r.lotId, o);
  }
  return out;
}

/** "Castle MOC (40x) and Moon Rover (12x)". */
export const buildNames = (bs: { name: string; qty: number }[]) => {
  const names = bs.map((b) => `${b.name} (${b.qty}x)`);
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0] ?? '';
};

/* ---------- writing ---------- */

/**
 * Sets a build's reservation on a lot to `qty`, in one statement that also checks the lot still has that many free of
 * other builds' reservations. Two requests at once (D1 runs them side by side) can't both take the same pieces: the
 * second finds them gone and writes nothing. Returns whether it was written.
 */
async function setAllocation(db: DB, buildId: number, lotId: number, qty: number): Promise<boolean> {
  const rows = await db.all<{ id: number }>(sql`
    insert into "part_allocations" ("build_id", "lot_id", "qty")
    select ${buildId}, ${lotId}, ${qty}
    where ${qty} <= (select "qty" from "part_lots" where "id" = ${lotId})
      - (select coalesce(sum("qty"), 0) from "part_allocations" where "lot_id" = ${lotId} and "build_id" <> ${buildId})
    on conflict ("build_id", "lot_id") do update set "qty" = excluded."qty"
    returning "id"`);
  return rows.length > 0;
}

const buildByMoc = (db: DB, mocNo: string) => db.select().from(builds).where(eq(builds.mocNo, mocNo)).get();
const noBuild = (mocNo: string) => ({ ok: false as const, status: 404 as const, error: `Build ${mocNo} doesn't exist.` });

/**
 * Sets how many pieces of a lot are reserved for a build (0 releases it). The lot's part and colour must be on the
 * build's parts list, and a build can't take more than the lot has free of other builds' reservations.
 */
export async function reserve(db: DB, mocNo: string, lotId: number, qty: number): Promise<Result<{ qty: number }>> {
  if (!Number.isInteger(qty) || qty < 0) return { ok: false, status: 400, error: 'Quantity must be a whole number of 0 or more.' };
  const b = await buildByMoc(db, mocNo);
  if (!b) return noBuild(mocNo);
  const lot = await db.select().from(partLots).where(eq(partLots.id, lotId)).get();
  if (!lot) return { ok: false, status: 404, error: `Lot ${lotId} doesn't exist.` };
  if (qty === 0) {
    await db.delete(partAllocations).where(and(eq(partAllocations.buildId, b.id), eq(partAllocations.lotId, lotId)));
    return { ok: true, qty: 0 };
  }
  if (!lot.mapped) return { ok: false, status: 400, error: `Lot ${lot.partNo} has no BrickLink number, so it can't be matched to a build.` };
  const lines = await db.select({ partNo: buildParts.partNo, colorId: buildParts.colorId }).from(buildParts).where(and(eq(buildParts.buildId, b.id), eq(buildParts.mapped, true))).all();
  const k = keyOf(lot.type, lot.partNo, lot.colorId);
  if (!lines.some((l) => partKeyOf(l.partNo, l.colorId) === k)) return { ok: false, status: 400, error: `${b.name} doesn't use ${lot.name ?? lot.partNo} in that colour.` };
  const [{ others }] = await db.select({ others: sql<number>`coalesce(sum(${partAllocations.qty}), 0)` }).from(partAllocations)
    .where(and(eq(partAllocations.lotId, lotId), sql`${partAllocations.buildId} <> ${b.id}`)).all();
  const free = lot.qty - Number(others);
  const busy = (n: number) => ({ ok: false as const, status: 409 as const, error: `Only ${Math.max(n, 0)} of that lot ${n === 1 ? 'is' : 'are'} free; other builds have the rest.` });
  if (qty > free) return busy(free);
  if (!(await setAllocation(db, b.id, lotId, qty))) {
    // Another build reserved some in the meantime.
    const [{ now }] = await db.select({ now: sql<number>`coalesce(sum(${partAllocations.qty}), 0)` }).from(partAllocations).where(and(eq(partAllocations.lotId, lotId), sql`${partAllocations.buildId} <> ${b.id}`)).all();
    return busy(lot.qty - Number(now));
  }
  return { ok: true, qty };
}

/**
 * Reserves, line by line, what a build still needs from free loose parts: each line's quantity less what's already
 * reserved for it. Exact counts before approximate ones, then lots by location order, then the biggest free lot.
 * Parts in sets aren't reserved. Running it again changes nothing once the build has what it can get.
 */
export async function autoReserve(db: DB, mocNo: string): Promise<Result<{ reserved: number; pieces: number; short: number }>> {
  const b = await buildByMoc(db, mocNo);
  if (!b) return noBuild(mocNo);
  const lines = await db.select({ partNo: buildParts.partNo, colorId: buildParts.colorId, qty: buildParts.qty }).from(buildParts).where(and(eq(buildParts.buildId, b.id), eq(buildParts.mapped, true))).all();
  const need = new Map<string, number>();
  for (const l of lines) add(need, partKeyOf(l.partNo, l.colorId), l.qty);
  if (!need.size) return { ok: true, reserved: 0, pieces: 0, short: 0 };

  // Lots of the parts the build uses, with what each has free and what this build already has on it.
  const nos = [...new Set(lines.map((l) => l.partNo.toLowerCase()))];
  const lots: (typeof partLots.$inferSelect & { sort: number | null })[] = [];
  for (let i = 0; i < nos.length; i += 90) {
    lots.push(...await db.select({ ...getTableColumns(partLots), sort: locations.sort }).from(partLots).leftJoin(locations, eq(locations.name, partLots.location))
      .where(and(eq(partLots.mapped, true), eq(partLots.type, 'PART'), inArray(sql`lower(${partLots.partNo})`, nos.slice(i, i + 90)))).all());
  }
  const taken = await lotReservations(db, lots.map((l) => l.id));
  const mine = new Map<number, number>();
  for (const [lotId, r] of taken) for (const x of r.builds) if (x.mocNo === b.mocNo) mine.set(lotId, x.qty);
  const reservedFor = new Map<string, number>();
  for (const l of lots) add(reservedFor, keyOf(l.type, l.partNo, l.colorId), mine.get(l.id) ?? 0);
  const free = (l: { id: number; qty: number }) => l.qty - (taken.get(l.id)?.qty ?? 0);
  lots.sort((x, y) => Number(x.approximate) - Number(y.approximate) || (x.sort ?? 1e9) - (y.sort ?? 1e9) || (x.location === null ? 1 : 0) - (y.location === null ? 1 : 0) || free(y) - free(x) || x.id - y.id);

  let reserved = 0, pieces = 0, short = 0;
  for (const [k, qty] of need) {
    let still = qty - (reservedFor.get(k) ?? 0);
    for (const l of lots) {
      if (still <= 0) break;
      if (keyOf(l.type, l.partNo, l.colorId) !== k) continue;
      const take = Math.min(still, free(l));
      if (take <= 0) continue;
      const now = (mine.get(l.id) ?? 0) + take;
      if (!(await setAllocation(db, b.id, l.id, now))) continue; // another build took them meanwhile: try the next lot
      mine.set(l.id, now);
      const t = taken.get(l.id) ?? { qty: 0, builds: [] };
      t.qty += take;
      taken.set(l.id, t);
      still -= take; pieces += take; reserved++;
    }
    if (still > 0) short += still;
  }
  return { ok: true, reserved, pieces, short };
}

/** Releases a build's reservation on one lot, or all of them. */
export async function release(db: DB, mocNo: string, lotId?: number): Promise<Result<{ pieces: number }>> {
  const b = await buildByMoc(db, mocNo);
  if (!b) return noBuild(mocNo);
  const where = lotId === undefined ? eq(partAllocations.buildId, b.id) : and(eq(partAllocations.buildId, b.id), eq(partAllocations.lotId, lotId));
  const [{ n }] = await db.select({ n: sql<number>`coalesce(sum(${partAllocations.qty}), 0)` }).from(partAllocations).where(where).all();
  await db.delete(partAllocations).where(where);
  return { ok: true, pieces: Number(n) };
}


/**
 * After a build's parts list changed: drops reservations of parts it no longer uses, and trims the rest to what each
 * line now needs (approximate lots first, then the smallest reservation), so it never holds pieces it can't use.
 */
export async function reconcileReservations(db: DB, buildId: number): Promise<void> {
  const lines = await db.select({ partNo: buildParts.partNo, colorId: buildParts.colorId, qty: buildParts.qty }).from(buildParts).where(and(eq(buildParts.buildId, buildId), eq(buildParts.mapped, true))).all();
  const need = new Map<string, number>();
  for (const l of lines) add(need, partKeyOf(l.partNo, l.colorId), l.qty);
  const held = await db.select({ id: partAllocations.id, qty: partAllocations.qty, type: partLots.type, partNo: partLots.partNo, colorId: partLots.colorId, approximate: partLots.approximate })
    .from(partAllocations).innerJoin(partLots, eq(partLots.id, partAllocations.lotId)).where(eq(partAllocations.buildId, buildId)).all();
  const byKey = new Map<string, typeof held>();
  for (const h of held) { const k = keyOf(h.type, h.partNo, h.colorId); byKey.set(k, [...(byKey.get(k) ?? []), h]); }
  for (const [k, rows] of byKey) {
    let over = rows.reduce((t, r) => t + r.qty, 0) - (need.get(k) ?? 0);
    rows.sort((x, y) => Number(y.approximate) - Number(x.approximate) || x.qty - y.qty);
    for (const r of rows) {
      if (over <= 0) break;
      const cut = Math.min(over, r.qty);
      if (cut === r.qty) await db.delete(partAllocations).where(eq(partAllocations.id, r.id));
      else await db.update(partAllocations).set({ qty: r.qty - cut }).where(eq(partAllocations.id, r.id));
      over -= cut;
    }
  }
}
