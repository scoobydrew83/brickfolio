import { beforeEach, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { openNodeDb } from '../db/node';
import { minifigs, sets } from '../db/schema';
import type { DB } from '../db/types';
import type { ImageStore } from '../images/cache';
import { cachedImage, imageKey, imageResponse, MAX_BYTES, warmImages } from './images';

vi.mock('server-only', () => ({}));

let db: DB;
const URL1 = 'https://img.bricklink.com/ItemImage/SN/0/10280-1.png';

const memStore = () => {
  const m = new Map<string, { body: ArrayBuffer; type: string }>();
  const store: ImageStore = {
    kind: 'disk',
    get: async (k) => m.get(k) ?? null,
    put: async (k, body, type) => { m.set(k, { body, type }); },
    stats: async () => ({ count: m.size, bytes: [...m.values()].reduce((n, v) => n + v.body.byteLength, 0) }),
    clear: async () => m.clear(),
  };
  return { m, store };
};
const png = (n = 4, type = 'image/png', status = 200) => vi.fn(async (_url: string, _init: RequestInit) =>
  new Response(new Uint8Array(n), { status, headers: { 'content-type': type } }));

beforeEach(async () => {
  db = openNodeDb(':memory:').db;
  await db.insert(sets).values({ setNo: '10280-1', name: 'Flower Bouquet', imageUrl: URL1 });
  await db.insert(minifigs).values({ figNo: 'sw0001', name: 'Battle Droid', imageUrl: 'https://img.bricklink.com/ItemImage/MN/0/sw0001.png' });
  await db.insert(minifigs).values({ rbFigNo: 'fig-000123', name: 'CMF', imageUrl: 'https://cdn.rebrickable.com/media/sets/fig-000123.jpg' });
});

it('fetches once, then serves from the store', async () => {
  const { store, m } = memStore();
  const f = png();
  expect((await cachedImage(db, store, 'set', '10280-1', f)).status).toBe('ok');
  expect((await cachedImage(db, store, 'set', '10280-1', f)).status).toBe('ok');
  expect(f).toHaveBeenCalledTimes(1);
  expect(f.mock.calls[0][0]).toBe(URL1);
  expect([...m.keys()]).toEqual([await imageKey('set', '10280-1', URL1)]);
});

it('finds minifigures by BrickLink or Rebrickable number', async () => {
  const f = png();
  expect((await cachedImage(db, null, 'minifig', 'sw0001', f)).status).toBe('ok');
  expect((await cachedImage(db, null, 'minifig', 'fig-000123', f)).status).toBe('ok');
});

it('passes through without a store', async () => {
  const f = png();
  await cachedImage(db, null, 'set', '10280-1', f);
  await cachedImage(db, null, 'set', '10280-1', f);
  expect(f).toHaveBeenCalledTimes(2);
});

it('never fetches an unknown item or a host outside the list', async () => {
  const f = png();
  expect(await cachedImage(db, null, 'set', '99999-1', f)).toEqual({ status: 'missing' });
  await db.update(sets).set({ imageUrl: 'https://evil.example/x.png' }).where(eq(sets.setNo, '10280-1'));
  expect(await cachedImage(db, null, 'set', '10280-1', f)).toEqual({ status: 'missing' });
  await db.update(sets).set({ imageUrl: 'https://img.bricklink.com.evil.example/x.png' }).where(eq(sets.setNo, '10280-1'));
  expect(await cachedImage(db, null, 'set', '10280-1', f)).toEqual({ status: 'missing' });
  expect(f).not.toHaveBeenCalled();
});

it("doesn't keep oversized, non-image, SVG or failed answers", async () => {
  const { store, m } = memStore();
  for (const f of [png(MAX_BYTES + 1), png(4, 'text/html'), png(4, 'image/svg+xml'), png(4, 'image/png', 500)]) {
    expect(await cachedImage(db, store, 'set', '10280-1', f)).toEqual({ status: 'failed' });
  }
  expect(m.size).toBe(0);
  const thrower = vi.fn(async () => { throw new Error('offline'); });
  expect(await cachedImage(db, store, 'set', '10280-1', thrower)).toEqual({ status: 'failed' });
});

it('uses a new key when the URL changes', async () => {
  const { store, m } = memStore();
  await cachedImage(db, store, 'set', '10280-1', png());
  await db.update(sets).set({ imageUrl: 'https://img.bricklink.com/ItemImage/SN/1/10280-1.png' }).where(eq(sets.setNo, '10280-1'));
  await cachedImage(db, store, 'set', '10280-1', png());
  expect(m.size).toBe(2);
});

it('makes path-safe keys', async () => {
  expect(await imageKey('set', 'ABC/../1', URL1)).toMatch(/^set\/abc_.._1\/[0-9a-f]{12}$/);
  expect(await imageKey('set', '.x', URL1)).toMatch(/^set\/x\.x\//);
});

it('warms up to max uncached photos and reports failures', async () => {
  const { store, m } = memStore();
  const r = await warmImages(db, store, { max: 2, fetcher: png(), gapMs: 0 });
  expect(r).toEqual({ fetched: 2, errors: [] });
  expect(m.size).toBe(2);
  const again = await warmImages(db, store, { max: 5, fetcher: png(4, 'text/html'), gapMs: 0 });
  expect(again).toEqual({ fetched: 0, errors: ["Image cache: 1 photo couldn't be fetched"] });
  expect(await warmImages(db, store, { max: 0, fetcher: png() })).toEqual({ fetched: 0, errors: [] });
});

it('answers 404 / 502 without caching', async () => {
  expect(imageResponse({ status: 'missing' }).status).toBe(404);
  const r = imageResponse({ status: 'failed' });
  expect([r.status, r.headers.get('cache-control')]).toEqual([502, 'no-store']);
  const ok = imageResponse({ status: 'ok', image: { body: new ArrayBuffer(1), type: 'image/png' } });
  expect([ok.headers.get('content-type'), ok.headers.get('x-content-type-options')]).toEqual(['image/png', 'nosniff']);
});
