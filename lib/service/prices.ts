// Every price from every source in one table (price_observations). Est. Value comes from one primary source, chosen
// in Settings (default BrickLink); sources are never averaged together. The others are listed next to it.
import { and, asc, desc, eq, gte, inArray, isNotNull, sql } from 'drizzle-orm';
import type { DB } from '../db/types';
import { insertChunked } from '../db/chunk';
import { priceObservations, settings } from '../db/schema';

export type ItemKind = 'set' | 'minifig';
export type PriceType = 'sold_avg' | 'asking' | 'estimate' | 'retail' | 'offer';
export type Guide = 'N' | 'U';
export type Observation = typeof priceObservations.$inferSelect;
export type ObservationInput = {
  itemKind: ItemKind; itemId: string; source: string; type: PriceType; condition: Guide; currency: string;
  amount: number | null; low?: number | null; high?: number | null; sampleSize?: number | null;
  observedOn?: string; observedAt?: string; url?: string | null; sourceRef?: string | null;
};

export const PRICE_TYPES: PriceType[] = ['sold_avg', 'asking', 'estimate', 'retail', 'offer'];
/** Types that can stand for what an item is worth (retail and one-off offers can't). */
export const VALUE_TYPES: PriceType[] = ['sold_avg', 'asking', 'estimate'];
const SOURCES = ['bricklink', 'brickowl', 'brickeconomy', 'brickset', 'manual'];

