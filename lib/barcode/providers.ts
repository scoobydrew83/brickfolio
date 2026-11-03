// Barcode lookup providers: services that answer "which LEGO set has this UPC/EAN?". All optional, all server-side
// (keys never reach the browser), each behind the same small interface so they can be tried in order and tested
// with a fake fetch. Only the barcode is sent: nothing about the collection or the user.
//
// Brickset isn't one of them: its API has no barcode search. It does return each set's EAN and UPC, so the daily
// Brickset sync saves those for sets you own or want (lib/service/retail.ts), and they scan without any call.
import { upcOf, type Barcode } from './gtin';

export type ProviderId = 'comparethebricks' | 'brickeconomy';
/** Why a provider gave no answer. Only `not_found` from every provider is remembered as a miss. */
export type Failure = 'not_found' | 'unsupported' | 'auth' | 'rate_limited' | 'quota' | 'network' | 'timeout' | 'invalid_response';
export type Candidate = { setNo: string; name: string | null; year: number | null; pieces: number | null; theme: string | null; imageUrl: string | null; sourceRef: string | null };
export type ProviderResult = { outcome: 'found'; candidates: Candidate[] } | { outcome: Failure; message: string };

export interface BarcodeLookupProvider {
  id: ProviderId;
  displayName: string;
  lookup(barcode: Barcode): Promise<ProviderResult>;
}

export const DEFAULT_TIMEOUT_MS = 5000;
const UA = 'Brickfolio (self-hosted LEGO collection app)';

/** A set number as Brickfolio stores it (75192-1), or null when the provider sent something else. */
export function toSetNo(number: unknown, variant?: unknown): string | null {
  const n = String(number ?? '').trim();
  if (/^\d{3,7}-\d{1,2}$/.test(n)) return n;
  if (!/^\d{3,7}$/.test(n)) return null;
  const v = variant === undefined || variant === null || variant === '' ? 1 : Number(variant);
  return Number.isInteger(v) && v >= 1 && v <= 99 ? `${n}-${v}` : null;
}

