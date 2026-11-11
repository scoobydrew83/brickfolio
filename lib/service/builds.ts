// "What can I build?": alternate builds (MOCs) of sets you own, from Rebrickable, matched against every part in
// your collection's parts lists. Fetched a little at a time in the daily sync to stay under Rebrickable's limit.
import { and, asc, eq, isNotNull, isNull, lt, ne, or, sql } from 'drizzle-orm';
import { PartsUnavailable, type BuildSource, type MocSource, type PartLookup, type RbBuildPart } from '../rebrickable/client';
import type { DB } from '../db/types';
import { buildParts, builds, sets } from '../db/schema';
import { availability, partKeyOf, reconcileReservations } from './allocations';
import { mergeLines, readPartsFile, type FileKind } from './partfile';
import type { Result } from './sets';
import { displayNo, setNo as fullSetNo } from '../sets';
import { toWantedListXml, type WantedItem } from '../bricklink/wanted';
import { remember, resolveMany, type Resolved } from '../identifiers/resolve';
import { insertChunked } from '../db/chunk';
import { rbMappings } from './identifiers';

const nowIso = () => new Date().toISOString();

/** A build whose parts list Rebrickable refused or didn't have is asked about again after this long. */
export const RECHECK_UNAVAILABLE_DAYS = 90;
/** When this many builds in a row are refused and none has ever had a parts list, the key can't read them: stop. */
export const GIVE_UP_AFTER = 5;

type Line = { partNo: string; colorId: number | null; qty: number; mapped: boolean };

/** A BrickLink ID for a Rebrickable one: the agreed one, else the first saved (Rebrickable lists its best match first). */
const blOf = (r: Resolved | undefined) => r?.canonical ?? r?.candidates[0]?.canonical ?? null;

/**
 * Saves the BrickLink and LDraw numbers Rebrickable sent with a parts list, then turns each line into BrickLink part
 * and colour numbers through the identifiers map. A line is `mapped` only when both are known; otherwise it keeps
 * Rebrickable's numbers and matching and Wanted Lists skip it.
 */
