import { beforeEach, expect, it } from 'vitest';
import type { Lookup, SetPart } from '../bricklink/client';
import { openNodeDb } from '../db/node';
import type { DB } from '../db/types';
import { ensureColors, listSetParts, partTypes, replaceParts, searchParts } from './parts';
import { addSet, getSet, refreshParts, relookup, removeOne } from './sets';

let db: DB;
const part = (partNo: string, o: Partial<SetPart> = {}): SetPart => ({ matchNo: 0, partNo, name: `Part ${partNo}`, type: 'PART', colorId: 5, qty: 2, extra: 0, alternate: false, counterpart: false, ...o });
let partsCalls = 0;
const lookup: Lookup = async (_no, _g, _c, opts) => {
  if (opts?.parts) partsCalls++;
  const parts = [part('3001'), part('3002', { qty: 3 }), part('fig1', { type: 'MINIFIG', colorId: null, qty: 1 }), part('3003', { matchNo: 1, alternate: true, qty: 9 })];
  return { blName: 'x', year: null, categoryId: null, imageUrl: null, avgSold: 1, minSold: 1, maxSold: 1, qtySold: 1, ...(opts?.parts ? { parts } : {}) };
};

beforeEach(() => { db = openNodeDb(':memory:').db; partsCalls = 0; });

it('stores the parts list once, counts pieces like the sheet, and refreshes on request', async () => {
  await addSet(db, { setNo: '10280-1', name: 'Bouquet', condition: 'Used' }, { lookup });
  expect(await getSet(db, '10280-1')).toMatchObject({ pieces: 6, partLots: 4 }); // 2+3+1, alternate skipped
  await relookup(db, '10280-1', lookup);
  expect(partsCalls).toBe(1); // already stored: not fetched again
  await refreshParts(db, '10280-1', lookup);
  expect(partsCalls).toBe(2);
  const s = (await getSet(db, '10280-1'))!;
  expect((await listSetParts(db, s.id)).map((p) => p.partNo)).toEqual(['fig1', '3001', '3002', '3003']); // regular first, alternates last
});

it('joins color names, searches across sets, and drops parts with their set', async () => {
  await addSet(db, { setNo: '10280-1', name: 'Bouquet', condition: 'Used' }, { lookup });
  await addSet(db, { setNo: '75379-1', name: 'R2-D2', condition: 'Used' }, { lookup });
  await ensureColors(db, async () => [{ id: 5, name: 'Red', rgb: 'B40000' }]);
  await ensureColors(db, async () => { throw new Error('should not be called again'); });
  const r2 = (await getSet(db, '75379-1'))!;
  expect((await listSetParts(db, r2.id))[1]).toMatchObject({ partNo: '3001', colorName: 'Red', rgb: 'B40000' });

  expect((await searchParts(db, { q: '3001' })).total).toBe(2);
  expect((await searchParts(db, { q: 'red' })).total).toBe(6); // by color name
  expect((await searchParts(db, { q: 'r2-d2' })).total).toBe(0); // set name isn't searched; set # is
  expect((await searchParts(db, { q: '75379' })).total).toBe(4);
  expect((await searchParts(db, { type: 'MINIFIG' })).parts.map((p) => p.setNo)).toEqual(['10280-1', '75379-1']);
  expect((await searchParts(db, { limit: 3, offset: 6 })).parts).toHaveLength(2);
  expect(await partTypes(db)).toEqual(['MINIFIG', 'PART']);

  await removeOne(db, '75379-1');
  expect((await searchParts(db, {})).total).toBe(4); // cascade
});

it('inserts long parts lists in chunks under the D1 limit', async () => {
  await addSet(db, { setNo: '1-1', name: 'Big', condition: 'New' }, { lookup: null });
  const s = (await getSet(db, '1-1'))!;
  await replaceParts(db, s.id, Array.from({ length: 1500 }, (_, i) => part(`p${i}`, { qty: 1 })));
  expect(await getSet(db, '1-1')).toMatchObject({ pieces: 1500, partLots: 1500 });
});
