// "What can I build?": alternate builds (MOCs) of sets you own, from Rebrickable, matched against every part in
// your collection's parts lists. Fetched a little at a time in the daily sync to stay under Rebrickable's limit.
import { and, asc, eq, isNotNull, isNull, lt, or, sql } from 'drizzle-orm';
import { PartsUnavailable, type BuildSource } from '../rebrickable/client';
import type { DB } from '../db/types';
import { buildParts, builds, setParts, sets } from '../db/schema';
import { displayNo, setNo as fullSetNo } from '../sets';
import { toWantedListXml, type WantedItem } from '../bricklink/wanted';

const nowIso = () => new Date().toISOString();

/** A build whose parts list Rebrickable refused or didn't have is asked about again after this long. */
export const RECHECK_UNAVAILABLE_DAYS = 90;
/** When this many builds in a row are refused and none has ever had a parts list, the key can't read them: stop. */
export const GIVE_UP_AFTER = 5;

/**
 * Finds alternate builds for owned sets not checked yet, then fetches parts for builds that have none, stopping
 * after `maxCalls` Rebrickable calls (about one a second). Returns readable errors; one failure doesn't stop the rest.
 *
 * Rebrickable doesn't share every build's parts list (designers can keep them private or sell them). A refused or
 * missing list is noted on the build and not asked for again for RECHECK_UNAVAILABLE_DAYS, so the sync moves on to
 * other builds instead of retrying the same ones. That's expected, not an error, so it isn't reported as one.
 */
