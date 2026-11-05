import { beforeEach, expect, it } from 'vitest';
import type { Lookup } from '../bricklink/client';
import { openNodeDb } from '../db/node';
import { priceObservations } from '../db/schema';
import type { DB } from '../db/types';
import { addCopy, refreshEstValues, removeCopy } from './copies';
import { latestBySource, latestGuide, parseSource, primarySource, recentAmount, recordPrice, recordPrices, setPrimarySource, sourceLabel, valueSources } from './prices';
import * as svc from './sets';

let db: DB;
const lookup: Lookup = async (_no, guide) => ({ blName: 'x', year: 2021, categoryId: 1, imageUrl: null, avgSold: guide === 'N' ? 50 : 20, minSold: 10, maxSold: 90, qtySold: 5 });
const base = { itemKind: 'set', itemId: '10280-1', type: 'sold_avg', condition: 'N', currency: 'USD' } as const;
const get = async () => (await svc.getSet(db, '10280-1'))!;

beforeEach(() => { db = openNodeDb(':memory:').db; });

it('validates sources', () => {
  for (const s of ['bricklink', 'BrickOwl', 'manual', 'retailer:lego', 'retailer:target-us']) expect(parseSource(s)).toBe(s.toLowerCase());
  for (const s of ['', 'foo', 'retailer:', 'retailer:-x', 'retailer:a b', 'retailer:LEGO!']) expect(parseSource(s)).toBeNull();
  expect(sourceLabel('retailer:target-us')).toBe('Target Us');
  expect(sourceLabel('brickeconomy')).toBe('BrickEconomy');
});

it('keeps one row per source, type, condition, currency and day; a later write replaces it', async () => {
  await recordPrice(db, { ...base, source: 'bricklink', amount: 40, observedOn: '2026-11-01' });
  await recordPrice(db, { ...base, source: 'bricklink', amount: 42, sampleSize: 7, observedOn: '2026-11-01' });
  await recordPrices(db, [
    { ...base, source: 'bricklink', condition: 'U', amount: 20, observedOn: '2026-11-01' },
    { ...base, source: 'brickowl', type: 'asking', amount: 45, observedOn: '2026-11-01' },
    { ...base, source: 'bricklink', currency: 'eur', amount: 39, observedOn: '2026-11-01' },
    { ...base, source: 'bricklink', amount: 41, observedOn: '2026-10-25' },
  ]);
  const rows = await db.select().from(priceObservations).all();
  expect(rows).toHaveLength(5);
  expect(rows.find((r) => r.source === 'bricklink' && r.condition === 'N' && r.currency === 'USD' && r.observedOn === '2026-11-01')).toMatchObject({ amount: 42, sampleSize: 7 });
  expect(rows.find((r) => r.currency === 'EUR')).toBeTruthy();

  const latest = await latestBySource(db, 'set', '10280-1', 'USD');
  expect(latest.map((r) => `${r.source} ${r.type} ${r.condition} ${r.amount}`).sort())
    .toEqual(['bricklink sold_avg N 42', 'bricklink sold_avg U 20', 'brickowl asking N 45']);
  expect(await recentAmount(db, 'set', '10280-1', { source: 'bricklink', condition: 'N', currency: 'USD', since: '2026-11-02' })).toBeNull();
  expect((await recentAmount(db, 'set', '10280-1', { source: 'bricklink', condition: 'N', currency: 'USD' }))?.amount).toBe(42);
});

it('keeps history when a set is removed and added again', async () => {
  await svc.addSet(db, { setNo: '10280-1', name: 'x', condition: 'Used' }, { lookup });
  expect(await svc.priceHistory(db, '10280-1')).toHaveLength(1);
  const [c] = (await get()).copies;
  await removeCopy(db, c.id);
  expect(await svc.getSet(db, '10280-1')).toBeUndefined();
  await svc.addSet(db, { setNo: '10280-1', name: 'x', condition: 'Used' }, { lookup: null });
  expect(await svc.priceHistory(db, '10280-1')).toEqual([{ date: svc.today(), guide: 'U', avgSold: 20, minSold: 10, maxSold: 90, qtySold: 5 }]);
  expect(await latestGuide(db, 'set', '10280-1')).toBe('U');
});

it('values copies from the primary source only, never mixing in BrickLink', async () => {
  await svc.addSet(db, { setNo: '10280-1', name: 'x', condition: 'New' }, { lookup }); // sealed, BrickLink N = 50
  await addCopy(db, '10280-1', { status: 'built', condition: 'Used' });
  expect(await primarySource(db)).toBe('bricklink');
  expect(await valueSources(db)).toEqual(['bricklink']);
  expect(await setPrimarySource(db, 'brickeconomy', refreshEstValues)).toMatchObject({ ok: false, status: 400 }); // no values yet
  expect(await setPrimarySource(db, 'nope', refreshEstValues)).toMatchObject({ ok: false, status: 400 });

  await recordPrice(db, { ...base, source: 'brickeconomy', type: 'estimate', amount: 61 }); // new only
  await recordPrice(db, { ...base, source: 'brickeconomy', type: 'retail', condition: 'U', amount: 99 }); // not a value type
  expect(await valueSources(db)).toEqual(['bricklink', 'brickeconomy']);
  expect(await setPrimarySource(db, 'brickeconomy', refreshEstValues)).toEqual({ ok: true, source: 'brickeconomy' });
  let s = await get();
  expect(s.copies.map((c) => [c.status, c.estValue, c.estGuide])).toEqual([['sealed', 61, 'N'], ['built', null, null]]);
  expect(s.valueTotal).toBe(61);

  expect(await setPrimarySource(db, 'bricklink', refreshEstValues)).toEqual({ ok: true, source: 'bricklink' });
  s = await get();
  expect(s.copies.map((c) => c.estValue)).toEqual([50, 50]); // sealed N 50; built falls back to today's N price, as before
});

it('parses observation filters', async () => {
  const { observationFilters } = await import('./prices');
  expect(observationFilters('http://x/?source=BrickOwl&type=asking')).toEqual({ ok: true, value: { source: 'brickowl', type: 'asking' } });
  expect(observationFilters('http://x/')).toEqual({ ok: true, value: {} });
  expect(observationFilters('http://x/?source=nope').ok).toBe(false);
  expect(observationFilters('http://x/?type=cheap').ok).toBe(false);
});

it("doesn't count a copy without a value as worth 0", async () => {
  await svc.addSet(db, { setNo: '10280-1', name: 'x', condition: 'New', copy: { pricePaid: 40 } }, { lookup });
  await addCopy(db, '10280-1', { status: 'built', condition: 'Used', pricePaid: 30 });
  await recordPrice(db, { ...base, source: 'brickeconomy', type: 'estimate', amount: 61 });
  await setPrimarySource(db, 'brickeconomy', refreshEstValues);
  const s = await get();
  expect(s).toMatchObject({ valueTotal: 61, estValue: 61, costBasis: 70, gain: null }); // the built copy has no value
  const { totals } = await import('../sets');
  expect(totals([s])).toMatchObject({ estValue: 61, costBasis: null, gain: null });
});
