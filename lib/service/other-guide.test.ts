import { beforeEach, expect, it } from 'vitest';
import type { Lookup, PriceLookup } from '../bricklink/client';
import { openNodeDb } from '../db/node';
import { priceObservations } from '../db/schema';
import type { DB } from '../db/types';
import { addCopy } from './copies';
import { refreshOtherGuide } from './other-guide';
import { recordPrice } from './prices';
import * as svc from './sets';

let db: DB;
const lookup: Lookup = async (_no, guide) => ({ blName: 'x', year: 2021, categoryId: 1, imageUrl: null, avgSold: guide === 'N' ? 50 : 20, minSold: 10, maxSold: 90, qtySold: 5 });
const calls: string[] = [];
const price: PriceLookup = async (_t, no, guide) => { calls.push(`${no}:${guide}`); return { avgSold: guide === 'N' ? 55 : 22, minSold: 1, maxSold: 99, qtySold: 7 }; };
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

beforeEach(async () => {
  db = openNodeDb(':memory:').db;
  calls.length = 0;
  await svc.addSet(db, { setNo: '10280-1', name: 'Sealed', condition: 'New' }, { lookup }); // N is its own guide → U
  await svc.addSet(db, { setNo: '10497-1', name: 'Built', condition: 'Used' }, { lookup }); // → N
  await svc.addSet(db, { setNo: '21325-1', name: 'Partial', condition: 'Partial' }, { lookup }); // Partial counts as used → N
});

it('fetches the other guide for each set, oldest first, and values copies in their own guide', async () => {
  await recordPrice(db, { itemKind: 'set', itemId: '10497-1', source: 'bricklink', type: 'sold_avg', condition: 'N', currency: 'USD', amount: 60, observedOn: daysAgo(20) });
  await recordPrice(db, { itemKind: 'set', itemId: '21325-1', source: 'bricklink', type: 'sold_avg', condition: 'N', currency: 'USD', amount: 60, observedOn: daysAgo(10) });
  expect(await refreshOtherGuide(db, price, 'USD', { maxCalls: 10 })).toEqual({ fetched: 3, errors: 0, remaining: 0 });
  expect(calls).toEqual(['10280-1:U', '10497-1:N', '21325-1:N']); // never asked first, then the oldest
  // Fresh now: nothing to do within the week.
  expect(await refreshOtherGuide(db, price, 'USD', { maxCalls: 10 })).toEqual({ fetched: 0, errors: 0, remaining: 0 });
  // A built copy added to the sealed set is valued from its own (used) guide, fetched just now.
  await addCopy(db, '10280-1', { status: 'built', condition: 'Used' });
  expect((await svc.getSet(db, '10280-1'))!.copies.map((c) => [c.estValue, c.estGuide])).toEqual([[50, 'N'], [22, 'U']]);
});

it('respects maxCalls and counts what is left', async () => {
  expect(await refreshOtherGuide(db, price, 'USD', { maxCalls: 2 })).toEqual({ fetched: 2, errors: 0, remaining: 1 });
  expect(await refreshOtherGuide(db, price, 'USD', { maxCalls: 0 })).toEqual({ fetched: 0, errors: 0, remaining: 0 });
  expect(calls).toHaveLength(2);
});

it('records failures without throwing, and stops after three in a row', async () => {
  const failing: PriceLookup = async () => { throw new Error('down'); };
  expect(await refreshOtherGuide(db, failing, 'USD', { maxCalls: 10 })).toEqual({ fetched: 0, errors: 3, remaining: 0 });
  expect((await db.select().from(priceObservations).all()).filter((r) => r.observedOn === svc.today())).toHaveLength(3); // only the primary lookups
});
