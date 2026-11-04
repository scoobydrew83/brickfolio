import { beforeEach, expect, it } from 'vitest';
import type { Lookup, PartPriceLookup } from '../bricklink/client';
import { openNodeDb } from '../db/node';
import type { DB } from '../db/types';
import { partout, partoutBudget, refreshPartPrices, unpricedLots } from './partout';
import { saveMissing } from './missing';
import * as svc from './sets';

let db: DB;
let asked: string[];
// 3 lots: 10 × 3001 red, 4 × 3002 blue, 1 minifig; plus an alternate that never counts.
const lookup: Lookup = async (no, _guide, _c, opts) => ({
  blName: `BL ${no}`, year: 2020, categoryId: 1, imageUrl: null, avgSold: 100, minSold: 80, maxSold: 120, qtySold: 3,
  ...(opts?.parts ? { parts: [
    { matchNo: 0, partNo: '3001', name: 'Brick 2x4', type: 'PART', colorId: 5, qty: 10, extra: 0, alternate: false, counterpart: false },
    { matchNo: 0, partNo: '3002', name: 'Brick 2x3', type: 'PART', colorId: 7, qty: 4, extra: 0, alternate: false, counterpart: false },
    { matchNo: 0, partNo: 'sw0001', name: 'Luke', type: 'MINIFIG', colorId: null, qty: 1, extra: 0, alternate: false, counterpart: false },
    { matchNo: 1, partNo: '3003', name: 'Alt', type: 'PART', colorId: 5, qty: 1, extra: 0, alternate: true, counterpart: false },
  ] } : {}),
});
const price: PartPriceLookup = async (type, no, color, guide) => {
  asked.push(`${type}:${no}:${color}:${guide}`);
  if (no === '3002') return { avgSold: null, qtySold: 0 }; // nothing sold
  return { avgSold: no === 'sw0001' ? 20 : 0.5, qtySold: 10 };
};
beforeEach(async () => {
  db = openNodeDb(':memory:').db; asked = [];
  await svc.addSet(db, { setNo: '10497-1', name: 'Galaxy', condition: 'Used' }, { lookup });
});

it('prices parts once, caps calls, and works out part-out value and coverage', async () => {
  const s = (await svc.getSet(db, '10497-1'))!;
  expect(await partout(db, s.id, s.condition, 'USD')).toMatchObject({ value: 0, lots: 3, pricedLots: 0, coverage: 0 });
  expect(await unpricedLots(db, s.id, s.condition, 'USD')).toBe(3);

  expect(await refreshPartPrices(db, price, 'USD', { maxCalls: 2 })).toEqual({ fetched: 2, errors: 0, remaining: 1 });
  await refreshPartPrices(db, price, 'USD', { maxCalls: 10 });
  expect(asked).toEqual(['PART:3001:5:U', 'PART:3002:7:U', 'MINIFIG:sw0001:null:U']); // no alternates, no repeats
  const p = await partout(db, s.id, s.condition, 'USD');
  expect(p).toMatchObject({ guide: 'U', value: 25, lots: 3, pricedLots: 3, soldLots: 2, pieces: 15, pricedPieces: 15, coverage: 100 });

  asked = [];
  await refreshPartPrices(db, price, 'USD', { maxCalls: 10 });
  expect(asked).toEqual([]); // cached for 30 days
});

it('weights Missing % by part price once the set is priced', async () => {
  await saveMissing(db, '10497-1', null, [{ partNo: 'sw0001', colorId: null, type: 'MINIFIG', qty: 1 }]);
  expect((await svc.getSet(db, '10497-1'))!.missingPct).toBe(6.7); // 1 of 15 pieces, before part prices
  await refreshPartPrices(db, price, 'USD', { maxCalls: 10 });
  await saveMissing(db, '10497-1', null, [{ partNo: 'sw0001', colorId: null, type: 'MINIFIG', qty: 1 }]);
  expect((await svc.getSet(db, '10497-1'))!.missingPct).toBe(80); // the minifig is $20 of $25
});

it('leaves room in the daily budget', () => {
  expect(partoutBudget(100, 1500)).toBe(1500);
  expect(partoutBudget(4000, 1500)).toBe(500);
  expect(partoutBudget(4800, 1500)).toBe(0);
});
