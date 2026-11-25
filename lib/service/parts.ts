// Each set's parts list (the sheet's Parts tab) and BrickLink color names. A list comes from Rebrickable when it
// maps to BrickLink numbers (from the local catalog or the API, see rebrickableParts), else from BrickLink.
import { scopeIds, type ReadScope } from './collections';
import { and, asc, desc, eq, inArray, isNotNull, like, or, sql } from 'drizzle-orm';
import { partCounts, type Color, type SetPart } from '../bricklink/client';
import { insertChunked } from '../db/chunk';
import { colors, identifiers, minifigs, PARTS_SOURCES, rbInventories, rbInventoryParts, rbParts, setParts, sets } from '../db/schema';
import type { DB } from '../db/types';
import { CHUNK, remember, resolveMany, type Resolved } from '../identifiers/resolve';
import type { RbExternal, SetPartsSource } from '../rebrickable/client';
import { setNo as fullSetNo } from '../sets';
import { rbMappings } from './identifiers';
import { reconcileMissing } from './missing';

export type PartsSource = (typeof PARTS_SOURCES)[number];

export type { SetPart } from '../bricklink/client';
export type PartRow = SetPart & { colorName: string | null; rgb: string | null; source?: PartsSource };
export type PartSearchRow = PartRow & { setNo: string; setName: string };

export async function hasParts(db: DB, setId: number): Promise<boolean> {
  return !!(await db.select({ id: setParts.id }).from(setParts).where(eq(setParts.setId, setId)).limit(1).get());
}

/** Replaces a set's parts list and updates its piece and lot counts and source from it. */
export async function replaceParts(db: DB, setId: number, parts: SetPart[], source: PartsSource = 'bricklink'): Promise<void> {
  await db.delete(setParts).where(eq(setParts.setId, setId));
  await insertChunked(parts.map((p) => ({ setId, ...p, mapped: p.mapped ?? true, source })), (c) => db.insert(setParts).values(c));
  await db.update(sets).set({ ...partCounts(parts), partsSource: parts.length ? source : null }).where(eq(sets.id, setId));
  await reconcileMissing(db, setId); // keep marked missing parts in step with the new list
}

// ---- parts lists from Rebrickable ----

/** REBRICKABLE_PARTS (default on; `off` keeps parts lists on BrickLink). */
export const partsFromRebrickable = (env: Record<string, string | undefined> = process.env) => env.REBRICKABLE_PARTS?.trim().toLowerCase() !== 'off';

/** REBRICKABLE_PARTS_MAX_UNMAPPED: most part lots (percent, default 2) that may lack a BrickLink match before BrickLink's list is used. */
export function maxUnmappedPct(env: Record<string, string | undefined> = process.env): number {
  const raw = env.REBRICKABLE_PARTS_MAX_UNMAPPED?.trim().replace(/%$/, '');
  const n = raw ? Number(raw) : 2;
  return Number.isFinite(n) && n >= 0 ? Math.min(n, 100) : 2;
}

type RbLine = { partNo: string; colorId: number | null; qty: number; isSpare: boolean; name: string; part?: RbExternal; color?: RbExternal };

/** A BrickLink ID for a Rebrickable one: the agreed one, else the first saved (Rebrickable lists its best match first). */
const blOf = (r: Resolved | undefined) => r?.canonical ?? r?.candidates[0]?.canonical ?? null;

/**
 * Turns Rebrickable inventory lines into BrickLink-numbered parts: saves the IDs Rebrickable sent with them, maps part
 * and colour through the identifiers map, merges lines that land on the same part and colour, and moves spares into
 * `extra`. A line whose part or colour has no BrickLink number keeps Rebrickable's and is `mapped: false`.
 */