/** Image links are shown, never fetched by the server: https only, and of a sane length. */
export const safeImage = (v: unknown): string | null => {
  const s = typeof v === 'string' ? v.trim() : '';
  return /^https:\/\/[^\s"'<>]+$/i.test(s) && s.length <= 500 ? s : null;
};
const text = (v: unknown, max = 120) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const int = (v: unknown, max: number) => { const n = Number(v); return Number.isInteger(n) && n > 0 && n <= max ? n : null; };

/** GET with a timeout, turning transport and HTTP problems into a Failure. */
async function getJson(fetchImpl: typeof fetch, url: string, headers: Record<string, string>, timeoutMs: number, name: string): Promise<{ ok: true; status: number; body: unknown; res: Response } | { ok: false; outcome: Failure; message: string }> {
  let res: Response;
  try {
    res = await fetchImpl(url, { headers: { Accept: 'application/json', 'User-Agent': UA, ...headers }, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    const timeout = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
    return timeout
      ? { ok: false, outcome: 'timeout', message: `${name} didn’t answer within ${Math.round(timeoutMs / 1000)} s.` }
      : { ok: false, outcome: 'network', message: `Couldn’t reach ${name} from the server.` };
  }
  const body = await res.json().catch(() => null);
  return { ok: true, status: res.status, body, res };
}

const httpFailure = (status: number, code: string, name: string): { outcome: Failure; message: string } => {
  if (status === 404) return { outcome: 'not_found', message: `${name} doesn’t know this barcode.` };
  if (status === 401 || status === 403) return { outcome: 'auth', message: `${name} refused the API key (${status}). Check it in the server settings.` };
  if (status === 429) return /quota/i.test(code)
    ? { outcome: 'quota', message: `${name}’s daily limit is used up. It resets tomorrow.` }
    : { outcome: 'rate_limited', message: `${name} asked to slow down. Try again in a moment.` };
  return { outcome: 'network', message: `${name} answered ${status}.` };
};

// ---- CompareTheBricks: https://comparethebricks.com/en-us/api-docs/ ----
// GET /v1/sets/barcode/{code} with Authorization: Bearer. 404 is normal (coverage is partial). Free keys: 250 calls/day.

type CtbSet = { id?: string; setNumber?: string; variant?: string | number; name?: string; theme?: string; year?: number; pieceCount?: number; image?: { url?: string; url300?: string } | null };

export function createCompareTheBricks(key: string, opts: { fetchImpl?: typeof fetch; timeoutMs?: number } = {}): BarcodeLookupProvider {
  const name = 'CompareTheBricks';
  const fetchImpl = opts.fetchImpl ?? fetch;
  return {
    id: 'comparethebricks',
    displayName: name,
    async lookup(b) {
      if (b.format === 'EAN_8') return { outcome: 'unsupported', message: `${name} only looks up 12- and 13-digit barcodes.` };
      const code = upcOf(b.gtin) ?? b.gtin;
      const r = await getJson(fetchImpl, `https://api.comparethebricks.com/v1/sets/barcode/${code}`, { Authorization: `Bearer ${key}` }, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS, name);
      if (!r.ok) return r;
      const body = r.body as { data?: CtbSet; error?: { code?: string }; code?: string } | null;
      if (r.status !== 200) return httpFailure(r.status, String(body?.error?.code ?? body?.code ?? ''), name);
      const s = body?.data;
      const setNo = s && (toSetNo(s.id) ?? toSetNo(s.setNumber, s.variant));
      if (!s || !setNo) return { outcome: 'invalid_response', message: `${name} sent an answer Brickfolio couldn’t read.` };
      return {
        outcome: 'found',
        candidates: [{ setNo, name: text(s.name), year: int(s.year, 2100), pieces: int(s.pieceCount, 100_000), theme: text(s.theme, 60), imageUrl: safeImage(s.image?.url300) ?? safeImage(s.image?.url), sourceRef: text(s.id, 40) }],
      };
    },
  };
}

// ---- BrickEconomy: https://www.brickeconomy.com/api-reference ----
// Search by barcode as described in issue #27: GET /api/v1/search/sets?barcode={code} with an x-apikey header.
// Their reference page can't be read without an account, so the reply is parsed loosely: a list of sets (or one) under
// `data`, each with a set number and name. Off unless BRICKECONOMY_API_KEY is set.

type BeSet = { set_number?: string; number?: string; name?: string; theme?: string; year?: number; pieces_count?: number; pieces?: number; image?: string; image_url?: string };

export function createBrickEconomy(key: string, opts: { fetchImpl?: typeof fetch; timeoutMs?: number } = {}): BarcodeLookupProvider {
  const name = 'BrickEconomy';
  const fetchImpl = opts.fetchImpl ?? fetch;
  return {
    id: 'brickeconomy',
    displayName: name,
    async lookup(b) {
      const code = upcOf(b.gtin) ?? b.gtin;
      const r = await getJson(fetchImpl, `https://www.brickeconomy.com/api/v1/search/sets?${new URLSearchParams({ barcode: code })}`, { 'x-apikey': key }, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS, name);
      if (!r.ok) return r;
      if (r.status !== 200) return httpFailure(r.status, '', name);
      const data = (r.body as { data?: unknown } | null)?.data;
      const list = (Array.isArray(data) ? data : data && typeof data === 'object' ? ((data as { sets?: unknown }).sets ?? [data]) : null) as BeSet[] | null;
      if (!Array.isArray(list)) return { outcome: 'invalid_response', message: `${name} sent an answer Brickfolio couldn’t read.` };
      const candidates = list.slice(0, 10).flatMap((s): Candidate[] => {
        const setNo = toSetNo(s?.set_number ?? s?.number);
        return setNo ? [{ setNo, name: text(s.name), year: int(s.year, 2100), pieces: int(s.pieces_count ?? s.pieces, 100_000), theme: text(s.theme, 60), imageUrl: safeImage(s.image ?? s.image_url), sourceRef: setNo }] : [];
      });
      return candidates.length ? { outcome: 'found', candidates } : { outcome: 'not_found', message: `${name} doesn’t know this barcode.` };
    },
  };
}

// ---- configuration ----

export const PROVIDER_NAMES: Record<ProviderId, string> = { comparethebricks: 'CompareTheBricks', brickeconomy: 'BrickEconomy' };
const KEYS: Record<ProviderId, string> = { comparethebricks: 'COMPARETHEBRICKS_API_KEY', brickeconomy: 'BRICKECONOMY_API_KEY' };

/** BARCODE_PROVIDERS: the order to ask them in (comma-separated). Default: CompareTheBricks, then BrickEconomy. */
export function providerOrder(env: Record<string, string | undefined> = process.env): ProviderId[] {
  const raw = (env.BARCODE_PROVIDERS ?? 'comparethebricks,brickeconomy').split(',').map((s) => s.trim().toLowerCase());
  return [...new Set(raw.filter((s): s is ProviderId => s in KEYS))];
}

/** The providers that have a key, in order. Empty is fine: scans then use saved barcodes only. */
export function providersFromEnv(env: Record<string, string | undefined> = process.env): BarcodeLookupProvider[] {
  const timeoutMs = Math.min(Math.max(Number(env.BARCODE_PROVIDER_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS, 500), 30_000);
  return providerOrder(env).flatMap((id) => {
    const key = env[KEYS[id]]?.trim();
    if (!key) return [];
    return [id === 'comparethebricks' ? createCompareTheBricks(key, { timeoutMs }) : createBrickEconomy(key, { timeoutMs })];
  });
}

/** Which lookups are on, for Settings and the scanner (no secrets). */
export function barcodeCapabilities(env: Record<string, string | undefined> = process.env) {
  const on = new Set(providersFromEnv(env).map((p) => p.id));
  return {
    scanning: env.BARCODE_SCANNING !== 'off',
    brickset: !!env.BRICKSET_API_KEY,
    providers: providerOrder(env).map((id) => ({ id, name: PROVIDER_NAMES[id], enabled: on.has(id) })),
  };
}
export type BarcodeCapabilities = ReturnType<typeof barcodeCapabilities>;