/** A source name: one of the known ones, or retailer:<slug>. Null when it's neither. */
export function parseSource(raw: unknown): string | null {
  const s = String(raw ?? '').trim().toLowerCase();
  if (SOURCES.includes(s)) return s;
  return /^retailer:[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/.test(s) ? s : null;
}

export function sourceLabel(source: string): string {
  const known: Record<string, string> = { bricklink: 'BrickLink', brickowl: 'BrickOwl', brickeconomy: 'BrickEconomy', brickset: 'Brickset', manual: 'Manual' };
  if (known[source]) return known[source];
  return source.startsWith('retailer:') ? source.slice(9).split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') : source;
}

export const typeLabel = (t: PriceType) => ({ sold_avg: 'sold average', asking: 'asking', estimate: 'estimate', retail: 'retail', offer: 'offer' })[t];

const todayIso = () => new Date().toISOString().slice(0, 10);

const row = (o: ObservationInput) => {
  const observedAt = o.observedAt ?? new Date().toISOString();
  return {
    itemKind: o.itemKind, itemId: o.itemId, source: o.source, type: o.type, condition: o.condition, currency: o.currency.toUpperCase(),
    amount: o.amount, low: o.low ?? null, high: o.high ?? null, sampleSize: o.sampleSize ?? null,
    observedOn: o.observedOn ?? (o.observedAt ? observedAt.slice(0, 10) : todayIso()), observedAt, url: o.url ?? null, sourceRef: o.sourceRef ?? null,
  };
};

const upsertSet = {
  amount: sql`excluded.amount`, low: sql`excluded.low`, high: sql`excluded.high`, sampleSize: sql`excluded.sample_size`,
  observedAt: sql`excluded.observed_at`, url: sql`excluded.url`, sourceRef: sql`excluded.source_ref`,
};
const key = [priceObservations.itemKind, priceObservations.itemId, priceObservations.source, priceObservations.type, priceObservations.condition, priceObservations.currency, priceObservations.observedOn];

/** Stores prices. One row per item, source, type, condition, currency and day: a later write that day replaces it. */
export async function recordPrices(db: DB, obs: ObservationInput[]): Promise<void> {
  await insertChunked(obs.map(row), (chunk) => db.insert(priceObservations).values(chunk).onConflictDoUpdate({ target: key, set: upsertSet }));
}
export const recordPrice = (db: DB, o: ObservationInput) => recordPrices(db, [o]);

/** One series, oldest first. */
export async function priceSeries(db: DB, kind: ItemKind, id: string, f: { source: string; type: PriceType; condition?: Guide; currency?: string }): Promise<Observation[]> {
  const where = [eq(priceObservations.itemKind, kind), eq(priceObservations.itemId, id), eq(priceObservations.source, f.source), eq(priceObservations.type, f.type)];
  if (f.condition) where.push(eq(priceObservations.condition, f.condition));
  if (f.currency) where.push(eq(priceObservations.currency, f.currency.toUpperCase()));
  return db.select().from(priceObservations).where(and(...where)).orderBy(asc(priceObservations.observedOn)).all();
}

/** Every row for an item, newest first, optionally of one source or type. */
export async function listObservations(db: DB, kind: ItemKind, id: string, f: { source?: string; type?: PriceType } = {}): Promise<Observation[]> {
  const where = [eq(priceObservations.itemKind, kind), eq(priceObservations.itemId, id)];
  if (f.source) where.push(eq(priceObservations.source, f.source));
  if (f.type) where.push(eq(priceObservations.type, f.type));
  return db.select().from(priceObservations).where(and(...where)).orderBy(desc(priceObservations.observedOn), asc(priceObservations.source)).all();
}

/** ?source= and ?type= filters for the observations routes, validated. */
export function observationFilters(url: string): { ok: true; value: { source?: string; type?: PriceType } } | { ok: false; error: string } {
  const q = new URL(url).searchParams;
  const value: { source?: string; type?: PriceType } = {};
  const src = q.get('source');
  if (src) {
    const s = parseSource(src);
    if (!s) return { ok: false, error: 'Unknown source.' };
    value.source = s;
  }
  const t = q.get('type');
  if (t) {
    if (!PRICE_TYPES.includes(t as PriceType)) return { ok: false, error: `type must be one of ${PRICE_TYPES.join(', ')}.` };
    value.type = t as PriceType;
  }
  return { ok: true, value };
}

/** The newest row per (source, type, condition) in a currency: the "other sources" list. */
export async function latestBySource(db: DB, kind: ItemKind, id: string, currency: string): Promise<Observation[]> {
  const rows = await db.select().from(priceObservations)
    .where(and(eq(priceObservations.itemKind, kind), eq(priceObservations.itemId, id), eq(priceObservations.currency, currency.toUpperCase())))
    .orderBy(desc(priceObservations.observedOn), desc(priceObservations.observedAt)).all();
  const seen = new Set<string>();
  return rows.filter((r) => { const k = `${r.source}|${r.type}|${r.condition}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

/** The condition of the newest BrickLink sold average for an item: the guide its current prices are in. */
export async function latestGuide(db: DB, kind: ItemKind, id: string): Promise<Guide | null> {
  const r = await db.select({ condition: priceObservations.condition }).from(priceObservations)
    .where(and(eq(priceObservations.itemKind, kind), eq(priceObservations.itemId, id), eq(priceObservations.source, 'bricklink'), eq(priceObservations.type, 'sold_avg')))
    .orderBy(desc(priceObservations.observedOn), desc(priceObservations.observedAt)).limit(1).get();
  return r?.condition ?? null;
}

/**
 * The newest amount from a source for an item in one condition and currency, observed on or after `since`.
 * Only value types (sold average, asking, estimate); for BrickLink, only its sold average.
 */
export async function recentAmount(db: DB, kind: ItemKind, id: string, f: { source: string; condition: Guide; currency: string; since?: string; withEmpty?: boolean }): Promise<Observation | null> {
  const where = [
    eq(priceObservations.itemKind, kind), eq(priceObservations.itemId, id), eq(priceObservations.source, f.source),
    eq(priceObservations.condition, f.condition), eq(priceObservations.currency, f.currency.toUpperCase()),
    f.source === 'bricklink' ? eq(priceObservations.type, 'sold_avg') : inArray(priceObservations.type, VALUE_TYPES),
  ];
  if (!f.withEmpty) where.push(isNotNull(priceObservations.amount)); // withEmpty: a "no sales" answer counts too
  if (f.since) where.push(gte(priceObservations.observedOn, f.since));
  return (await db.select().from(priceObservations).where(and(...where)).orderBy(desc(priceObservations.observedOn), desc(priceObservations.observedAt)).limit(1).get()) ?? null;
}

/** The newest BrickLink sold average in each condition for an item, in a currency ("no sales" answers included). */
export async function brickLinkGuides(db: DB, kind: ItemKind, id: string, currency: string): Promise<Record<Guide, Observation | null>> {
  const [N, U] = await Promise.all((['N', 'U'] as const).map((condition) => recentAmount(db, kind, id, { source: 'bricklink', condition, currency, withEmpty: true })));
  return { N, U };
}

/** The same for many items at once: setNo → { N, U }. Chunked for D1's 100 bound parameters. */
export async function brickLinkGuidesMany(db: DB, kind: ItemKind, ids: string[], currency: string): Promise<Map<string, Record<Guide, Observation | null>>> {
  const out = new Map<string, Record<Guide, Observation | null>>();
  const uniq = [...new Set(ids)];
  for (let i = 0; i < uniq.length; i += 90) {
    const rows = await db.select().from(priceObservations).where(and(
      eq(priceObservations.itemKind, kind), inArray(priceObservations.itemId, uniq.slice(i, i + 90)), eq(priceObservations.source, 'bricklink'),
      eq(priceObservations.type, 'sold_avg'), eq(priceObservations.currency, currency.toUpperCase()),
    )).orderBy(desc(priceObservations.observedOn), desc(priceObservations.observedAt)).all();
    for (const r of rows) {
      const g = out.get(r.itemId) ?? { N: null, U: null };
      if (!g[r.condition]) g[r.condition] = r;
      out.set(r.itemId, g);
    }
  }
  return out;
}

// ---- primary source ----

const VALUE_SOURCE = 'value_source';

/** The source Est. Value comes from (settings key value_source), BrickLink unless chosen otherwise. */
export async function primarySource(db: DB): Promise<string> {
  const r = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, VALUE_SOURCE)).get();
  return parseSource(r?.value) ?? 'bricklink';
}

/** Sources that can be chosen: BrickLink, plus any that has stored a value-type price. */
export async function valueSources(db: DB): Promise<string[]> {
  const rows = await db.selectDistinct({ source: priceObservations.source }).from(priceObservations).where(inArray(priceObservations.type, VALUE_TYPES)).all();
  return ['bricklink', ...rows.map((r) => r.source).filter((s) => s !== 'bricklink').sort()];
}

/** Sets the primary source, then re-values every set from it. */
export async function setPrimarySource(db: DB, raw: unknown, refresh: (db: DB) => Promise<void>): Promise<{ ok: true; source: string } | { ok: false; status: 400; error: string }> {
  const source = parseSource(raw);
  if (!source) return { ok: false, status: 400, error: 'Unknown price source.' };
  if (!(await valueSources(db)).includes(source)) return { ok: false, status: 400, error: `There are no ${sourceLabel(source)} values yet, so it can't be the value source.` };
  await db.insert(settings).values({ key: VALUE_SOURCE, value: source }).onConflictDoUpdate({ target: settings.key, set: { value: source } });
  await refresh(db);
  return { ok: true, source };
}

// ---- for the set page ----

export type SourceRow = {
  source: string; label: string; type: PriceType; typeLabel: string; condition: Guide; amount: number | null;
  sampleSize: number | null; observedOn: string; url: string | null;
};
export type ValueSources = { primary: string; primaryLabel: string; others: SourceRow[] };

/** What the set page shows about sources: the primary one, and the newest row from each other source. */
export async function valueSourcesFor(db: DB, kind: ItemKind, id: string, currency: string): Promise<ValueSources> {
  const primary = await primarySource(db);
  const rows = await latestBySource(db, kind, id, currency);
  const others = rows
    // The primary source's values are the Est. Value itself (BrickLink's are also in the Low / Average / High line).
    .filter((r) => !(r.source === primary && VALUE_TYPES.includes(r.type)))
    .map((r): SourceRow => ({
      source: r.source, label: sourceLabel(r.source), type: r.type, typeLabel: typeLabel(r.type), condition: r.condition, amount: r.amount,
      sampleSize: r.sampleSize, observedOn: r.observedOn, url: r.url,
    }))
    .sort((a, b) => a.label.localeCompare(b.label) || a.type.localeCompare(b.type) || a.condition.localeCompare(b.condition));
  return { primary, primaryLabel: sourceLabel(primary), others };
}
