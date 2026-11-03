import { beforeEach, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { openNodeDb } from '../db/node';
import type { DB } from '../db/types';
import { setBarcodes, sets, wishlist, locations } from '../db/schema';
import { addScanned, forgetBarcode, parseScanFigs, parseScanItems, rememberBarcode, saveBricksetBarcodes, type ScanItem } from './barcodes';
import { minifigs } from '../db/schema';
import { syncRetail } from './retail';
import type { RetailSource } from '../brickset/client';

let db: DB;
beforeEach(async () => {
  db = openNodeDb(':memory:').db;
  await db.insert(locations).values([{ name: 'Display' }, { name: 'Storage' }]).onConflictDoNothing();
});
const item = (setNo: string, more: Partial<ScanItem> = {}): ScanItem => ({ setNo, qty: 1, target: 'collection', condition: 'New', location: null, ...more });
const opts = { lookup: null, minifig: null };

it('remembers and forgets a barcode', async () => {
  expect(await rememberBarcode(db, '673419264150', '75192')).toEqual({ ok: true, gtin: '0673419264150', setNo: '75192-1' });
  expect(await rememberBarcode(db, '673419264150', '75192')).toMatchObject({ ok: true }); // same again: no duplicate
  expect(await db.select().from(setBarcodes).all()).toHaveLength(1);
  expect(await rememberBarcode(db, '123', '75192')).toMatchObject({ ok: false, status: 400 });
  expect(await rememberBarcode(db, '673419264150', 'abc')).toMatchObject({ ok: false, status: 400 });
  expect(await forgetBarcode(db, '0673419264150', '75192-1')).toEqual({ ok: true, removed: 1 });
  expect(await forgetBarcode(db, '673419264150', '75192')).toMatchObject({ ok: false, status: 404 });
});

it('validates a scan batch', () => {
  const locs = ['Display'];
  expect(parseScanItems([{ setNo: '75192', qty: 2, location: 'Display' }], locs)).toEqual({ ok: true, items: [{ setNo: '75192-1', qty: 2, target: 'collection', condition: 'New', location: 'Display' }] });
  expect(parseScanItems([], locs)).toEqual({ ok: true, items: [] }); // a batch can be minifigures only
  expect(parseScanItems(null, locs).ok).toBe(false);
  expect(parseScanItems([{ setNo: '75192', qty: 0 }], locs).ok).toBe(false);
  expect(parseScanItems([{ setNo: '75192', location: 'Attic' }], locs).ok).toBe(false);
  expect(parseScanItems([{ setNo: '75192', target: 'wishlist', condition: 'Partial' }], locs).ok).toBe(false);
  expect(parseScanItems(Array.from({ length: 201 }, () => ({ setNo: '1234' })), locs).ok).toBe(false);
});

it('adds new sets, gives sets you own more copies, and fills names from the barcode provider', async () => {
  await db.insert(sets).values({ setNo: '10497-1', name: 'Galaxy Explorer', qty: 1, condition: 'New' });
  await db.insert(setBarcodes).values({ barcode: '673419264150', format: 'UPC_A', gtin: '0673419264150', setNo: '75192-1', source: 'comparethebricks', name: 'Millennium Falcon', pieces: 7541 });
  const r = await addScanned(db, [item('75192-1', { location: 'Display' }), item('10497-1', { qty: 2 }), item('75192-1')], opts);
  expect(r).toMatchObject({ ok: true, added: 1, merged: 2 }); // 75192 is in two groups (Display and none): added, then merged
  const all = await db.select().from(sets).all();
  const falcon = all.filter((s) => s.setNo === '75192-1');
  expect(falcon).toHaveLength(1); // one row; the second group merged into it
  expect(falcon[0]).toMatchObject({ name: 'Millennium Falcon', pieces: 7541, qty: 2 });
  expect(all.find((s) => s.setNo === '10497-1')?.qty).toBe(3);
});

it('adds to the wishlist and counts ones already on it', async () => {
  await db.insert(wishlist).values({ setNo: '10316-1' });
  const r = await addScanned(db, [item('10316-1', { target: 'wishlist' }), item('21325-1', { target: 'wishlist', condition: 'Used' })], opts);
  expect(r).toMatchObject({ ok: true, wished: 1, alreadyWished: 1, added: 0 });
  expect((await db.select().from(wishlist).where(eq(wishlist.setNo, '21325-1')).get())?.condition).toBe('Used');
});

it('replays a batch sent twice with the same key instead of adding it twice', async () => {
  const first = await addScanned(db, [item('75192-1')], { ...opts, key: 'k1' });
  const again = await addScanned(db, [item('75192-1')], { ...opts, key: 'k1' });
  expect(first).toMatchObject({ ok: true, added: 1 });
  expect(again).toMatchObject({ ok: true, added: 1, replayed: true });
  expect((await db.select().from(sets).all())[0].qty).toBe(1);
});

it('a failed batch writes nothing and can be retried with the same key', async () => {
  const bad = await addScanned(db, [item('75192-1'), item('10497-1', { location: 'Attic' })], { ...opts, key: 'k2' });
  expect(bad).toMatchObject({ ok: false });
  expect(await db.select().from(sets).all()).toHaveLength(0);
  expect(await addScanned(db, [item('75192-1')], { ...opts, key: 'k2' })).toMatchObject({ ok: true, added: 1 });
});

it('saves Brickset barcodes once and skips bad ones', async () => {
  expect(await saveBricksetBarcodes(db, [{ setNo: '75192-1', ean: '5702015869935', upc: '673419264150' }, { setNo: '1-1', ean: '123', upc: null }])).toBe(2);
  expect(await saveBricksetBarcodes(db, [{ setNo: '75192-1', ean: '5702015869935', upc: null }])).toBe(0);
});

it('the Brickset sync saves barcodes for owned sets', async () => {
  await db.insert(sets).values({ setNo: '75192-1', name: 'Falcon', qty: 1 });
  const src: RetailSource = {
    async check() {},
    async sets(nos) { return { found: [{ setNo: '75192-1', retail: { USD: 849.99 }, launchDate: null, exitDate: null, retired: false, ean: '5702015869935', upc: '673419264150' }], asked: nos }; },
  };
  expect(await syncRetail(db, src)).toEqual([]);
  expect((await db.select().from(setBarcodes).all()).map((r) => [r.gtin, r.source])).toEqual([['5702015869935', 'brickset'], ['0673419264150', 'brickset']]);
});

it('adds scanned minifigures in the same batch, more copies of ones you have', async () => {
  await db.insert(minifigs).values({ rbFigNo: 'fig-013525', name: 'Film Noir Detective', qty: 1 });
  const f = parseScanFigs([{ rbFigNo: 'FIG-013525', name: 'Film Noir Detective', qty: 2 }, { rbFigNo: 'fig-013520', name: 'Mermaid', imageUrl: 'javascript:x' }]);
  expect(f).toMatchObject({ ok: true, figs: [{ rbFigNo: 'fig-013525', qty: 2 }, { rbFigNo: 'fig-013520', qty: 1, imageUrl: null }] });
  if (!f.ok) return;
  const r = await addScanned(db, [], { ...opts, figs: f.figs, key: 'k3' });
  expect(r).toMatchObject({ ok: true, figsAdded: 1, figsMerged: 1 });
  expect((await db.select().from(minifigs).all()).map((m) => [m.rbFigNo, m.qty])).toEqual([['fig-013525', 3], ['fig-013520', 1]]);
  expect(parseScanFigs([{ rbFigNo: 'sw0001' }]).ok).toBe(false);
  expect(parseScanFigs(undefined)).toEqual({ ok: true, figs: [] });
});
