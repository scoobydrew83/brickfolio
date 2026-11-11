// BrickLink Store API v1 client: catalog item, sold price guide and parts list for a set.
// Docs: https://www.bricklink.com/v3/api.page. Daily limit is 5,000 calls. A lookup uses 2, plus 1 for the
// parts list the first time (it rarely changes), like the n8n "BrickLink - Sheet Sync" workflow it replaces.
import { oauthHeader, type OAuthKeys } from './oauth';

const BASE = 'https://api.bricklink.com/api/store/v1';
const GAP_MS = 250; // spacing between calls, so a full sync doesn't burst

export type BrickLinkErrorKind = 'quota' | 'maintenance' | 'auth' | 'ip' | 'not_found' | 'other';
export class BrickLinkError extends Error {
  constructor(message: string, public kind: BrickLinkErrorKind = 'other') { super(message); }
}

/** Shown when BrickLink's daily limit is used up. The sync stops its lookups for the day when it sees it. */
export const QUOTA_MESSAGE = "BrickLink's daily limit of 5,000 calls is used up. Prices update at the next sync.";

/** Starts the error shown while BrickLink is down for maintenance. The sync stops its lookups when it sees it. */
export const MAINTENANCE_MESSAGE = 'BrickLink is down for maintenance';
export const isMaintenance = (error: string | null) => !!error?.startsWith(MAINTENANCE_MESSAGE);

/** A readable error for a BrickLink answer, keeping BrickLink's own words in brackets. */
export function brickLinkError(status: number, meta: { code?: number; message?: string; description?: string } | undefined, path: string, statusText = ''): BrickLinkError {
  const code = meta?.code ?? status;
  const said = [meta?.message, meta?.description].filter(Boolean).join(': ') || statusText;
  const raw = said ? ` (${said})` : '';
  if (code === 429 || /TOO_MANY_REQUESTS|quota|limit exceeded/i.test(said)) return new BrickLinkError(QUOTA_MESSAGE, 'quota');
  if (/TOKEN_IP_MISMATCHED|invalid ip|ip mismatch/i.test(said)) return new BrickLinkError(`BrickLink refused the access token from this server's IP address. On BrickLink's API page, register the token for IP 0.0.0.0 or this server's address${raw}.`, 'ip');
  if (code === 401 || code === 403) return new BrickLinkError(`BrickLink rejected the API keys. Check the four BRICKLINK_* values${raw}.`, 'auth');
  const item = decodeURIComponent(path.split('/items/')[1]?.split('/').slice(0, 2).join(' ') ?? '');
  if (code === 404) return new BrickLinkError(item ? `BrickLink has no ${item.replace(/^(\w+) /, (_, t: string) => `${t.toLowerCase()} `)}${raw}.` : `BrickLink couldn't find that${raw}.`, 'not_found');
  return new BrickLinkError(`${path.split('/').pop()}: ${said || 'request failed'} (HTTP ${code})`);
}

const plainText = (html: string) => html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

/** The first words of a reply that isn't BrickLink's JSON (an HTML error or block page), tags and spacing removed. */
export function replySnippet(text: string): string {
  const title = /<title[^>]*>([^<]*)<\/title>/i.exec(text)?.[1];
  return clip(plainText(title ?? text), 120);
}

/** BrickLink's maintenance page, with its notice (e.g. "We expect the site to remain unavailable until …") when it has one. */
export function maintenanceError(text: string): BrickLinkError {
  const notice = [...text.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].map((m) => plainText(m[1])).find((p) => /unavailable|until|expect|back/i.test(p));
  return new BrickLinkError(`${MAINTENANCE_MESSAGE}${notice ? ` (${clip(notice, 160)})` : ''}. Prices update at the next sync.`, 'maintenance');
}

