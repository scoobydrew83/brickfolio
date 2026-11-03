// Turns a scanned barcode into a LEGO set: saved barcodes first (yours, then ones copied from Brickset or a provider),
// then each configured provider in order until one answers. Never guesses: two different sets come back as
// "ambiguous" for you to pick from. Used by the scanner (server action), the REST API and the MCP tool.
import { and, eq, inArray, lt, sql } from 'drizzle-orm';
import type { DB } from '../db/types';
import { barcodeMisses, setBarcodes, sets, wishlist } from '../db/schema';
import { parseBarcode, type Barcode, type BarcodeError, type BarcodeFormat } from './gtin';
import type { BarcodeLookupProvider, Candidate, Failure, ProviderId } from './providers';

/** A barcode no provider knew is asked about again after this long (new sets get added to their catalogs). */
export const MISS_DAYS = 7;

export type Source = 'user' | 'community' | 'brickset' | ProviderId;
export type ScanCandidate = {
  setNo: string; name: string | null; year: number | null; pieces: number | null; theme: string | null; imageUrl: string | null;
  source: Source; verified: boolean;
  owned: { qty: number; condition: string | null; location: string | null } | null;
  wished: boolean;
};
export type ProviderOutcome = { id: ProviderId; outcome: 'found' | Failure; message?: string };
export type Resolution =
  | { status: 'matched' | 'ambiguous' | 'not_found'; barcode: Barcode; candidates: ScanCandidate[]; providers: ProviderOutcome[]; cachedMiss?: boolean; noProviders: boolean }
  | ({ status: 'invalid' } & BarcodeError);

const nowIso = () => new Date().toISOString();

type Found = Omit<ScanCandidate, 'owned' | 'wished'>;

/** Saved barcodes for a GTIN. Ones you confirmed win; otherwise every saved set is a candidate. */
async function local(db: DB, gtin: string): Promise<Found[]> {
  const rows = await db.select().from(setBarcodes).where(eq(setBarcodes.gtin, gtin)).all();
  const trusted = rows.some((r) => r.verified) ? rows.filter((r) => r.verified) : rows;
  const bySet = new Map<string, Found>();
  const rank = (s: Source) => (s === 'user' ? 0 : s === 'community' ? 1 : s === 'brickset' ? 2 : 3);
  for (const r of trusted) {
    const prev = bySet.get(r.setNo);
    if (prev && rank(prev.source) <= rank(r.source)) continue;
    bySet.set(r.setNo, { setNo: r.setNo, name: r.name, year: r.year, pieces: r.pieces, theme: null, imageUrl: r.imageUrl, source: r.source, verified: r.verified });
  }
  return [...bySet.values()];
}

/** Adds what the collection and wishlist know: you own it, its real name and photo. */
async function withOwnership(db: DB, found: Found[]): Promise<ScanCandidate[]> {
  if (!found.length) return [];
  const nos = found.map((f) => f.setNo);
  const [own, wish] = await Promise.all([
    db.select({ setNo: sets.setNo, name: sets.name, qty: sets.qty, condition: sets.condition, location: sets.location, year: sets.year, pieces: sets.pieces, imageUrl: sets.imageUrl }).from(sets).where(inArray(sets.setNo, nos)).all(),
    db.select({ setNo: wishlist.setNo, name: wishlist.name, year: wishlist.year, imageUrl: wishlist.imageUrl }).from(wishlist).where(inArray(wishlist.setNo, nos)).all(),
  ]);
  const o = new Map(own.map((r) => [r.setNo, r])), w = new Map(wish.map((r) => [r.setNo, r]));
  return found.map((f) => {
    const s = o.get(f.setNo), x = w.get(f.setNo);
    return {
      ...f,
      name: s?.name ?? x?.name ?? f.name, year: s?.year ?? x?.year ?? f.year, pieces: s?.pieces ?? f.pieces, imageUrl: s?.imageUrl ?? x?.imageUrl ?? f.imageUrl,
      owned: s ? { qty: s.qty, condition: s.condition, location: s.location } : null,
      wished: !!x,
    };
  });
}

/** Saves a provider's single answer as an unconfirmed barcode, for this installation only. */
async function remember(db: DB, b: Barcode, source: ProviderId, c: Candidate) {
  const row = { name: c.name, year: c.year, pieces: c.pieces, imageUrl: c.imageUrl, sourceRef: c.sourceRef, lastSeenAt: nowIso(), updatedAt: nowIso() };
  await db.insert(setBarcodes).values({ barcode: b.raw, format: b.format, gtin: b.gtin, setNo: c.setNo, source, ...row })
    .onConflictDoUpdate({ target: [setBarcodes.gtin, setBarcodes.setNo, setBarcodes.source], set: row });
}

/**
 * Resolves a barcode. `providers` are tried in order and only when nothing is saved; `readOnly` skips every write
 * (the MCP tool). `refresh` asks the providers even for a barcode that missed recently.
 */
