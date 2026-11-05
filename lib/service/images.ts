// Set and minifigure photos served from our own origin, so share pages and the offline Scan page don't load them from
// BrickLink. The upstream URL is always the one stored on the item, never one from the request: the image routes
// can't be used to fetch anything else.
import { and, eq, isNotNull, or } from 'drizzle-orm';
import type { DB } from '../db/types';
import { minifigs, sets } from '../db/schema';
import type { ImageStore } from '../images/cache';
import { sha256Hex } from './tokens';

export type ImageKind = 'set' | 'minifig';
export type Image = { body: ArrayBuffer; type: string };
type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

/** The same hosts as images.remotePatterns in next.config.ts. */
const ALLOWED = ['https://img.bricklink.com/', 'https://cdn.rebrickable.com/'];
export const MAX_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 10_000;
/** Raster types only: an SVG served from our own origin could run script. */
const TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif']);

export const isImageKind = (v: string): v is ImageKind => v === 'set' || v === 'minifig';
export const allowedImageUrl = (url: string | null | undefined): url is string => !!url && ALLOWED.some((h) => url.startsWith(h));

/** The stored photo URL for an item: a set by number, a minifigure by BrickLink or Rebrickable number. */
export async function imageUrlFor(db: DB, kind: ImageKind, no: string): Promise<string | null> {
  if (kind === 'set') {
    return (await db.select({ url: sets.imageUrl }).from(sets).where(eq(sets.setNo, no)).get())?.url ?? null;
  }
  const n = no.toLowerCase();
  return (await db.select({ url: minifigs.imageUrl }).from(minifigs).where(or(eq(minifigs.figNo, n), eq(minifigs.rbFigNo, n))).get())?.url ?? null;
}

/** The store key: item number (made path-safe) plus a hash of the URL, so a new URL on BrickLink gets a new key. */
export async function imageKey(kind: ImageKind, no: string, url: string): Promise<string> {
  let safe = no.toLowerCase().replace(/[^a-z0-9._-]/g, '_').slice(0, 64);
  if (!/^[a-z0-9]/.test(safe)) safe = `x${safe}`.slice(0, 64);
  return `${kind}/${safe}/${(await sha256Hex(url)).slice(0, 12)}`;
}

/** Fetches an allowed image, or null for a failed, oversized or non-image answer. */
async function download(url: string, fetcher: Fetcher): Promise<Image | null> {
  const res = await fetcher(url, { signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'error' });
  const type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  if (!res.ok || !TYPES.has(type)) return null;
  if (Number(res.headers.get('content-length') ?? 0) > MAX_BYTES) return null;
  const body = await res.arrayBuffer();
  return body.byteLength > MAX_BYTES ? null : { body, type };
}

export type CachedImage = { status: 'ok'; image: Image } | { status: 'missing' } | { status: 'failed' };

/**
 * An item's photo: from the store when it's there, else fetched from the stored URL (and kept when there's a store). A stored
 * type outside the raster list is never served.
 * 'missing' when the item is unknown or has no allowed URL, 'failed' when the fetch didn't give an image.
 */
export async function cachedImage(db: DB, store: ImageStore | null, kind: ImageKind, no: string, fetcher: Fetcher = fetch): Promise<CachedImage> {
  const url = await imageUrlFor(db, kind, no);
  if (!allowedImageUrl(url)) return { status: 'missing' };
  const key = await imageKey(kind, no, url);
  const hit = await store?.get(key).catch(() => null);
  if (hit && TYPES.has(hit.type)) return { status: 'ok', image: hit };
  const image = await download(url, fetcher).catch(() => null);
  if (!image) return { status: 'failed' };
  await store?.put(key, image.body, image.type).catch((e) => console.error('Image cache write failed', e));
  return { status: 'ok', image };
}

/** The number of photos the sync fills in per run (IMAGE_CACHE_WARM, default 200, 0 = off). */
export const warmLimit = () => {
  const n = Number(process.env.IMAGE_CACHE_WARM ?? 200);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 200;
};

/**
 * Fills the store with photos it doesn't have yet, up to `max`. These are CDN fetches, not BrickLink API calls, so
 * they don't count against the daily budget; they're spaced out a little anyway. Returns the error messages.
 */
export async function warmImages(db: DB, store: ImageStore, { max = warmLimit(), fetcher = fetch as Fetcher, gapMs = 100 } = {}): Promise<{ fetched: number; errors: string[] }> {
  if (max <= 0) return { fetched: 0, errors: [] };
  const items: { kind: ImageKind; no: string; url: string }[] = [
    ...(await db.select({ no: sets.setNo, url: sets.imageUrl }).from(sets).where(isNotNull(sets.imageUrl)).all())
      .map((r) => ({ kind: 'set' as const, no: r.no, url: r.url! })),
    ...(await db.select({ fig: minifigs.figNo, rb: minifigs.rbFigNo, url: minifigs.imageUrl }).from(minifigs)
      .where(and(isNotNull(minifigs.imageUrl), or(isNotNull(minifigs.figNo), isNotNull(minifigs.rbFigNo)))).all())
      .map((r) => ({ kind: 'minifig' as const, no: (r.fig ?? r.rb)!, url: r.url! })),
  ].filter((i) => allowedImageUrl(i.url));
  let fetched = 0, failed = 0;
  for (const i of items) {
    if (fetched + failed >= max) break;
    const key = await imageKey(i.kind, i.no, i.url);
    if (await store.get(key).catch(() => null)) continue;
    if (fetched + failed > 0 && gapMs) await new Promise((r) => setTimeout(r, gapMs));
    const image = await download(i.url, fetcher).catch(() => null);
    if (!image) { failed++; continue; }
    try {
      await store.put(key, image.body, image.type);
      fetched++;
    } catch (e) {
      return { fetched, errors: [`Image cache: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300)] };
    }
  }
  return { fetched, errors: failed ? [`Image cache: ${failed} photo${failed === 1 ? '' : 's'} couldn't be fetched`] : [] };
}

/** A served photo. Browsers keep it a week: the route's URL doesn't change when BrickLink's does, so not "immutable". */
export function imageResponse(r: CachedImage): Response {
  if (r.status === 'ok') {
    return new Response(r.image.body, {
      headers: { 'Content-Type': r.image.type, 'Cache-Control': 'private, max-age=604800', 'X-Content-Type-Options': 'nosniff' },
    });
  }
  return new Response(r.status === 'missing' ? 'Not found.' : 'Photo unavailable.', { status: r.status === 'missing' ? 404 : 502, headers: { 'Cache-Control': 'no-store' } });
}
