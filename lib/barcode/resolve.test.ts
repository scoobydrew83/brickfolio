import { beforeEach, expect, it } from 'vitest';
import { openNodeDb } from '../db/node';
import type { DB } from '../db/types';
import { barcodeMisses, setBarcodes, sets, wishlist } from '../db/schema';
import { barcodeStats, resolveBarcode } from './resolve';
import type { BarcodeLookupProvider, ProviderResult } from './providers';
import { rememberBarcode } from '../service/barcodes';

const UPC = '673419264150'; // as on the box
const GTIN = '0673419264150';
let db: DB;
beforeEach(() => { db = openNodeDb(':memory:').db; });

const fake = (id: 'comparethebricks' | 'brickeconomy', answer: ProviderResult | (() => ProviderResult)) => {
  const p = { id, displayName: id, calls: 0, async lookup() { p.calls++; return typeof answer === 'function' ? answer() : answer; } };
  return p as BarcodeLookupProvider & { calls: number };
};
const falcon = { setNo: '75192-1', name: 'Millennium Falcon', year: 2017, pieces: 7541, theme: 'Star Wars', imageUrl: null, sourceRef: '75192-1' };
const notFound: ProviderResult = { outcome: 'not_found', message: 'nope' };

it('rejects bad barcodes before anything else', async () => {
  const p = fake('comparethebricks', notFound);
  expect(await resolveBarcode(db, '673419264151', { providers: [p] })).toMatchObject({ status: 'invalid', code: 'INVALID_BARCODE' });
  expect(p.calls).toBe(0);
});

it('asks a provider, then saves the answer so the next scan needs no call', async () => {
  const p = fake('comparethebricks', { outcome: 'found', candidates: [falcon] });
  const r = await resolveBarcode(db, UPC, { providers: [p] });
  expect(r).toMatchObject({ status: 'matched', barcode: { raw: UPC, gtin: GTIN, format: 'UPC_A' }, candidates: [{ setNo: '75192-1', name: 'Millennium Falcon', source: 'comparethebricks', verified: false, owned: null, wished: false }] });
  // The same box read as EAN-13 hits the saved row.
  const again = await resolveBarcode(db, `0${UPC}`, { providers: [p] });
  expect(again).toMatchObject({ status: 'matched', candidates: [{ setNo: '75192-1' }] });
  expect(p.calls).toBe(1);
});

it('falls back to the next provider when one is down, and only stops at a real answer', async () => {
  const down = fake('comparethebricks', { outcome: 'timeout', message: 'slow' });
  const be = fake('brickeconomy', { outcome: 'found', candidates: [falcon] });
  const r = await resolveBarcode(db, UPC, { providers: [down, be] });
  expect(r).toMatchObject({ status: 'matched', providers: [{ id: 'comparethebricks', outcome: 'timeout' }, { id: 'brickeconomy', outcome: 'found' }] });
  const thrower = { id: 'comparethebricks', displayName: 'x', lookup: async () => { throw new Error('boom'); } } as BarcodeLookupProvider;
  expect(await resolveBarcode(db, '5702015869935', { providers: [thrower] })).toMatchObject({ status: 'not_found', providers: [{ outcome: 'network' }] });
});

it('doesn’t pick between two different sets, and doesn’t save them', async () => {
  const p = fake('brickeconomy', { outcome: 'found', candidates: [falcon, { ...falcon, setNo: '10179-1', name: 'UCS Falcon' }, falcon] });
  const r = await resolveBarcode(db, UPC, { providers: [p] });
  expect(r.status).toBe('ambiguous');
  if (r.status !== 'invalid') expect(r.candidates.map((c) => c.setNo)).toEqual(['75192-1', '10179-1']);
  expect(await db.select().from(setBarcodes).all()).toHaveLength(0);
});

it('remembers a miss only when every provider said not found', async () => {
  const down = fake('comparethebricks', { outcome: 'network', message: 'x' });
  await resolveBarcode(db, UPC, { providers: [down] });
  expect(await db.select().from(barcodeMisses).all()).toHaveLength(0);

  const miss = fake('comparethebricks', notFound);
  expect(await resolveBarcode(db, UPC, { providers: [miss] })).toMatchObject({ status: 'not_found' });
  expect(await resolveBarcode(db, UPC, { providers: [miss] })).toMatchObject({ status: 'not_found', cachedMiss: true });
  expect(miss.calls).toBe(1);
  await resolveBarcode(db, UPC, { providers: [miss], refresh: true });
  expect(miss.calls).toBe(2);
});

it('prefers a barcode you confirmed over what a provider said', async () => {
  await db.insert(setBarcodes).values({ barcode: UPC, format: 'UPC_A', gtin: GTIN, setNo: '10179-1', source: 'comparethebricks' });
  await rememberBarcode(db, UPC, '75192');
  const r = await resolveBarcode(db, UPC, { providers: [] });
  expect(r).toMatchObject({ status: 'matched', candidates: [{ setNo: '75192-1', source: 'user', verified: true }] });
});

it('says when you own or want the set, with the collection’s name and photo', async () => {
  await rememberBarcode(db, UPC, '75192-1');
  await db.insert(sets).values({ setNo: '75192-1', name: 'My Falcon', qty: 2, condition: 'New', location: null, imageUrl: 'https://img/x.png' });
  await db.insert(wishlist).values({ setNo: '75192-1' });
  const r = await resolveBarcode(db, UPC, { providers: [] });
  expect(r).toMatchObject({ candidates: [{ name: 'My Falcon', imageUrl: 'https://img/x.png', owned: { qty: 2, condition: 'New' }, wished: true }] });
});

it('with no providers, a new barcode is simply not found (no call, no miss saved)', async () => {
  expect(await resolveBarcode(db, UPC, { providers: [] })).toMatchObject({ status: 'not_found', noProviders: true });
  expect(await db.select().from(barcodeMisses).all()).toHaveLength(0);
});

it('read-only lookups never write', async () => {
  const p = fake('comparethebricks', { outcome: 'found', candidates: [falcon] });
  expect(await resolveBarcode(db, UPC, { providers: [p], readOnly: true })).toMatchObject({ status: 'not_found' });
  expect(p.calls).toBe(0);
  expect(await barcodeStats(db)).toEqual({ total: 0, user: 0, community: 0, brickset: 0, providers: 0 });
});

it('builds an offline map that resolves like the server does', async () => {
  const { offlineMap } = await import('./resolve');
  const { localResolve } = await import('./offline');
  await db.insert(setBarcodes).values({ barcode: UPC, format: 'UPC_A', gtin: GTIN, setNo: '10179-1', source: 'comparethebricks', name: 'UCS Falcon' });
  await rememberBarcode(db, UPC, '75192');
  await db.insert(sets).values({ setNo: '75192-1', name: 'My Falcon', qty: 2 });
  const map = JSON.parse(JSON.stringify(await offlineMap(db))); // as it travels to the browser
  const b = { raw: UPC, format: 'UPC_A' as const, gtin: GTIN };
  const server = await resolveBarcode(db, UPC, { providers: [], readOnly: true });
  const local = localResolve(map, b);
  expect(local).toMatchObject({ status: 'matched', candidates: [{ setNo: '75192-1', name: 'My Falcon', source: 'user', owned: { qty: 2 } }] });
  if (server.status !== 'invalid') expect(local?.candidates.map((c) => c.setNo)).toEqual(server.candidates.map((c) => c.setNo));
  expect(localResolve(map, { raw: '5702015869935', format: 'EAN_13', gtin: '5702015869935' })).toBeNull();
});