/** A reply BrickLink's API didn't format as JSON, often a firewall or maintenance page in front of the API. */
export function unreadableReply(status: number, text: string, path: string, blocked: boolean): BrickLinkError {
  const what = `${path.split('/').pop()}: BrickLink answered HTTP ${status} with ${text.trim() ? 'a page instead of API data' : 'an empty reply'}`;
  const snippet = replySnippet(text);
  const hint = blocked ? ". BrickLink's firewall may be blocking this server's address; try again later or from another network" : '';
  return new BrickLinkError(`${what}${snippet ? ` ("${snippet}")` : ''}${hint}.`);
}

/** Why a request never got an answer: fetch's own "fetch failed" hides the reason in `cause`. */
export function networkError(e: unknown, path: string): BrickLinkError {
  const err = e as { name?: string; message?: string; cause?: { code?: string; message?: string } };
  const reason = err?.name === 'TimeoutError' ? 'no answer within 20 seconds' : [err?.cause?.code, err?.cause?.message ?? err?.message].filter(Boolean).join(' ') || String(e);
  return new BrickLinkError(`${path.split('/').pop()}: couldn't reach BrickLink (${reason}).`);
}

export type LookupResult = {
  blName: string;
  year: number | null;
  categoryId: number | null;
  imageUrl: string | null;
  parts?: SetPart[]; // only when the parts list was fetched
  pieces?: number;
  partLots?: number;
  avgSold: number | null;
  minSold: number | null;
  maxSold: number | null;
  qtySold: number | null;
};
/**
 * Looks up one set. `guide` = N (new) or U (used) sold prices. `parts` also fetches the parts list for
 * pieces and part lots. Throws BrickLinkError with a readable message.
 */
export type Lookup = (setNo: string, guide: 'N' | 'U', currency: string, opts?: { parts?: boolean }) => Promise<LookupResult>;

/** One entry of a set's parts list (GET /items/SET/:no/subsets). */
export type SetPart = {
  matchNo: number; partNo: string; name: string; type: string; colorId: number | null;
  qty: number; extra: number; alternate: boolean; counterpart: boolean;
};
export type Color = { id: number; name: string; rgb: string | null };

/** Part Lots = every entry; Pieces = sum of quantities, skipping alternates (minifigs and counterparts count), like the sheet. */
export const partCounts = (parts: Pick<SetPart, 'qty' | 'alternate'>[]) => ({
  partLots: parts.length,
  pieces: parts.filter((p) => !p.alternate).reduce((t, p) => t + p.qty, 0),
});

/** One lot in your BrickLink store (GET /inventories). */
export type InventoryItem = {
  inventoryId: number; itemNo: string; name: string; type: string; colorId: number | null; colorName: string | null;
  qty: number; condition: 'N' | 'U'; unitPrice: number | null; description: string | null; remarks: string | null;
};
/** One BrickLink order. direction "in" = you sold (buyer is the other party), "out" = you bought. */
export type Order = {
  orderId: number; direction: 'in' | 'out'; dateOrdered: string | null; status: string; counterparty: string | null;
  items: number | null; lots: number | null; currency: string | null; subtotal: number | null; grandTotal: number | null;
};
/** Your BrickLink store: inventory and orders. */
export type Store = { inventory(): Promise<InventoryItem[]>; orders(direction: 'in' | 'out'): Promise<Order[]> };
/** A minifigure's catalog entry and sold prices (2 calls). Throws BrickLinkError with a readable message. */
export type MinifigLookup = (figNo: string, guide: 'N' | 'U', currency: string) => Promise<Omit<LookupResult, 'parts' | 'pieces' | 'partLots'>>;
/** Sold price for one part in one colour (1 call), for part-out value. avgSold is null when nothing sold. */
export type PartPrice = { avgSold: number | null; qtySold: number };
export type PartPriceLookup = (type: string, partNo: string, colorId: number | null, guide: 'N' | 'U', currency: string) => Promise<PartPrice>;
/** One sold price guide for an item, without its catalog entry (1 call). */
export type SoldPrice = { avgSold: number | null; minSold: number | null; maxSold: number | null; qtySold: number };
export type PriceLookup = (type: 'SET' | 'MINIFIG', itemNo: string, guide: 'N' | 'U', currency: string) => Promise<SoldPrice>;
export type BrickLink = { lookup: Lookup; minifig: MinifigLookup; partPrice: PartPriceLookup; price: PriceLookup; store: Store; colors(): Promise<Color[]> };

