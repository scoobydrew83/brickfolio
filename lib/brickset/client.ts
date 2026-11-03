// Brickset API v3 client: original retail prices and launch/retirement dates. BrickLink stays the source of what
// sets sell for; Brickset adds what they cost new. Docs: https://brickset.com/article/52664/api-version-3-documentation
// Free key from brickset.com (Account → API key). Only getSets counts against the key's daily limit, so set numbers
// are asked for in batches.

const BASE = 'https://brickset.com/api/v3.asmx';
const BATCH = 50;

export class BricksetError extends Error {}

/** Retail price by currency, from Brickset's LEGO.com regions. */
export type Retail = Partial<Record<'USD' | 'GBP' | 'CAD' | 'EUR', number>>;
export type BsSet = { setNo: string; retail: Retail; launchDate: string | null; exitDate: string | null; retired: boolean; ean?: string | null; upc?: string | null };

export type RetailSource = {
  /** One call that throws a readable error when the key is wrong or Brickset is unreachable. */
  check(): Promise<void>;
  /**
   * Details for the sets Brickset knows, using at most `maxCalls` getSets calls. `asked` lists the numbers it got
   * an answer for (found or not), so the caller can tell unknown sets from ones it ran out of calls for.
   */
  sets(setNos: string[], opts?: { maxCalls?: number }): Promise<{ found: BsSet[]; asked: string[] }>;
};

const REGIONS = { US: 'USD', UK: 'GBP', CA: 'CAD', DE: 'EUR' } as const;
type Region = { retailPrice?: number | null; dateFirstAvailable?: string | null; dateLastAvailable?: string | null };
export type ApiSet = {
  number: string; numberVariant?: number; availability?: string | null;
  launchDate?: string | null; exitDate?: string | null;
  LEGOCom?: Partial<Record<keyof typeof REGIONS, Region>>;
  barcode?: { EAN?: string | null; UPC?: string | null } | null; // the box's barcodes, saved for the scanner
};
type ApiReply = { status: string; message?: string; sets?: ApiSet[] };

/** A barcode as Brickset sent it, digits only, or null. Checked properly when saved (lib/barcode/gtin.ts). */
const code = (v?: string | null) => (v && /^\d{8,14}$/.test(v.trim()) ? v.trim() : null);
const day = (v?: string | null) => (v && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);

/** Maps one Brickset set to what Brickfolio keeps. `today` is YYYY-MM-DD. */
export function toBsSet(s: ApiSet, today = new Date().toISOString().slice(0, 10)): BsSet {
  const retail: Retail = {};
  let lastAvailable: string | null = null;
  for (const [region, currency] of Object.entries(REGIONS) as [keyof typeof REGIONS, keyof Retail][]) {
    const r = s.LEGOCom?.[region];
    if (r?.retailPrice) retail[currency] = r.retailPrice;
    const last = day(r?.dateLastAvailable);
    if (last && (!lastAvailable || last > lastAvailable)) lastAvailable = last;
  }
  const exitDate = day(s.exitDate) ?? lastAvailable;
  return {
    setNo: `${s.number}-${s.numberVariant ?? 1}`,
    retail,
    launchDate: day(s.launchDate),
    exitDate,
    retired: /retired/i.test(s.availability ?? '') || (!!exitDate && exitDate < today),
    ean: code(s.barcode?.EAN),
    upc: code(s.barcode?.UPC),
  };
}

export function createBrickset(key: string, fetchImpl: typeof fetch = fetch): RetailSource {
  let lists: boolean | undefined; // whether getSets accepts several set numbers at once; learned on first use
  async function call(method: string, query: Record<string, string>): Promise<ApiReply> {
    const url = `${BASE}/${method}?${new URLSearchParams({ apiKey: key, ...query })}`;
    let res: Response;
    try {
      res = await fetchImpl(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(20_000) });
    } catch (e) {
      const why = e instanceof Error ? (e.cause instanceof Error ? e.cause.message : e.message) : String(e);
      throw new BricksetError(`Couldn't reach brickset.com from the server (${why}). Check the server's internet access and DNS.`);
    }
    if (!res.ok) throw new BricksetError(`Brickset answered ${res.status} ${res.statusText}`.trim());
    const body = (await res.json().catch(() => null)) as ApiReply | null;
    if (!body) throw new BricksetError('Brickset sent a reply that is not JSON.');
    if (body.status !== 'success') throw new BricksetError(`Brickset: ${body.message || 'request failed'}`);
    return body;
  }
  async function getSets(numbers: string[]): Promise<BsSet[]> {
    const reply = await call('getSets', { userHash: '', params: JSON.stringify({ setNumber: numbers.join(','), pageSize: 500, extendedData: 0 }) });
    return (reply.sets ?? []).map((s) => toBsSet(s));
  }
  return {
    async check() {
      await call('checkKey', {});
    },
    async sets(setNos, opts = {}) {
      let calls = opts.maxCalls ?? Infinity;
      const found: BsSet[] = [];
      const asked: string[] = [];
      const one = async (n: string) => { calls--; found.push(...(await getSets([n]))); asked.push(n); };
      for (let i = 0; i < setNos.length && calls > 0; i += BATCH) {
        const batch = setNos.slice(i, i + BATCH);
        if (lists === false || batch.length === 1) {
          for (const n of batch) if (calls > 0) await one(n);
          continue;
        }
        calls--;
        const got = await getSets(batch);
        if (got.length || lists === true) {
          lists = true;
          found.push(...got);
          asked.push(...batch);
          continue;
        }
        // Nothing matched: either none of these are on Brickset, or it doesn't take a list. Ask for one to find out.
        if (calls <= 0) break;
        const before = found.length;
        await one(batch[0]);
        if (found.length > before) {
          lists = false; // single numbers work and lists don't: go one at a time from here
          for (const n of batch.slice(1)) if (calls > 0) await one(n);
        } else {
          asked.push(...batch.slice(1)); // the list answer was right: none of them are known
        }
      }
      return { found, asked };
    },
  };
}

/** Client from BRICKSET_API_KEY, or null when it isn't set (the feature is optional). */
export function bricksetFromEnv(): RetailSource | null {
  const key = process.env.BRICKSET_API_KEY;
  return key ? createBrickset(key) : null;
}