export async function toBrickLink(db: DB, parts: RbBuildPart[]): Promise<Line[]> {
  await remember(db, parts.flatMap((p) => [...rbMappings('part', p.partNo, p.part), ...(p.colorId === null ? [] : rbMappings('color', p.colorId, p.color))]));
  const [bp, bc] = await Promise.all([
    resolveMany(db, 'part', 'rebrickable', parts.map((p) => p.partNo)),
    resolveMany(db, 'color', 'rebrickable', parts.flatMap((p) => (p.colorId === null ? [] : [p.colorId]))),
  ]);
  return parts.map((p) => {
    const part = blOf(bp.get(p.partNo)), color = p.colorId === null ? null : blOf(bc.get(String(p.colorId)));
    return { partNo: part ?? p.partNo, colorId: color !== null ? Number(color) : p.colorId, qty: p.qty, mapped: !!part && color !== null };
  });
}

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
    .where(and(isNull(builds.partsFetchedAt), ne(builds.kind, 'custom'), or(isNull(builds.partsCheckedAt), lt(builds.partsCheckedAt, recheck))))
    .orderBy(sql`${builds.partsCheckedAt} is not null`, asc(builds.partsCheckedAt), asc(builds.id)) // never-asked first
    .all();
  let gotAny = !!(await db.select({ id: builds.id }).from(builds).where(isNotNull(builds.partsFetchedAt)).limit(1).get());
  let refusedInARow = 0;
  for (const b of noParts) {
    if (calls >= max) break;
    calls++;
    try {
      const parts = await toBrickLink(db, await src.buildParts(b.mocNo));
      await db.delete(buildParts).where(eq(buildParts.buildId, b.id));
      // Merge duplicate lines (same part and colour) so matching counts them once.
      const merged = new Map<string, { partNo: string; colorId: number | null; qty: number; mapped: boolean }>();
      for (const p of parts) {
        const k = `${p.partNo}|${p.colorId ?? ''}`;
        const m = merged.get(k);
        if (m) m.qty += p.qty; else merged.set(k, { ...p });
      }
      for (const p of merged.values()) await db.insert(buildParts).values({ buildId: b.id, ...p });
      await reconcileReservations(db, b.id);
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

export type BuildKind = (typeof builds.$inferSelect)['kind'];

export type BuildMatch = {
  mocNo: string; name: string; numParts: number | null; imageUrl: string | null; url: string | null; designer: string | null;
  /** The set it's an alternate of; '' for MOCs and your own builds. */
  sourceSetNo: string; kind: BuildKind; partsKnown: boolean;
  /** Rebrickable doesn't share this build's parts list (or has none), so it can't be matched. */
  partsUnavailable: boolean;
  need: number; have: number; pct: number; missingLots: number; missingPieces: number; unmapped: number;
  /** Pieces reserved for it from loose parts. */
  reserved: number;
  /** Pieces covered by loose parts: reserved for it, or free. */
  fromLots: number;
};

/**
 * How much of each line a build can get: reserved for it first, then parts in your sets, then free loose parts. Parts
 * in sets and free lots count for every build; parts reserved for another build don't.
 */
function cover(qty: number, k: string, a: Awaited<ReturnType<typeof availability>>, mine: Map<string, number> | undefined) {
  const res = Math.min(qty, mine?.get(k) ?? 0);
  const fromSets = Math.min(qty - res, a.owned.get(k) ?? 0);
  const fromFree = Math.min(qty - res - fromSets, Math.max(a.freeLots.get(k) ?? 0, 0));
  return { got: res + fromSets + fromFree, res, lots: res + fromFree };
}

/** How much of each build you could make from what you own, best first. Filter by source set or kind. */
export async function buildMatches(db: DB, filter: { sourceSetNo?: string; kind?: BuildKind } = {}): Promise<BuildMatch[]> {
  const a = await availability(db);
  const list = await db.select().from(builds)
    .where(and(filter.sourceSetNo ? eq(builds.sourceSetNo, fullSetNo(filter.sourceSetNo)) : undefined, filter.kind ? eq(builds.kind, filter.kind) : undefined)).all();
  const parts = await db.select().from(buildParts).all();
  const byBuild = new Map<number, typeof parts>();
  for (const p of parts) byBuild.set(p.buildId, [...(byBuild.get(p.buildId) ?? []), p]);

  return list.map((b) => {
    const lines = byBuild.get(b.id) ?? [];
    const mine = a.reservedBy.get(b.id);
    let need = 0, have = 0, missingLots = 0, unmapped = 0, reserved = 0, fromLots = 0;
    for (const l of lines) {
      const c = cover(l.qty, partKeyOf(l.partNo, l.colorId), a, l.mapped ? mine : undefined);
      need += l.qty;
      have += c.got;
      reserved += c.res;
      fromLots += c.lots;
      if (c.got < l.qty) missingLots++;
      if (!l.mapped) unmapped++;
    }
    return {
      mocNo: b.mocNo, name: b.name, numParts: b.numParts, imageUrl: b.imageUrl, url: b.url, designer: b.designer, sourceSetNo: b.sourceSetNo, kind: b.kind,
      partsKnown: !!b.partsFetchedAt, partsUnavailable: !b.partsFetchedAt && !!b.partsError, need, have, pct: need ? Math.floor((have / need) * 100) : 0,
      missingLots, missingPieces: need - have, unmapped, reserved, fromLots,
    };
  }).sort((x, y) => Number(y.partsKnown) - Number(x.partsKnown) || y.pct - x.pct || x.missingPieces - y.missingPieces);
}

/**
 * The parts you're missing for a build, as a BrickLink Wanted List (Wanted → Upload → paste XML), after parts in your
 * sets, free loose parts and loose parts reserved for it. Parts Rebrickable couldn't map to BrickLink numbers are left
 * out and counted in `skipped`. Null when the build isn't known.
 */
export async function wantedListXml(db: DB, mocNo: string): Promise<{ xml: string; items: number; skipped: number; name: string } | null> {
  const b = await db.select().from(builds).where(eq(builds.mocNo, mocNo)).get();
  if (!b) return null;
  const a = await availability(db);
  const mine = a.reservedBy.get(b.id);
  const lines = await db.select().from(buildParts).where(eq(buildParts.buildId, b.id)).orderBy(asc(buildParts.partNo)).all();
  const items: WantedItem[] = [];
  let skipped = 0;
  for (const l of lines) {
    const missing = l.qty - cover(l.qty, partKeyOf(l.partNo, l.colorId), a, l.mapped ? mine : undefined).got;
    if (missing <= 0) continue;
    if (!l.mapped) { skipped++; continue; }
    items.push({ partNo: l.partNo, colorId: l.colorId, qty: missing });
  }
  const comment = b.kind === 'alternate' ? `Missing parts for ${b.name} (${b.mocNo}, alternate build of ${displayNo(b.sourceSetNo)})` : `Missing parts for ${b.name}${b.kind === 'moc' ? ` (${b.mocNo})` : ''}`;
  return { xml: toWantedListXml(items, comment), items: items.length, skipped, name: b.name };
}

/* ---------- MOCs and your own builds ---------- */

export const MOC_NO = /^MOC-\d{1,9}$/i;

export type BuildInput = { kind: 'moc'; mocNo: string; name?: string | null } | { kind: 'custom'; name: string };

/** Validates `{ kind: 'moc', mocNo }` or `{ kind: 'custom', name }`. */
export function parseBuildInput(raw: unknown): { ok: true; value: BuildInput } | { ok: false; error: string } {
  const r = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const name = String(r.name ?? '').trim();
  if (name.length > 200) return { ok: false, error: 'Name is too long (200 characters at most).' };
  if (r.kind === 'moc') {
    const no = String(r.mocNo ?? '').trim();
    if (!MOC_NO.test(no)) return { ok: false, error: 'Rebrickable MOC numbers look like MOC-12345.' };
    return { ok: true, value: { kind: 'moc', mocNo: `MOC-${no.slice(4)}`, name: name || null } };
  }
  if (r.kind === 'custom') return name ? { ok: true, value: { kind: 'custom', name } } : { ok: false, error: 'Give the build a name.' };
  return { ok: false, error: "kind must be 'moc' or 'custom'." };
}

/**
 * Adds a Rebrickable MOC by number (the next sync fetches its parts list; its name and photo now when Rebrickable is
 * set up) or your own build by name (upload its parts list with setBuildParts).
 */
export async function addBuild(db: DB, input: BuildInput, rb: MocSource | null = null): Promise<Result<{ mocNo: string }>> {
  if (input.kind === 'custom') {
    const mocNo = `custom-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    await db.insert(builds).values({ mocNo, name: input.name, sourceSetNo: '', kind: 'custom' });
    return { ok: true, mocNo };
  }
  const have = await db.select({ kind: builds.kind, name: builds.name }).from(builds).where(eq(builds.mocNo, input.mocNo)).get();
  if (have) return { ok: false, status: 409, error: `${input.mocNo} is already here${have.kind === 'alternate' ? ', as an alternate build of a set you own' : ''}: ${have.name}.` };
  let info = null;
  try { info = rb ? await rb.moc(input.mocNo) : null; } catch { /* name and photo are optional */ }
  if (rb && info === null) return { ok: false, status: 404, error: `Rebrickable has no ${input.mocNo}.` };
  await db.insert(builds).values({
    mocNo: input.mocNo, name: (input.name || info?.name || input.mocNo).slice(0, 200), numParts: info?.numParts ?? null, imageUrl: info?.imageUrl ?? null,
    url: info?.url ?? `https://rebrickable.com/mocs/${input.mocNo}/`, designer: info?.designer ?? null, sourceSetNo: '', kind: 'moc',
  });
  return { ok: true, mocNo: input.mocNo };
}

/** Removes a MOC or your own build, with its parts list, reservations and layout links. Alternates come back with the sync. */
export async function removeBuild(db: DB, mocNo: string): Promise<Result> {
  const b = await db.select({ id: builds.id, kind: builds.kind }).from(builds).where(eq(builds.mocNo, mocNo)).get();
  if (!b) return { ok: false, status: 404, error: `Build ${mocNo} doesn't exist.` };
  if (b.kind === 'alternate') return { ok: false, status: 409, error: "Alternate builds of your sets come from Rebrickable with each sync, so they can't be removed." };
  await db.delete(builds).where(eq(builds.id, b.id));
  return { ok: true };
}

/**
 * Replaces a MOC's or your own build's parts list from a BrickLink XML or Rebrickable CSV file. Only parts count
 * (minifigs and other item types in the file are skipped and counted). Lines are merged like the sync does.
 */
export async function setBuildParts(db: DB, mocNo: string, kind: FileKind, text: string, lookup: PartLookup | null): Promise<Result<{ lines: number; pieces: number; unmapped: number; skipped: number; note: string | null }>> {
  const b = await db.select({ id: builds.id, kind: builds.kind }).from(builds).where(eq(builds.mocNo, mocNo)).get();
  if (!b) return { ok: false, status: 404, error: `Build ${mocNo} doesn't exist.` };
  if (b.kind === 'alternate') return { ok: false, status: 409, error: "An alternate build's parts list comes from Rebrickable." };
  const read = await readPartsFile(db, kind, text, lookup);
  if (!read.ok) return { ok: false, status: read.status === 413 ? 413 : 400, error: read.error };
  const lines = mergeLines(read.lines.filter((l) => l.type === 'PART'));
  const skipped = read.lines.length - read.lines.filter((l) => l.type === 'PART').length + read.skipped;
  if (!lines.length) return { ok: false, status: 400, error: 'The file has no parts. Nothing was changed.' };
  await db.delete(buildParts).where(eq(buildParts.buildId, b.id));
  await insertChunked(lines.map((l) => ({ buildId: b.id, partNo: l.partNo, colorId: l.colorId, qty: l.qty, mapped: l.mapped })), (c) => db.insert(buildParts).values(c));
  await reconcileReservations(db, b.id); // reservations of parts it no longer needs are given back
  const pieces = lines.reduce((t, l) => t + l.qty, 0);
  await db.update(builds).set({ partsFetchedAt: nowIso(), partsCheckedAt: nowIso(), partsError: null, numParts: pieces }).where(eq(builds.id, b.id));
  return { ok: true, lines: lines.length, pieces, unmapped: lines.filter((l) => !l.mapped).length, skipped, note: read.note };
}
