import { beforeEach, expect, it } from 'vitest';
import type { Lookup } from '../bricklink/client';
import type { BsSet, RetailSource } from '../brickset/client';
import { openNodeDb } from '../db/node';
import type { DB } from '../db/types';
import { collectionGain, pickRetail, retailGain, retailStats, retirement, syncRetail } from './retail';
import * as svc from './sets';
import * as wish from './wishlist';

let db: DB;
const lookup: Lookup = async () => ({ blName: 'BL', year: 2022, categoryId: 1, imageUrl: null, avgSold: 120, minSold: 100, maxSold: 140, qtySold: 3 });
const known: Record<string, BsSet> = {
  '10497-1': { setNo: '10497-1', retail: { USD: 99.99, GBP: 89.99 }, launchDate: '2022-08-01', exitDate: '2099-12-31', retired: false },
  '10316-1': { setNo: '10316-1', retail: { USD: 499.99 }, launchDate: '2023-03-01', exitDate: new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10), retired: false },
  '6080-1': { setNo: '6080-1', retail: {}, launchDate: null, exitDate: null, retired: true },
};
let asked: string[][];
const src: RetailSource = {
  async check() {},
  async sets(nos, opts) { asked.push(nos); const take = nos.slice(0, (opts?.maxCalls ?? 99) * 2); return { found: take.flatMap((n) => (known[n] ? [known[n]] : [])), asked: take }; },
};

beforeEach(() => { db = openNodeDb(':memory:').db; asked = []; });

it('stores retail prices and dates for sets and wishes, and waits 30 days to ask again', async () => {
  for (const setNo of ['10497-1', '6080-1', '1234-1']) await svc.addSet(db, { setNo, name: 'Test', condition: 'New' }, { lookup });
  await wish.addWish(db, { setNo: '10316-1', name: 'Rivendell', target: 430 }, null);
  expect(await syncRetail(db, src)).toEqual([]);
  expect(asked[0].sort()).toEqual(['10316-1', '10497-1', '1234-1', '6080-1']);
  const byNo = Object.fromEntries((await svc.listSets(db)).map((s) => [s.setNo, s]));
  expect(byNo['10497-1']).toMatchObject({ retailPrice: 99.99, retailCurrency: 'USD', launchDate: '2022-08-01', retired: false });
  expect(byNo['6080-1']).toMatchObject({ retailPrice: null, retired: true });
  expect(byNo['1234-1']).toMatchObject({ retailPrice: null, retired: null }); // unknown on Brickset, but checked
  expect(await wish.getWish(db, '10316-1')).toMatchObject({ retailPrice: 499.99, retired: false });

  asked = [];
  await syncRetail(db, src);
  expect(asked).toEqual([]); // everything was checked just now
  expect(await retailStats(db)).toMatchObject({ sets: 3, withRetail: 1, retired: 1, notChecked: 0 });
});

it('leaves sets it ran out of calls for unchecked', async () => {
  for (const setNo of ['1-1', '2-1', '3-1']) await svc.addSet(db, { setNo, name: 'Test', condition: 'New' }, { lookup });
  await syncRetail(db, src, { maxCalls: 1 }); // the stub answers two sets per call
  expect((await retailStats(db)).notChecked).toBe(1);
});

it('picks the collection currency when Brickset has it, else US dollars', () => {
  expect(pickRetail(known['10497-1'], 'GBP')).toEqual({ price: 89.99, currency: 'GBP' });
  expect(pickRetail(known['10497-1'], 'AUD')).toEqual({ price: 99.99, currency: 'USD' });
  expect(pickRetail(known['6080-1'], 'USD')).toBeNull();
});

it('works out gain over retail and the retirement watch', () => {
  expect(retailGain({ retailPrice: 100, retailCurrency: 'USD', estValue: 120 }, 'USD')).toEqual({ retail: 100, gainPct: 20 });
  expect(retailGain({ retailPrice: 100, retailCurrency: 'USD', estValue: 120 }, 'EUR')).toBeNull(); // different currency
  expect(retirement({ exitDate: '2026-12-31' }, '2026-11-02')).toEqual({ kind: 'retiring', date: '2026-12-31' });
  expect(retirement({ exitDate: '2028-12-31' }, '2026-11-02')).toBeNull();
  expect(retirement({ exitDate: '2025-12-31' }, '2026-11-02')).toEqual({ kind: 'retired', date: '2025-12-31' });
  expect(retirement({ retired: true }, '2026-11-02')).toEqual({ kind: 'retired', date: null });
  expect(collectionGain([{ retailPrice: 100, retailCurrency: 'USD', estValue: 150, qty: 2 }, { retailPrice: 50, retailCurrency: 'USD', estValue: 40, qty: 1 }, { estValue: 10, qty: 1 }], 'USD'))
    .toEqual({ sets: 2, retail: 250, value: 340, gainPct: 36 });
});