async function mapLines(db: DB, lines: RbLine[]): Promise<SetPart[]> {
  await remember(db, lines.flatMap((l) => [...(l.part ? rbMappings('part', l.partNo, l.part) : []), ...(l.color && l.colorId !== null ? rbMappings('color', l.colorId, l.color) : [])]));
  const [bp, bc] = await Promise.all([
    resolveMany(db, 'part', 'rebrickable', lines.map((l) => l.partNo)),
    resolveMany(db, 'color', 'rebrickable', lines.flatMap((l) => (l.colorId === null ? [] : [l.colorId]))),
  ]);
  const out = new Map<string, SetPart>();
  // Regular lines first, so a spare finds the line it belongs to.
  for (const l of [...lines].sort((a, b) => Number(a.isSpare) - Number(b.isSpare))) {
    const part = blOf(bp.get(l.partNo)), color = l.colorId === null ? null : blOf(bc.get(String(l.colorId)));
    const mapped = !!part && (l.colorId === null || color !== null);
    const p: SetPart = {
      matchNo: 0, partNo: mapped ? part! : l.partNo, name: l.name, type: 'PART', colorId: mapped && color !== null ? Number(color) : l.colorId,
      qty: l.isSpare ? 0 : l.qty, extra: l.isSpare ? l.qty : 0, alternate: false, counterpart: false, mapped,
    };
    const k = `${mapped}|${p.partNo.toLowerCase()}|${p.colorId ?? ''}`;
    const m = out.get(k);
    if (m) { m.qty += p.qty; m.extra += p.extra; } else out.set(k, p);
  }
  return [...out.values()];
}

/** The newest inventory of a set in the local catalog (Rebrickable's downloads, full mode), or null. */
async function localLines(db: DB, setNo: string): Promise<RbLine[] | null> {
  const inv = await db.select({ id: rbInventories.id }).from(rbInventories).where(eq(rbInventories.setNum, setNo)).orderBy(desc(rbInventories.version)).limit(1).get();
  if (!inv) return null;
  const rows = await db.select({ partNo: rbInventoryParts.partNum, colorId: rbInventoryParts.colorId, qty: rbInventoryParts.quantity, isSpare: rbInventoryParts.isSpare, name: rbParts.name })
    .from(rbInventoryParts).leftJoin(rbParts, eq(rbParts.partNum, rbInventoryParts.partNum)).where(eq(rbInventoryParts.inventoryId, inv.id)).all();
  return rows.length ? rows.map((r) => ({ ...r, name: r.name ?? r.partNo })) : null;
}

/** Which Rebrickable → BrickLink minifigure pair wins: yours, then one learned from BrickLink's own list, then the community list. */
const FIG_SOURCE_ORDER = ['user', 'bricklink', 'community'];
const warnedFigs = new Set<string>();

/**
 * BrickLink numbers for Rebrickable minifigures: the identifiers map, else a minifigure you own that has both numbers.
 * Unlike other lookups, a pair learned here from BrickLink's own list of one of your sets beats the community list,
 * and a disagreement is logged once so a maintainer can fix the list.
 */
async function figNumbers(db: DB, figNos: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const nos = [...new Set(figNos.map((n) => n.toLowerCase()))];
  const rows: { value: string; canonical: string; source: string; verified: boolean }[] = [];
  for (let i = 0; i < nos.length; i += CHUNK) {
    rows.push(...await db.select({ value: identifiers.value, canonical: identifiers.canonical, source: identifiers.source, verified: identifiers.verified }).from(identifiers)
      .where(and(eq(identifiers.kind, 'minifig'), eq(identifiers.scheme, 'rebrickable'), inArray(identifiers.value, nos.slice(i, i + CHUNK)))).all());
  }
  const rank = (r: (typeof rows)[number]) => (r.verified ? -1 : 0) + (FIG_SOURCE_ORDER.includes(r.source) ? FIG_SOURCE_ORDER.indexOf(r.source) : FIG_SOURCE_ORDER.length);
  for (const no of nos) {
    const mine = rows.filter((r) => r.value === no).sort((a, b) => rank(a) - rank(b));
    if (!mine.length) continue;
    out.set(no, mine[0].canonical);
    const community = mine.find((r) => r.source === 'community');
    if (community && community.canonical !== mine[0].canonical && !warnedFigs.has(no)) {
      warnedFigs.add(no);
      console.warn(`Minifigure ${no}: the community list says ${community.canonical}, but ${mine[0].source === 'bricklink' ? "BrickLink's list for one of your sets" : 'you'} said ${mine[0].canonical}. Using ${mine[0].canonical}.`);
    }
  }
  const rest = figNos.filter((n) => !out.has(n.toLowerCase()));
  if (rest.length) {
    const own = await db.select({ rb: minifigs.rbFigNo, bl: minifigs.figNo }).from(minifigs).where(and(inArray(minifigs.rbFigNo, rest), isNotNull(minifigs.figNo))).all();
    for (const o of own) if (o.rb && o.bl) out.set(o.rb.toLowerCase(), o.bl);
  }
  // Keyed as given.
  return new Map(figNos.flatMap((n) => (out.has(n.toLowerCase()) ? [[n, out.get(n.toLowerCase())!] as [string, string]] : [])));
}

