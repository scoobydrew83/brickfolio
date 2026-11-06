// Retailer offers posted by your own flows (n8n or any script) to POST /api/v1/prices, and the best recent offer per
// wish for deal alerts and the Wishlist page. Offers are never a value: they don't change Est. Value and can't be the
// value source. Nothing here scrapes or calls a retailer.
import { and, asc, eq, gte, inArray, isNotNull } from 'drizzle-orm';
import { priceObservations } from '../db/schema';
import type { DB } from '../db/types';
import { resolve, type Scheme } from '../identifiers/resolve';
import { safeHttpsUrl } from '../safe-url';
import { parseSource, recordPrices, type Guide, type ItemKind, type Observation, type ObservationInput } from './prices';

export const MAX_PER_REQUEST = 200;
const MAX_AGE_DAYS = 30; // posted observations older than this are refused
const MAX_AMOUNT = 1_000_000;
/** Sources the app's own clients write; a posted row may not claim them. */
const FIRST_PARTY = new Set(['bricklink', 'brickowl', 'brickeconomy', 'brickset']);
const POSTED_TYPES = ['offer', 'retail'] as const;
const SCHEMES: Scheme[] = ['bricklink', 'lego', 'gtin', 'brickset', 'rebrickable'];

export type PostedObservation = {
  kind: ItemKind; id: string; scheme: Scheme | null; source: string; type: (typeof POSTED_TYPES)[number]; condition: Guide;
  currency: string; amount: number; url: string | null; observedAt: string; sampleSize: number | null; sourceRef: string | null;
};

/** OFFER_MAX_AGE_DAYS: how long an offer counts for alerts and the Wishlist page (default 3). */
export const offerMaxAgeDays = () => {
  const n = Number(process.env.OFFER_MAX_AGE_DAYS ?? 3);
  return Number.isFinite(n) && n > 0 ? Math.min(n, MAX_AGE_DAYS) : 3;
};

/** Validates a posted body: { observations: [...] }, at most 200. One bad row rejects the batch, naming it. */
export function parsePriceInput(body: unknown, now = new Date()): { ok: true; value: PostedObservation[] } | { ok: false; error: string } {
  const list = (body as { observations?: unknown } | null)?.observations;
  if (!Array.isArray(list) || !list.length) return { ok: false, error: 'Send { observations: [...] } with at least one row.' };
  if (list.length > MAX_PER_REQUEST) return { ok: false, error: `At most ${MAX_PER_REQUEST} observations per request.` };
  const out: PostedObservation[] = [];
  for (const [i, raw] of list.entries()) {
    const at = `observations[${i}]`;
    const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const kind = o.kind === 'minifig' ? 'minifig' : o.kind === 'set' || o.kind === undefined ? 'set' : null;
    if (!kind) return { ok: false, error: `${at}.kind must be set or minifig.` };
    const id = typeof o.id === 'string' || typeof o.id === 'number' ? String(o.id).trim() : '';
    if (!id || id.length > 64) return { ok: false, error: `${at}.id is missing.` };
    const scheme = o.scheme == null ? null : (SCHEMES.find((s) => s === o.scheme) ?? undefined);
    if (scheme === undefined) return { ok: false, error: `${at}.scheme must be one of ${SCHEMES.join(', ')}.` };
    const source = parseSource(o.source);
    if (!source || FIRST_PARTY.has(source)) return { ok: false, error: `${at}.source must be retailer:<name> (lowercase letters, digits, dashes) or manual. ${FIRST_PARTY.has(String(o.source).toLowerCase()) ? `${o.source} prices come only from the app's own sync.` : ''}`.trim() };
    const type = POSTED_TYPES.find((t) => t === (o.type ?? 'offer'));
    if (!type) return { ok: false, error: `${at}.type must be offer or retail.` };
    const condition = o.condition === 'U' || o.condition === 'Used' ? 'U' : o.condition === 'N' || o.condition === 'New' || o.condition === undefined ? 'N' : null;
    if (!condition) return { ok: false, error: `${at}.condition must be N or U.` };
    const currency = String(o.currency ?? '').trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) return { ok: false, error: `${at}.currency must be a 3-letter code such as USD.` };
    const amount = Number(o.amount);
    if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_AMOUNT) return { ok: false, error: `${at}.amount must be a price above 0.` };
    let url: string | null = null;
    if (o.url != null && o.url !== '') {
      url = safeHttpsUrl(o.url);
      if (!url) return { ok: false, error: `${at}.url must be an https link of at most 500 characters.` };
    }
    let observedAt = now.toISOString();
    if (o.observedAt != null) {
      const t = Date.parse(String(o.observedAt));
      if (!Number.isFinite(t)) return { ok: false, error: `${at}.observedAt must be an ISO date and time.` };
      if (t > now.getTime() + 5 * 60_000) return { ok: false, error: `${at}.observedAt is in the future.` };
      if (t < now.getTime() - MAX_AGE_DAYS * 86_400_000) return { ok: false, error: `${at}.observedAt is more than ${MAX_AGE_DAYS} days old.` };
      observedAt = new Date(t).toISOString();
    }
    const n = o.sampleSize == null ? null : Number(o.sampleSize);
    const sampleSize = n != null && Number.isInteger(n) && n >= 0 ? n : null;
    const sourceRef = o.sourceRef == null ? null : String(o.sourceRef).slice(0, 100);
    out.push({ kind, id, scheme, source, type, condition, currency, amount: Math.round(amount * 100) / 100, url, observedAt, sampleSize, sourceRef });
  }
  return { ok: true, value: out };
}

