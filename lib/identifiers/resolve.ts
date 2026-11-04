// One map from every catalog's IDs to the BrickLink ID (the canonical key: prices and missing parts use it). Barcode
// scans, imports, exports and Rebrickable syncs read and write it only through this module. See docs/design.md →
// Identifiers. Not one-to-one: a barcode can cover two sets and BrickLink merges molds Rebrickable splits, so a lookup
// returns every trusted candidate, and a single `canonical` only when they agree.
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { DB } from '../db/types';
import { identifiers, type ID_KINDS, type ID_SCHEMES } from '../db/schema';
import { insertChunked } from '../db/chunk';
import { parseBarcode } from '../barcode/gtin';
import { setNo } from '../sets';

export type Kind = (typeof ID_KINDS)[number];
export type Scheme = (typeof ID_SCHEMES)[number];
export type Source = (typeof identifiers.$inferSelect)['source'];
export type Candidate = { canonical: string; source: Source; verified: boolean; /** the row, or null for a rule ('lego' set numbers) */ id: number | null };
export type Resolved = { canonical: string | null; candidates: Candidate[] };
/** A mapping to save: `value` in `scheme` is `canonical` (a BrickLink ID). Both are normalised before saving. */
export type Mapping = { kind: Kind; scheme: Scheme; value: unknown; canonical: unknown; source: Source; verified?: boolean; region?: string | null; sourceRef?: string | null };

/** Trust order, the same as the barcode scanner's: yours, then the reviewed community list, then Brickset, then the rest. */
const RANK: Partial<Record<Source, number>> = { user: 0, community: 1, brickset: 2 };
export const rank = (s: Source) => RANK[s] ?? 3;

/** D1 allows 100 bound parameters per query; `inArray` lookups leave room for the other conditions. */
export const CHUNK = 90;
const MAX_LEN = 64;
const nowIso = () => new Date().toISOString();

/** An element's canonical key: BrickLink part and colour, `3001:5`. */
export const elementKey = (part: string, color: number | string) => `${part.toLowerCase()}:${color}`;

/**
 * The form a value is stored and looked up in, or null when it can't be one: GTINs in lookup form (lib/barcode/gtin.ts),
 * set numbers with their suffix (75192 → 75192-1), part and minifig numbers lowercase (LDraw's `.dat` dropped),
 * colours as whole numbers, LEGO element IDs as digits, BrickLink elements as `part:colour`.
 */
export function normalize(kind: Kind, scheme: Scheme, raw: unknown): string | null {
  const s = String(raw ?? '').trim();
  if (!s || s.length > MAX_LEN) return null;
  if (scheme === 'gtin') {
    const b = parseBarcode(s);
    return b.ok ? b.gtin : null;
  }
  switch (kind) {
    case 'set':
      if (scheme === 'lego' || scheme === 'bricklink' || scheme === 'rebrickable') return /^[A-Za-z0-9._]+(-\d+)?$/.test(s) ? setNo(s) : null;
      return s;
    case 'color':
      return /^-?\d+$/.test(s) ? String(Number(s)) : null;
    case 'element': {
      if (scheme === 'lego_element') return /^\d+$/.test(s) ? s : null;
      if (scheme !== 'bricklink') return s.toLowerCase();
      const m = /^(.+):(-?\d+)$/.exec(s);
      const part = m && normalize('part', 'bricklink', m[1]);
      return part ? elementKey(part, Number(m![2])) : null;
    }
    case 'part':
      return (scheme === 'ldraw' ? s.replace(/\.dat$/i, '') : s).toLowerCase() || null;
    default:
      return s.toLowerCase();
  }
}

/** IDs that need no row: a BrickLink ID is itself, and a LEGO set number is the BrickLink one with `-1`. */
function rule(kind: Kind, scheme: Scheme, value: string): Candidate | null {
  if (scheme === 'bricklink' || (kind === 'set' && scheme === 'lego')) return { canonical: value, source: 'bricklink', verified: true, id: null };
  return null;
}

/** Picks the rows to trust: confirmed ones if there are any, then the best source for each canonical ID. */
export function trust<T extends { canonical: string; source: Source; verified: boolean }>(rows: T[]): T[] {
  const pool = rows.some((r) => r.verified) ? rows.filter((r) => r.verified) : rows;
  const by = new Map<string, T>();
  for (const r of pool) {
    const prev = by.get(r.canonical);
    if (!prev || rank(r.source) < rank(prev.source)) by.set(r.canonical, r);
  }
  return [...by.values()];
}

const resolved = (candidates: Candidate[]): Resolved => ({ canonical: candidates.length === 1 ? candidates[0].canonical : null, candidates });
const select = { id: identifiers.id, value: identifiers.value, canonical: identifiers.canonical, source: identifiers.source, verified: identifiers.verified };