export async function resolveBarcode(
  db: DB, input: unknown,
  opts: { providers: BarcodeLookupProvider[]; hint?: BarcodeFormat | null; readOnly?: boolean; refresh?: boolean },
): Promise<Resolution> {
  const p = parseBarcode(input, opts.hint);
  if (!p.ok) return { status: 'invalid', code: p.code, error: p.error };
  const { ok: _, ...b } = p;
  const noProviders = opts.providers.length === 0;
  const done = async (found: Found[], providers: ProviderOutcome[], extra: { cachedMiss?: boolean } = {}): Promise<Resolution> => ({
    status: found.length === 0 ? 'not_found' : found.length === 1 ? 'matched' : 'ambiguous',
    barcode: b, candidates: await withOwnership(db, found), providers, noProviders, ...extra,
  });

  const saved = await local(db, b.gtin);
  if (saved.length) {
    if (!opts.readOnly) await db.update(setBarcodes).set({ lastSeenAt: nowIso() }).where(eq(setBarcodes.gtin, b.gtin));
    return done(saved, []);
  }
  if (noProviders || opts.readOnly) return done([], []);

  if (!opts.refresh) {
    const miss = await db.select().from(barcodeMisses).where(eq(barcodeMisses.gtin, b.gtin)).get();
    if (miss && Date.parse(miss.checkedAt) > Date.now() - MISS_DAYS * 86_400_000) return done([], [], { cachedMiss: true });
  }

  const outcomes: ProviderOutcome[] = [];
  for (const provider of opts.providers) {
    let r;
    try {
      r = await provider.lookup(b);
    } catch (e) {
      r = { outcome: 'network' as const, message: e instanceof Error ? e.message.slice(0, 200) : String(e) };
    }
    if (r.outcome !== 'found') { outcomes.push({ id: provider.id, outcome: r.outcome, message: r.message }); continue; }
    outcomes.push({ id: provider.id, outcome: 'found' });
    const unique = [...new Map(r.candidates.map((c) => [c.setNo, c])).values()];
    // One answer is kept for next time. Several different sets aren't: you pick, and your pick is what's saved.
    if (unique.length === 1) await remember(db, b, provider.id, unique[0]);
    return done(unique.map((c) => ({ ...c, source: provider.id, verified: false })), outcomes);
  }
  // Remember the miss only when every provider really said "not found", not when one was down.
  if (outcomes.length && outcomes.every((o) => o.outcome === 'not_found' || o.outcome === 'unsupported')) {
    await db.insert(barcodeMisses).values({ gtin: b.gtin, checkedAt: nowIso() })
      .onConflictDoUpdate({ target: barcodeMisses.gtin, set: { checkedAt: nowIso() } });
  }
  return done([], outcomes);
}

/** Drops misses older than MISS_DAYS. */
export async function pruneMisses(db: DB) {
  await db.delete(barcodeMisses).where(lt(barcodeMisses.checkedAt, new Date(Date.now() - MISS_DAYS * 86_400_000).toISOString()));
}

/** How many barcodes are saved, by source, for Settings. */
export async function barcodeStats(db: DB): Promise<{ total: number; user: number; community: number; brickset: number; providers: number }> {
  const rows = await db.select({ source: setBarcodes.source, n: sql<number>`count(*)` }).from(setBarcodes).groupBy(setBarcodes.source).all();
  const by = Object.fromEntries(rows.map((r) => [r.source, Number(r.n)])) as Record<string, number>;
  const user = by.user ?? 0, community = by.community ?? 0, brickset = by.brickset ?? 0;
  const total = rows.reduce((t, r) => t + Number(r.n), 0);
  return { total, user, community, brickset, providers: total - user - community - brickset };
}

/** Saved barcodes for one set (set page, API). */
export async function barcodesForSet(db: DB, no: string) {
  return db.select({ barcode: setBarcodes.barcode, gtin: setBarcodes.gtin, format: setBarcodes.format, source: setBarcodes.source, verified: setBarcodes.verified })
    .from(setBarcodes).where(and(eq(setBarcodes.setNo, no))).all();
}

/**
 * What's known about a set typed in by hand (no barcode match): the collection, the wishlist or a saved barcode's
 * name and photo. Unknown sets come back with only their number; BrickLink fills in the rest once added.
 */
export async function describeSet(db: DB, no: string): Promise<ScanCandidate> {
  const saved = await db.select().from(setBarcodes).where(and(eq(setBarcodes.setNo, no), sql`${setBarcodes.name} is not null`)).limit(1).get();
  const [c] = await withOwnership(db, [{ setNo: no, name: saved?.name ?? null, year: saved?.year ?? null, pieces: saved?.pieces ?? null, theme: null, imageUrl: saved?.imageUrl ?? null, source: 'user', verified: false }]);
  return c;
}

/** Everything the scanner needs offline: saved barcodes (trusted rows only), and what you own and want. */
export async function offlineMap(db: DB): Promise<import('./offline').OfflineMap> {
  const { trusted } = await import('./offline');
  const rows = await db.select({ gtin: setBarcodes.gtin, setNo: setBarcodes.setNo, name: setBarcodes.name, year: setBarcodes.year, pieces: setBarcodes.pieces, imageUrl: setBarcodes.imageUrl, source: setBarcodes.source, verified: setBarcodes.verified })
    .from(setBarcodes).limit(50_000).all();
  const by: Record<string, import('./offline').OfflineSet[]> = {};
  for (const { gtin, ...r } of rows) (by[gtin] ??= []).push(r);
  for (const g of Object.keys(by)) by[g] = trusted(by[g]);
  const own = await db.select({ setNo: sets.setNo, qty: sets.qty, condition: sets.condition, location: sets.location, name: sets.name }).from(sets).all();
  const wish = await db.select({ setNo: wishlist.setNo, name: wishlist.name }).from(wishlist).all();
  return {
    at: nowIso(),
    barcodes: by,
    owned: Object.fromEntries(own.map(({ setNo, ...o }) => [setNo, o])),
    wished: Object.fromEntries(wish.map(({ setNo, name }) => [setNo, { name }])),
  };
}