/** A set's minifigure on Rebrickable, with its BrickLink number when one is known. */
export type RbFigLine = { figNo: string; name: string; qty: number; bl: string | null };

export type RebrickableParts =
  | { ok: true; parts: SetPart[]; unmapped: number; from: 'catalog' | 'api'; calls: number; figs: RbFigLine[] }
  | { ok: false; reason: 'unknown' | 'unmapped'; unmapped?: number; calls: number };

/**
 * A set's parts list from Rebrickable in BrickLink numbers: from the local catalog when it has the set's inventory,
 * else from the API (which also brings part and colour IDs, so it's tried when the local lines don't map well enough).
 * Minifigures always come from the API and are kept even when they have no BrickLink number (`mapped: false`).
 * `ok: false` means use BrickLink's list: Rebrickable doesn't know the set, or more than `maxUnmapped` percent of its
 * part lots have no BrickLink match. `calls` = Rebrickable API calls made. Throws on network errors.
 */
export async function rebrickableParts(db: DB, rb: SetPartsSource, setNo: string, maxUnmapped = maxUnmappedPct()): Promise<RebrickableParts> {
  const no = fullSetNo(setNo);
  let calls = 0;
  const tooMany = (ps: SetPart[]) => {
    const parts = ps.filter((p) => p.qty > 0 || p.extra > 0);
    const bad = parts.filter((p) => !p.mapped).length;
    return !parts.length || (bad * 100) / parts.length > maxUnmapped;
  };
  let from: 'catalog' | 'api' = 'catalog';
  const local = await localLines(db, no);
  let parts = local ? await mapLines(db, local) : null;
  if (!parts || tooMany(parts)) {
    calls++;
    const api = await rb.setParts(no);
    if (!api?.length) return { ok: false, reason: 'unknown', calls };
    parts = await mapLines(db, api);
    from = 'api';
    if (tooMany(parts)) return { ok: false, reason: 'unmapped', unmapped: parts.filter((p) => !p.mapped).length, calls };
  }
  calls++;
  const rbFigs = await rb.setMinifigs(no);
  const bl = await figNumbers(db, rbFigs.map((f) => f.figNo));
  const figs = rbFigs.map((f) => ({ ...f, bl: bl.get(f.figNo) ?? null }));
  parts.push(...figs.map(figLine));
  return { ok: true, parts, unmapped: parts.filter((p) => !p.mapped).length, from, calls, figs };
}

const figLine = (f: RbFigLine): SetPart => ({ matchNo: 0, partNo: f.bl ?? f.figNo, name: f.name, type: 'MINIFIG', colorId: null, qty: f.qty, extra: 0, alternate: false, counterpart: false, mapped: !!f.bl });

/** Whether a Rebrickable list still has minifigures with no BrickLink number (then BrickLink's list supplies them). */
export const needsBrickLinkFigs = (r: Extract<RebrickableParts, { ok: true }>) => r.figs.some((f) => !f.bl);

const words = (name: string) => new Set(name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter((w) => w.length > 1));
/** Share of words two names have in common (Jaccard), 0 to 1. */
function similarity(a: string, b: string): number {
  const x = words(a), y = words(b);
  if (!x.size || !y.size) return 0;
  let both = 0;
  for (const w of x) if (y.has(w)) both++;
  return both / (x.size + y.size - both);
}

/**
 * Pairs a set's Rebrickable minifigures that have no BrickLink number with BrickLink's minifigure lines for the same
 * set, only where the pairing is certain enough: the only one left on each side, the only pair with a given quantity,
 * or names that clearly match each other best. Quantities must agree. Returns Rebrickable → BrickLink number.
 */