/**
 * The BrickLink number for a posted id: as given in `scheme`; else 11 to 14 digits are a barcode only (no set number is
 * that long), 8 to 10 digits a barcode or a set number, and anything else a set or minifig number.
 */
async function canonical(db: DB, o: PostedObservation): Promise<string | null> {
  const digits = /^\d+$/.test(o.id) && o.kind === 'set' ? o.id.length : 0;
  const schemes: Scheme[] = o.scheme ? [o.scheme] : digits >= 11 && digits <= 14 ? ['gtin'] : digits >= 8 && digits <= 10 ? ['gtin', 'bricklink'] : ['bricklink'];
  for (const s of schemes) {
    const r = await resolve(db, o.kind, s, o.id);
    if (r.canonical) return r.canonical;
  }
  return null;
}

/** Stores posted rows whose id resolves; the rest come back in `unresolved` (not an error). */
export async function savePostedPrices(db: DB, obs: PostedObservation[]): Promise<{ saved: number; unresolved: { index: number; id: string }[] }> {
  const rows: ObservationInput[] = [];
  const unresolved: { index: number; id: string }[] = [];
  for (const [index, o] of obs.entries()) {
    const id = await canonical(db, o);
    if (!id) { unresolved.push({ index, id: o.id }); continue; }
    rows.push({ itemKind: o.kind, itemId: id, source: o.source, type: o.type, condition: o.condition, currency: o.currency, amount: o.amount, sampleSize: o.sampleSize, observedAt: o.observedAt, url: o.url, sourceRef: o.sourceRef });
  }
  await recordPrices(db, rows);
  return { saved: rows.length, unresolved };
}

export type BestOffer = { amount: number; source: string; url: string | null; observedAt: string };

/** The lowest offer per set and condition from the last `days` days, in one currency: setNo → { N?, U? }. */
export async function bestOffers(db: DB, setNos: string[], opts: { currency: string; days?: number; now?: Date }): Promise<Map<string, Partial<Record<Guide, BestOffer>>>> {
  const out = new Map<string, Partial<Record<Guide, BestOffer>>>();
  const since = new Date((opts.now ?? new Date()).getTime() - (opts.days ?? offerMaxAgeDays()) * 86_400_000).toISOString().slice(0, 10);
  const uniq = [...new Set(setNos)];
  for (let i = 0; i < uniq.length; i += 90) {
    const rows: Observation[] = await db.select().from(priceObservations).where(and(
      eq(priceObservations.itemKind, 'set'), inArray(priceObservations.itemId, uniq.slice(i, i + 90)), eq(priceObservations.type, 'offer'),
      eq(priceObservations.currency, opts.currency.toUpperCase()), gte(priceObservations.observedOn, since), isNotNull(priceObservations.amount),
    )).orderBy(asc(priceObservations.amount)).all();
    for (const r of rows) {
      const g = out.get(r.itemId) ?? {};
      if (!g[r.condition]) g[r.condition] = { amount: r.amount!, source: r.source, url: r.url, observedAt: r.observedAt };
      out.set(r.itemId, g);
    }
  }
  return out;
}
