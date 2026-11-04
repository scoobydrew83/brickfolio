// Turns a scanned barcode into a LEGO set: saved barcodes first (yours, then ones copied from Brickset or a provider),
// then each configured provider in order until one answers. Never guesses: two different sets come back as
// "ambiguous" for you to pick from. Used by the scanner (server action), the REST API and the MCP tool.
import { eq, inArray, lt } from 'drizzle-orm';
import type { DB } from '../db/types';
import { barcodeMisses, sets, wishlist } from '../db/schema';
import { resolve } from '../identifiers/resolve';
import { barcodeCounts, barcodeRows, saveBarcode, touchBarcode } from '../identifiers/barcodes';
import { ownedSummary } from '../service/copies';
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
  const { candidates } = await resolve(db, 'set', 'gtin', gtin);
  const ids = candidates.map((c) => c.id).filter((id): id is number => id !== null);
  const details = new Map((ids.length ? await barcodeRows(db, { ids }) : []).map((r) => [r.id, r]));
  return candidates.map((c) => {
    const d = c.id === null ? undefined : details.get(c.id);
    return { setNo: c.canonical, name: d?.name ?? null, year: d?.year ?? null, pieces: d?.pieces ?? null, theme: null, imageUrl: d?.imageUrl ?? null, source: c.source as Source, verified: c.verified };
  });
}

/** Adds what the collection and wishlist know: you own it, its real name and photo. */
async function withOwnership(db: DB, found: Found[]): Promise<ScanCandidate[]> {
  if (!found.length) return [];
  const nos = found.map((f) => f.setNo);
  const [own, counts, wish] = await Promise.all([
    db.select({ setNo: sets.setNo, name: sets.name, year: sets.year, pieces: sets.pieces, imageUrl: sets.imageUrl }).from(sets).where(inArray(sets.setNo, nos)).all(),
    ownedSummary(db, nos),
    db.select({ setNo: wishlist.setNo, name: wishlist.name, year: wishlist.year, imageUrl: wishlist.imageUrl }).from(wishlist).where(inArray(wishlist.setNo, nos)).all(),
  ]);
  const o = new Map(own.map((r) => [r.setNo, r])), w = new Map(wish.map((r) => [r.setNo, r]));
  return found.map((f) => {
    const s = o.get(f.setNo), x = w.get(f.setNo);
    return {
      ...f,
      name: s?.name ?? x?.name ?? f.name, year: s?.year ?? x?.year ?? f.year, pieces: s?.pieces ?? f.pieces, imageUrl: s?.imageUrl ?? x?.imageUrl ?? f.imageUrl,
      owned: s ? (({ qty, condition, location }) => ({ qty, condition, location }))(counts.get(s.setNo) ?? { qty: 0, condition: null, location: null }) : null,
      wished: !!x,
    };
  });
}

/** Saves a provider's single answer as an unconfirmed barcode, for this installation only. */
async function remember(db: DB, b: Barcode, source: ProviderId, c: Candidate) {
  await saveBarcode(db, { barcode: b.raw, format: b.format, gtin: b.gtin, setNo: c.setNo, source, name: c.name, year: c.year, pieces: c.pieces, imageUrl: c.imageUrl, sourceRef: c.sourceRef }, 'refresh');
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
    if (!opts.readOnly) await touchBarcode(db, b.gtin);
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
  const by = await barcodeCounts(db);
  const user = by.user ?? 0, community = by.community ?? 0, brickset = by.brickset ?? 0;
  const total = Object.values(by).reduce((t, n) => t + n, 0);
  return { total, user, community, brickset, providers: total - user - community - brickset };
}

/** Saved barcodes for one set (set page, API). */
export async function barcodesForSet(db: DB, no: string) {
  return (await barcodeRows(db, { setNo: no })).map((r) => ({ barcode: r.barcode, gtin: r.gtin, format: r.format, source: r.source as Source, verified: r.verified }));
}

/**
 * What's known about a set typed in by hand (no barcode match): the collection, the wishlist or a saved barcode's
 * name and photo. Unknown sets come back with only their number; BrickLink fills in the rest once added.
 */
export async function describeSet(db: DB, no: string): Promise<ScanCandidate> {
  const [saved] = await barcodeRows(db, { setNo: no, named: true }, 1);
  const [c] = await withOwnership(db, [{ setNo: no, name: saved?.name ?? null, year: saved?.year ?? null, pieces: saved?.pieces ?? null, theme: null, imageUrl: saved?.imageUrl ?? null, source: 'user', verified: false }]);
  return c;
}

/** Everything the scanner needs offline: saved barcodes (trusted rows only), and what you own and want. */
export async function offlineMap(db: DB): Promise<import('./offline').OfflineMap> {
  const { trusted } = await import('./offline');
  const rows = await barcodeRows(db, {}, 50_000);
  const by: Record<string, import('./offline').OfflineSet[]> = {};
  for (const r of rows) (by[r.gtin] ??= []).push({ setNo: r.setNo, name: r.name, year: r.year, pieces: r.pieces, imageUrl: r.imageUrl, source: r.source as Source, verified: r.verified });
  for (const g of Object.keys(by)) by[g] = trusted(by[g]);
  const own = [...(await ownedSummary(db))].map(([setNo, o]) => ({ setNo, ...o }));
  const wish = await db.select({ setNo: wishlist.setNo, name: wishlist.name }).from(wishlist).all();
  return {
    at: nowIso(),
    barcodes: by,
    owned: Object.fromEntries(own.map(({ setNo, ...o }) => [setNo, o])),
    wished: Object.fromEntries(wish.map(({ setNo, name }) => [setNo, { name }])),
  };
}
