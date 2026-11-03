import { beforeEach, expect, it, vi } from 'vitest';
import type { Lookup, SetPart } from '../bricklink/client';
import { openNodeDb } from '../db/node';
import type { DB } from '../db/types';
import { listMissing, missingWantedList, saveMissing } from './missing';
import { replaceParts } from './parts';
import * as svc from './sets';

vi.mock('server-only', () => ({}));

let db: DB;
const lookup: Lookup = async () => ({ blName: 'BL', year: 2022, categoryId: 1, imageUrl: null, avgSold: 100, minSold: 90, maxSold: 110, qtySold: 3 });
const part = (partNo: string, colorId: number | null, qty: number, extra: Partial<SetPart> = {}): SetPart =>
  ({ matchNo: 0, partNo, name: `Part ${partNo}`, type: 'PART', colorId, qty, extra: 0, alternate: false, counterpart: false, ...extra });
const PARTS = [part('3001', 7, 60), part('3023', 86, 36), part('sp047', null, 2, { type: 'MINIFIG', name: 'Astronaut' }), part('3024', 3, 10, { alternate: true, matchNo: 1 })];

async function setUp(condition: 'New' | 'Used' = 'New') {
  await svc.addSet(db, { setNo: '10497-1', name: 'Galaxy Explorer', condition }, { lookup });
  const s = (await svc.getSet(db, '10497-1'))!;
  await replaceParts(db, s.id, PARTS);
  return s.id;
}

beforeEach(() => { db = openNodeDb(':memory:').db; });

it('works out Missing % from marked parts, caps quantities, and makes the set Partial', async () => {
  const id = await setUp('Used');
  const r = await saveMissing(db, '10497-1', [{ partNo: '3001', colorId: 7, type: 'PART', qty: 6 }, { partNo: '3023', colorId: 86, type: 'PART', qty: 99 }]);
  expect(r.ok).toBe(true);
  const m = await listMissing(db, id);
  expect(m).toMatchObject({ lots: 2, pieces: 42, setPieces: 98, pct: 42.9 }); // 6 + 36 (capped) of 60 + 36 + 2
  const s = (await svc.getSet(db, '10497-1'))!;
  expect(s).toMatchObject({ condition: 'Partial', missingPct: 42.9, missingMarked: 42 });
  expect(s.estValue).toBeCloseTo(57.1);
});

it('refuses parts that are not on the regular parts list', async () => {
  await setUp();
  expect(await saveMissing(db, '10497-1', [{ partNo: '3024', colorId: 3, type: 'PART', qty: 1 }])).toMatchObject({ ok: false, error: expect.stringMatching(/isn't on this set's parts list/) });
  expect(await saveMissing(db, '10497-1', [{ partNo: '9999', colorId: 1, type: 'PART', qty: 1 }])).toMatchObject({ ok: false });
  expect(await saveMissing(db, '99999-1', [])).toMatchObject({ ok: false, status: 404 });
});

it('keeps marks across a parts refresh, dropping parts that are gone', async () => {
  const id = await setUp('Used');
  await saveMissing(db, '10497-1', [{ partNo: '3001', colorId: 7, type: 'PART', qty: 6 }, { partNo: 'sp047', colorId: null, type: 'MINIFIG', qty: 1 }]);
  await replaceParts(db, id, [part('3001', 7, 4), part('3023', 86, 36)]); // minifig gone, fewer bricks
  const m = await listMissing(db, id);
  expect(m.items.map((i) => [i.partNo, i.qty])).toEqual([['3001', 4]]);
  expect((await svc.getSet(db, '10497-1'))!.missingPct).toBe(10); // 4 of 40
});

it('clears Missing % when nothing is marked, and the form cannot override computed values', async () => {
  await setUp('Used');
  await saveMissing(db, '10497-1', [{ partNo: '3001', colorId: 7, type: 'PART', qty: 10 }]);
  await svc.editSet(db, { setNo: '10497-1', missingPct: 50 }, null);
  expect((await svc.getSet(db, '10497-1'))!.missingPct).toBe(10.2);
  await saveMissing(db, '10497-1', []);
  expect((await svc.getSet(db, '10497-1'))!).toMatchObject({ missingPct: null, estValue: 100, condition: 'Partial', missingMarked: 0 });
});

it('exports the missing parts as a BrickLink Wanted List', async () => {
  await setUp('Used');
  await saveMissing(db, '10497-1', [{ partNo: '3001', colorId: 7, type: 'PART', qty: 6 }, { partNo: 'sp047', colorId: null, type: 'MINIFIG', qty: 1 }]);
  const w = (await missingWantedList(db, '10497-1'))!;
  expect(w.items).toBe(2);
  expect(w.xml).toContain('<!-- Missing parts for Galaxy Explorer (10497) -->');
  expect(w.xml).toContain('<ITEMTYPE>P</ITEMTYPE>\n    <ITEMID>3001</ITEMID>\n    <COLOR>7</COLOR>\n    <MINQTY>6</MINQTY>');
  expect(w.xml).toContain('<ITEMTYPE>M</ITEMTYPE>\n    <ITEMID>sp047</ITEMID>\n    <MINQTY>1</MINQTY>');
});