export function pairFigs(rb: RbFigLine[], bl: Pick<SetPart, 'partNo' | 'name' | 'qty'>[]): Map<string, string> {
  const out = new Map<string, string>();
  const known = new Set(rb.flatMap((f) => (f.bl ? [f.bl.toLowerCase()] : [])));
  let left = rb.filter((f) => !f.bl);
  let pool = bl.filter((b) => !known.has(b.partNo.toLowerCase()));
  const take = (f: RbFigLine, b: (typeof pool)[number]) => { out.set(f.figNo, b.partNo); left = left.filter((x) => x !== f); pool = pool.filter((x) => x !== b); };
  for (let changed = true; changed && left.length && pool.length; ) {
    changed = false;
    if (left.length === 1 && pool.length === 1) {
      if (left[0].qty === pool[0].qty) { take(left[0], pool[0]); changed = true; }
      break;
    }
    for (const f of [...left]) {
      const sameQty = left.filter((x) => x.qty === f.qty), match = pool.filter((b) => b.qty === f.qty);
      if (sameQty.length === 1 && match.length === 1) { take(f, match[0]); changed = true; }
    }
    if (changed) continue;
    for (const f of [...left]) {
      const scored = pool.filter((b) => b.qty === f.qty).map((b) => ({ b, s: similarity(f.name, b.name) })).sort((a, z) => z.s - a.s);
      const best = scored[0];
      if (!best || best.s < 0.5 || (scored[1] && best.s - scored[1].s < 0.2)) continue;
      // Mutual: no other Rebrickable figure is as close to this BrickLink one.
      if (left.some((o) => o !== f && o.qty === f.qty && similarity(o.name, best.b.name) >= best.s - 0.2)) continue;
      take(f, best.b);
      changed = true;
    }
  }
  return out;
}

/**
 * A Rebrickable parts list with BrickLink's minifigure lines in place of Rebrickable's, so every figure has its
 * BrickLink number. The pairs that can be matched are remembered (identifiers: minifig, rebrickable → BrickLink), so
 * later sets with the same figures need no BrickLink call. If BrickLink lists no minifigures, Rebrickable's are kept.
 */
export async function withBrickLinkFigs(db: DB, setNo: string, r: Extract<RebrickableParts, { ok: true }>, blParts: SetPart[]): Promise<{ parts: SetPart[]; learned: number }> {
  const blFigs = blParts.filter((p) => p.type === 'MINIFIG' && !p.alternate && !p.counterpart);
  if (!blFigs.length) return { parts: r.parts, learned: 0 };
  const pairs = pairFigs(r.figs, blFigs);
  await remember(db, [...pairs].map(([rbNo, blNo]) => ({ kind: 'minifig' as const, scheme: 'rebrickable' as const, value: rbNo, canonical: blNo, source: 'bricklink' as const, sourceRef: fullSetNo(setNo) })));
  return { parts: [...r.parts.filter((p) => p.type !== 'MINIFIG'), ...blFigs.map((p) => ({ ...p, mapped: true }))], learned: pairs.size };
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

/** BrickLink colours by name, for picking a lot's colour (#105). Empty until ensureColors has filled the table. */
export async function listColors(db: DB): Promise<{ id: number; name: string }[]> {
  return db.select({ id: colors.id, name: colors.name }).from(colors).orderBy(asc(colors.name)).all();
}

const partColumns = {
  matchNo: setParts.matchNo, partNo: setParts.partNo, name: setParts.name, type: setParts.type, colorId: setParts.colorId,
  qty: setParts.qty, extra: setParts.extra, alternate: setParts.alternate, counterpart: setParts.counterpart, mapped: setParts.mapped, source: setParts.source,
  colorName: colors.name, rgb: colors.rgb,
};

/** A set's parts with color names: regular parts first, then alternates grouped by what they replace. */
export async function listSetParts(db: DB, setId: number): Promise<PartRow[]> {
  return db.select(partColumns).from(setParts).leftJoin(colors, eq(colors.id, setParts.colorId))
    .where(eq(setParts.setId, setId))
    .orderBy(asc(setParts.alternate), asc(setParts.matchNo), asc(setParts.type), asc(setParts.partNo)).all();
}

/** `collectionId`: only sets with a copy in that collection (#49). */
export type PartSearch = { q?: string; type?: string; limit?: number; offset?: number; collectionId?: ReadScope };

/** Searches parts across every set, like filtering the Parts tab. Matches part #, name or color. */
export async function searchParts(db: DB, f: PartSearch): Promise<{ parts: PartSearchRow[]; total: number }> {
  const q = f.q?.trim();
  const ids = scopeIds(f.collectionId ?? 'all');
  const inCollection = !ids ? undefined : ids.length
    ? sql`exists (select 1 from "set_copies" c where c."set_id" = ${setParts.setId} and coalesce(c."collection_id", 1) in (${sql.join(ids.map((i) => sql`${i}`), sql`, `)}))`
    : sql`0 = 1`;
  const where = and(
    inCollection,
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