type Item = { name: string; year_released?: number; category_id?: number; image_url?: string };
type Price = { avg_price: string; min_price: string; max_price: string; total_quantity: number; unit_quantity: number };
type ApiInventory = {
  inventory_id: number; item: { no: string; name: string; type: string }; color_id?: number; color_name?: string;
  quantity: number; new_or_used: 'N' | 'U'; unit_price?: string; description?: string; remarks?: string;
};
type ApiOrder = {
  order_id: number; date_ordered?: string; status: string; buyer_name?: string; seller_name?: string;
  total_count?: number; unique_count?: number; cost?: { currency_code?: string; subtotal?: string; grand_total?: string };
};
type Subset = {
  match_no: number;
  entries: { item: { no: string; name: string; type: string }; color_id?: number; quantity: number; extra_quantity?: number; is_alternate: boolean; is_counterpart: boolean }[];
}[];
type ApiColor = { color_id: number; color_name: string; color_code?: string };

/** BrickLink sends HTML entities in names, e.g. "Flower Bouquet &#40;Botanical&#41;". */
const decode = (s: string) =>
  s.replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d))).replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const price = (s: string | undefined) => (s === undefined || s === '' ? null : Number(s)); // unrounded, like the sheet

export function createBrickLink(keys: OAuthKeys, fetchImpl: typeof fetch = fetch): BrickLink {
  let last = 0;
  async function get<T>(path: string, params: Record<string, string> = {}): Promise<T> {
    const url = BASE + path;
    for (let attempt = 0; ; attempt++) {
      const wait = last + GAP_MS - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      last = Date.now();
      const qs = new URLSearchParams(params).toString();
      let res: Response;
      try {
        res = await fetchImpl(qs ? `${url}?${qs}` : url, {
          headers: { Authorization: await oauthHeader('GET', url, params, keys) },
          signal: AbortSignal.timeout(20_000),
        });
      } catch (e) {
        throw networkError(e, path);
      }
      const retry = res.status === 429 || res.status >= 500;
      if (retry && attempt < 2) { await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt)); continue; }
      const text = await res.text().catch(() => '');
      let body: { meta?: { code: number; message: string; description?: string }; data?: T } | null = null;
      try { body = JSON.parse(text); } catch { /* not JSON: handled below */ }
      // fetch follows BrickLink's redirect to its maintenance page; a client that doesn't sees the redirect itself.
      if (/maintenance\.bricklink\.com/i.test(`${res.url} ${res.headers.get('location') ?? ''}`)) throw maintenanceError(text);
      if ((!body || typeof body !== 'object') && res.status === 429) throw brickLinkError(429, undefined, path, res.statusText); // the daily limit, whatever the body
      if (!body || typeof body !== 'object') throw unreadableReply(res.status, text, path, res.headers.has('cf-ray') && (res.status === 403 || res.status === 503));
      const code = body.meta?.code ?? res.status;
      if (code !== 200) throw brickLinkError(res.status, body.meta, path, res.statusText);
      return body.data as T;
    }
  }

  /** The sold price guide for one item (1 call). With no sales BrickLink reports 0.0000; that's "—", not $0. */
  const soldPrice: PriceLookup = async (type, itemNo, guide, currency) => {
    const p = await get<Price>(`/items/${type}/${encodeURIComponent(itemNo)}/price`, { guide_type: 'sold', new_or_used: guide, currency_code: currency });
    const sold = p.total_quantity > 0;
    return { avgSold: sold ? price(p.avg_price) : null, minSold: sold ? price(p.min_price) : null, maxSold: sold ? price(p.max_price) : null, qtySold: p.total_quantity };
  };

  /** Catalog entry and sold price guide for one item (2 calls). */
  async function item(type: 'SET' | 'MINIFIG', itemNo: string, guide: 'N' | 'U', currency: string): Promise<LookupResult> {
    const item = await get<Item>(`/items/${type}/${encodeURIComponent(itemNo)}`);
    return {
      blName: decode(item.name),
      year: item.year_released ?? null,
      categoryId: item.category_id ?? null,
      imageUrl: item.image_url ? (item.image_url.startsWith('//') ? 'https:' + item.image_url : item.image_url) : null,
      ...(await soldPrice(type, itemNo, guide, currency)),
    };
  }

  const lookup: Lookup = async (setNo, guide, currency, opts = {}) => {
    const no = encodeURIComponent(setNo);
    const out = await item('SET', setNo, guide, currency);
    if (opts.parts) {
      out.parts = (await get<Subset>(`/items/SET/${no}/subsets`)).flatMap((g) =>
        g.entries.map((e) => ({
          matchNo: g.match_no ?? 0, partNo: e.item.no, name: decode(e.item.name), type: e.item.type, colorId: e.color_id ?? null,
          qty: e.quantity, extra: e.extra_quantity ?? 0, alternate: e.is_alternate, counterpart: e.is_counterpart,
        })),
      );
      Object.assign(out, partCounts(out.parts));
    }
    return out;
  };

  const store: Store = {
    inventory: async () =>
      (await get<ApiInventory[]>('/inventories')).map((d) => ({
        inventoryId: d.inventory_id, itemNo: d.item.no, name: decode(d.item.name), type: d.item.type, colorId: d.color_id ?? null,
        colorName: d.color_name ?? null, qty: d.quantity, condition: d.new_or_used, unitPrice: price(d.unit_price),
        description: d.description || null, remarks: d.remarks || null,
      })),
    orders: async (direction) =>
      (await get<ApiOrder[]>('/orders', { direction })).map((d) => ({
        orderId: d.order_id, direction, dateOrdered: d.date_ordered ?? null, status: d.status,
        counterparty: (direction === 'in' ? d.buyer_name : d.seller_name) ?? null, items: d.total_count ?? null, lots: d.unique_count ?? null,
        currency: d.cost?.currency_code ?? null, subtotal: price(d.cost?.subtotal), grandTotal: price(d.cost?.grand_total),
      })),
  };
  const minifig: MinifigLookup = (figNo, guide, currency) => item('MINIFIG', figNo, guide, currency);
  const partPrice: PartPriceLookup = async (type, partNo, colorId, guide, currency) => {
    const params: Record<string, string> = { guide_type: 'sold', new_or_used: guide, currency_code: currency };
    if (colorId !== null && type === 'PART') params.color_id = String(colorId);
    const p = await get<Price>(`/items/${encodeURIComponent(type)}/${encodeURIComponent(partNo)}/price`, params);
    return { avgSold: p.total_quantity > 0 ? price(p.avg_price) : null, qtySold: p.total_quantity };
  };
  const colors = async () =>
    (await get<ApiColor[]>('/colors')).map((c) => ({ id: c.color_id, name: c.color_name, rgb: c.color_code || null }));
  return { lookup, minifig, partPrice, price: soldPrice, store, colors };
}

/**
 * Uses BRICKLINK_* env vars (BRICKLINK_TOKEN_VALUE, the n8n name, works too). Returns null when they
 * aren't set, so the app still works without prices.
 */
export function brickLinkFromEnv(): BrickLink | null {
  const e = process.env;
  const token = e.BRICKLINK_TOKEN || e.BRICKLINK_TOKEN_VALUE;
  if (!e.BRICKLINK_CONSUMER_KEY || !e.BRICKLINK_CONSUMER_SECRET || !token || !e.BRICKLINK_TOKEN_SECRET) return null;
  return createBrickLink({ consumerKey: e.BRICKLINK_CONSUMER_KEY, consumerSecret: e.BRICKLINK_CONSUMER_SECRET, token, tokenSecret: e.BRICKLINK_TOKEN_SECRET });
}