/** The BrickLink ID for `value` in `scheme`, with every trusted candidate. `canonical` is null when unknown or ambiguous. */
export async function resolve(db: DB, kind: Kind, scheme: Scheme, value: unknown): Promise<Resolved> {
  const v = normalize(kind, scheme, value);
  if (!v) return resolved([]);
  const r = rule(kind, scheme, v);
  if (r) return resolved([r]);
  const rows = await db.select(select).from(identifiers)
    .where(and(eq(identifiers.kind, kind), eq(identifiers.scheme, scheme), eq(identifiers.value, v))).orderBy(asc(identifiers.id)).all();
  return resolved(trust(rows).map(({ value: _, ...c }) => c));
}

/** resolve() for many values at once, in chunks small enough for D1. Keyed by each value as given. */
export async function resolveMany(db: DB, kind: Kind, scheme: Scheme, values: unknown[]): Promise<Map<string, Resolved>> {
  const norm = new Map(values.map((v) => [String(v ?? ''), normalize(kind, scheme, v)]));
  const todo = [...new Set([...norm.values()].filter((v): v is string => !!v && !rule(kind, scheme, v)))];
  const rows = new Map<string, Candidate[]>();
  for (let i = 0; i < todo.length; i += CHUNK) {
    const found = await db.select(select).from(identifiers)
      .where(and(eq(identifiers.kind, kind), eq(identifiers.scheme, scheme), inArray(identifiers.value, todo.slice(i, i + CHUNK)))).orderBy(asc(identifiers.id)).all();
    for (const { value, ...c } of found) rows.set(value, [...(rows.get(value) ?? []), c]);
  }
  const out = new Map<string, Resolved>();
  for (const [raw, v] of norm) {
    const r = v ? rule(kind, scheme, v) : null;
    out.set(raw, resolved(r ? [r] : v ? trust(rows.get(v) ?? []) : []));
  }
  return out;
}

/** The other way: what a BrickLink ID is called in `scheme` (for exports to Rebrickable or LDraw), most trusted first. */
export async function toScheme(db: DB, kind: Kind, canonical: unknown, scheme: Scheme): Promise<string[]> {
  const c = normalize(kind, 'bricklink', canonical);
  if (!c) return [];
  if (scheme === 'bricklink') return [c];
  if (kind === 'set' && scheme === 'lego') return c.endsWith('-1') ? [c.slice(0, -2)] : [];
  const rows = await db.select(select).from(identifiers)
    .where(and(eq(identifiers.kind, kind), eq(identifiers.canonical, c), eq(identifiers.scheme, scheme))).orderBy(asc(identifiers.id)).all();
  const pool = rows.some((r) => r.verified) ? rows.filter((r) => r.verified) : rows;
  return [...new Set(pool.sort((a, b) => rank(a.source) - rank(b.source)).map((r) => r.value))];
}

/** The unique key's fields of a mapping, normalised, or null when either side isn't a valid ID. */
export function toRow(m: Mapping) {
  const value = normalize(m.kind, m.scheme, m.value), canonical = normalize(m.kind, 'bricklink', m.canonical);
  if (!value || !canonical) return null;
  return { kind: m.kind, scheme: m.scheme, value, canonical, source: m.source, verified: !!m.verified, region: m.region ?? null, sourceRef: m.sourceRef ?? null };
}

/**
 * Saves mappings. One already saved is seen again: `last_seen_at` moves on, and it becomes confirmed if this one is.
 * Invalid IDs are skipped. Returns how many valid mappings were given.
 */
export async function remember(db: DB, mappings: Mapping[]): Promise<number> {
  const rows = new Map<string, NonNullable<ReturnType<typeof toRow>>>();
  for (const m of mappings) {
    const r = toRow(m);
    if (r) rows.set(`${r.kind}|${r.scheme}|${r.value}|${r.canonical}|${r.source}`, r);
  }
  const t = nowIso();
  await insertChunked([...rows.values()], (c) => db.insert(identifiers).values(c).onConflictDoUpdate({
    target: [identifiers.kind, identifiers.scheme, identifiers.value, identifiers.canonical, identifiers.source],
    set: {
      lastSeenAt: t, updatedAt: t,
      verified: sql`max(${identifiers.verified}, excluded.verified)`,
      verifiedAt: sql`case when excluded.verified = 1 and ${identifiers.verified} = 0 then ${t} else ${identifiers.verifiedAt} end`,
      region: sql`coalesce(excluded.region, ${identifiers.region})`,
      sourceRef: sql`coalesce(excluded.source_ref, ${identifiers.sourceRef})`,
    },
  }));
  return rows.size;
}