export async function syncBuilds(db: DB, src: BuildSource, opts: { maxCalls?: number } = {}): Promise<string[]> {
  const max = opts.maxCalls ?? 40;
  let calls = 0;
  const errors: string[] = [];

  const unchecked = await db.select({ id: sets.id, setNo: sets.setNo }).from(sets).where(isNull(sets.rbAlternatesAt)).orderBy(asc(sets.setNo)).all();
  for (const s of unchecked) {
    if (calls >= max) break;
    calls++;
    try {
      for (const b of await src.alternates(fullSetNo(s.setNo))) {
        const row = { name: b.name.slice(0, 200), numParts: b.numParts, imageUrl: b.imageUrl, url: b.url, designer: b.designer, sourceSetNo: fullSetNo(s.setNo) };
        await db.insert(builds).values({ mocNo: b.mocNo, ...row }).onConflictDoUpdate({ target: builds.mocNo, set: row });
      }
      await db.update(sets).set({ rbAlternatesAt: nowIso() }).where(eq(sets.id, s.id));
    } catch (e) {
      errors.push(`Rebrickable alternates for #${fullSetNo(s.setNo)}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const recheck = new Date(Date.now() - RECHECK_UNAVAILABLE_DAYS * 86_400_000).toISOString();
  const noParts = await db.select({ id: builds.id, mocNo: builds.mocNo }).from(builds)
    .where(and(isNull(builds.partsFetchedAt), or(isNull(builds.partsCheckedAt), lt(builds.partsCheckedAt, recheck))))
    .orderBy(sql`${builds.partsCheckedAt} is not null`, asc(builds.partsCheckedAt), asc(builds.id)) // never-asked first
    .all();
  let gotAny = !!(await db.select({ id: builds.id }).from(builds).where(isNotNull(builds.partsFetchedAt)).limit(1).get());
  let refusedInARow = 0;
  for (const b of noParts) {
    if (calls >= max) break;
    calls++;
    try {
      const parts = await src.buildParts(b.mocNo);
      await db.delete(buildParts).where(eq(buildParts.buildId, b.id));
      // Merge duplicate lines (same part and colour) so matching counts them once.
      const merged = new Map<string, { partNo: string; colorId: number | null; qty: number; mapped: boolean }>();
      for (const p of parts) {
        const k = `${p.partNo}|${p.colorId ?? ''}`;
        const m = merged.get(k);
        if (m) m.qty += p.qty; else merged.set(k, { ...p });
      }
      for (const p of merged.values()) await db.insert(buildParts).values({ buildId: b.id, ...p });
      await db.update(builds).set({ partsFetchedAt: nowIso(), partsError: null, partsCheckedAt: nowIso() }).where(eq(builds.id, b.id));
      gotAny = true;
      refusedInARow = 0;
    } catch (e) {
      if (e instanceof PartsUnavailable) {
        await db.update(builds).set({ partsError: e.reason, partsCheckedAt: nowIso() }).where(eq(builds.id, b.id));
        if (e.reason === 'forbidden' && ++refusedInARow >= GIVE_UP_AFTER && !gotAny) break; // this key gets none: save the calls
        continue;
      }
      errors.push(`Rebrickable parts for ${b.mocNo}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return errors;
}

export type BuildMatch = {
  mocNo: string; name: string; numParts: number | null; imageUrl: string | null; url: string | null; designer: string | null;
  sourceSetNo: string; partsKnown: boolean;
  /** Rebrickable doesn't share this build's parts list (or has none), so it can't be matched. */
  partsUnavailable: boolean;
  need: number; have: number; pct: number; missingLots: number; missingPieces: number; unmapped: number;
};

const key = (partNo: string, colorId: number | null) => `${partNo.toLowerCase()}|${colorId ?? ''}`;

/** Every part you own, counted across all copies of every set (alternates and counterparts left out). */
async function ownedParts(db: DB): Promise<Map<string, number>> {
  const rows = await db
    .select({ partNo: setParts.partNo, colorId: setParts.colorId, n: sql<number>`sum(${setParts.qty} * ${sets.qty})` })
    .from(setParts).innerJoin(sets, eq(sets.id, setParts.setId))
    .where(and(eq(setParts.alternate, false), eq(setParts.counterpart, false)))
    .groupBy(setParts.partNo, setParts.colorId).all();
  return new Map(rows.map((r) => [key(r.partNo, r.colorId), Number(r.n)]));
}

/** How much of each build you could make from what you own, best first. `sourceSetNo` limits it to one set's builds. */
export async function buildMatches(db: DB, filter: { sourceSetNo?: string } = {}): Promise<BuildMatch[]> {
  const owned = await ownedParts(db);
  const list = await db.select().from(builds)
    .where(filter.sourceSetNo ? eq(builds.sourceSetNo, fullSetNo(filter.sourceSetNo)) : undefined).all();
  const parts = await db.select().from(buildParts).all();
  const byBuild = new Map<number, typeof parts>();
  for (const p of parts) byBuild.set(p.buildId, [...(byBuild.get(p.buildId) ?? []), p]);

  return list.map((b) => {
    const lines = byBuild.get(b.id) ?? [];
    let need = 0, have = 0, missingLots = 0, unmapped = 0;
    for (const l of lines) {
      const got = Math.min(owned.get(key(l.partNo, l.colorId)) ?? 0, l.qty);
      need += l.qty;
      have += got;
      if (got < l.qty) missingLots++;
      if (!l.mapped) unmapped++;
    }
    return {
      mocNo: b.mocNo, name: b.name, numParts: b.numParts, imageUrl: b.imageUrl, url: b.url, designer: b.designer, sourceSetNo: b.sourceSetNo,
      partsKnown: !!b.partsFetchedAt, partsUnavailable: !b.partsFetchedAt && !!b.partsError, need, have, pct: need ? Math.floor((have / need) * 100) : 0, missingLots, missingPieces: need - have, unmapped,
    };
  }).sort((a, b) => Number(b.partsKnown) - Number(a.partsKnown) || b.pct - a.pct || a.missingPieces - b.missingPieces);
}

/**
 * The parts you're missing for a build, as a BrickLink Wanted List (Wanted → Upload → paste XML). Parts Rebrickable
 * couldn't map to BrickLink numbers are left out and counted in `skipped`. Null when the build isn't known.
 */
export async function wantedListXml(db: DB, mocNo: string): Promise<{ xml: string; items: number; skipped: number; name: string } | null> {
  const b = await db.select().from(builds).where(eq(builds.mocNo, mocNo)).get();
  if (!b) return null;
  const owned = await ownedParts(db);
  const lines = await db.select().from(buildParts).where(eq(buildParts.buildId, b.id)).orderBy(asc(buildParts.partNo)).all();
  const items: WantedItem[] = [];
  let skipped = 0;
  for (const l of lines) {
    const missing = l.qty - Math.min(owned.get(key(l.partNo, l.colorId)) ?? 0, l.qty);
    if (missing <= 0) continue;
    if (!l.mapped) { skipped++; continue; }
    items.push({ partNo: l.partNo, colorId: l.colorId, qty: missing });
  }
  const comment = `Missing parts for ${b.name} (${b.mocNo}, alternate build of ${displayNo(b.sourceSetNo)})`;
  return { xml: toWantedListXml(items, comment), items: items.length, skipped, name: b.name };
}
