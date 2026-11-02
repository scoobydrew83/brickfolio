// BrickLink Store API v1 client: catalog item, sold price guide and parts list for a set.
// Docs: https://www.bricklink.com/v3/api.page. Daily limit is 5,000 calls. A lookup uses 2, plus 1 for the
// parts list the first time (it rarely changes), like the n8n "BrickLink - Sheet Sync" workflow it replaces.
import { oauthHeader, type OAuthKeys } from './oauth';

const BASE = 'https://api.bricklink.com/api/store/v1';
const GAP_MS = 250; // spacing between calls, so a full sync doesn't burst

export class BrickLinkError extends Error {}

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
export type BrickLink = { lookup: Lookup; store: Store; colors(): Promise<Color[]> };

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
      const res = await fetchImpl(qs ? `${url}?${qs}` : url, {
        headers: { Authorization: await oauthHeader('GET', url, params, keys) },
        signal: AbortSignal.timeout(20_000),
      });
      const retry = res.status === 429 || res.status >= 500;
      if (retry && attempt < 2) { await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt)); continue; }
      const body = (await res.json().catch(() => null)) as { meta?: { code: number; message: string; description?: string }; data?: T } | null;
      const code = body?.meta?.code ?? res.status;
      if (code !== 200 || !body) throw new BrickLinkError(`${path.split('/').pop()}: ${body?.meta?.description || body?.meta?.message || res.statusText}`);
      return body.data as T;
    }
  }

  const lookup: Lookup = async (setNo, guide, currency, opts = {}) => {
    const no = encodeURIComponent(setNo);
    const item = await get<Item>(`/items/SET/${no}`);
    const p = await get<Price>(`/items/SET/${no}/price`, { guide_type: 'sold', new_or_used: guide, currency_code: currency });
    const sold = p.total_quantity > 0; // with no sales BrickLink reports 0.0000; show "—" instead of $0
    const out: LookupResult = {
      blName: decode(item.name),
      year: item.year_released ?? null,
      categoryId: item.category_id ?? null,
      imageUrl: item.image_url ? (item.image_url.startsWith('//') ? 'https:' + item.image_url : item.image_url) : null,
      avgSold: sold ? price(p.avg_price) : null,
      minSold: sold ? price(p.min_price) : null,
      maxSold: sold ? price(p.max_price) : null,
      qtySold: p.total_quantity,
    };
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
  const colors = async () =>
    (await get<ApiColor[]>('/colors')).map((c) => ({ id: c.color_id, name: c.color_name, rgb: c.color_code || null }));
  return { lookup, store, colors };
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
