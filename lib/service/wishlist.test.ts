import { beforeEach, expect, it } from 'vitest';
import type { Lookup } from '../bricklink/client';
import { openNodeDb } from '../db/node';
import type { DB } from '../db/types';
import * as sets from './sets';
import * as w from './wishlist';

let db: DB;
let calls: string[];
const lookup: Lookup = async (no, guide) => {
  calls.push(`${no}:${guide}`);
  if (no === '404-1') throw new Error('item: not found');
  return { blName: `BL ${no}`, year: 2023, categoryId: 1, imageUrl: 'https://img/x.png', avgSold: guide === 'N' ? 450 : 300, minSold: 400, maxSold: 500, qtySold: 7 };
};

beforeEach(() => { db = openNodeDb(':memory:').db; calls = []; });

it('validates input', () => {
  expect(w.parseWishInput({ setNo: '10316', target: '430' })).toEqual({ ok: true, value: { setNo: '10316-1', condition: 'New', target: 430 } });
  expect(w.parseWishInput({ setNo: 'abc' }).ok).toBe(false);
  expect(w.parseWishInput({ setNo: '10316', target: '-1' }).ok).toBe(false);
  expect(w.parseWishInput({ setNo: '10316', condition: 'Partial' }).ok).toBe(false);
  expect(w.parseWishInput({ setNo: '10316', target: '' }, true)).toEqual({ ok: true, value: { setNo: '10316-1', target: null } });
});

it('adds, prices, edits and removes a wish', async () => {
  const p = w.parseWishInput({ setNo: '10316', target: '430' });
  if (!p.ok) throw new Error(p.error);
  const r = await w.addWish(db, p.value, lookup);
  expect(r).toMatchObject({ ok: true, wish: { setNo: '10316-1', name: 'BL 10316-1', avgSold: 450, target: 430, condition: 'New' } });
  expect((await w.addWish(db, p.value, lookup)).ok).toBe(false); // duplicate

  calls = [];
  await w.editWish(db, { setNo: '10316-1', target: 460 }, lookup);
  expect(calls).toEqual([]); // target only: no re-pricing
  const used = await w.editWish(db, { setNo: '10316-1', condition: 'Used' }, lookup);
  expect(used).toMatchObject({ ok: true, wish: { condition: 'Used', avgSold: 300, target: 460 } });

  expect(await w.removeWish(db, '10316')).toEqual({ ok: true });
  expect(await w.listWishlist(db)).toEqual([]);
});

it('keeps lookup errors on the wish and re-prices in the sync', async () => {
  await w.addWish(db, { setNo: '404-1', condition: 'New' }, lookup);
  expect((await w.getWish(db, '404'))?.blError).toBe('item: not found');
  await w.addWish(db, { setNo: '21325-1', condition: 'New' }, null);
  calls = [];
  expect(await w.syncWishlist(db, lookup, 'USD')).toBe(1);
  expect(calls).toEqual(['404-1:N', '21325-1:N']);
  expect((await w.getWish(db, '21325'))?.avgSold).toBe(450);
});

it('moves a wish into the collection when you get it', async () => {
  await w.addWish(db, { setNo: '10316-1', condition: 'New', target: 430 }, lookup);
  expect(await w.acquireWish(db, '10316', lookup)).toEqual({ ok: true });
  expect(await w.listWishlist(db)).toEqual([]);
  expect(await sets.getSet(db, '10316-1')).toMatchObject({ name: 'BL 10316-1', condition: 'New', qty: 1, avgSold: 450 });
  // Getting it again adds another copy.
  await w.addWish(db, { setNo: '10316-1', condition: 'New' }, lookup);
  await w.acquireWish(db, '10316-1', lookup);
  expect((await sets.getSet(db, '10316-1'))?.qty).toBe(2);
});
