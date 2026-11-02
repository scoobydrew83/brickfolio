import { beforeEach, expect, it } from 'vitest';
import { openNodeDb } from '../db/node';
import type { DB } from '../db/types';
import { createRebrickable, toBuildPart, type BuildSource } from '../rebrickable/client';
import { replaceParts } from './parts';
import * as sets from './sets';
import { buildMatches, syncBuilds, wantedListXml } from './builds';

let db: DB;
const part = (partNo: string, colorId: number | null, qty: number) => ({ matchNo: 0, partNo, name: partNo, type: 'PART', colorId, qty, extra: 0, alternate: false, counterpart: false });

let calls: string[];
const src: BuildSource = {
  async alternates(setNo) {
    calls.push(`alt:${setNo}`);
    if (setNo === '31120-1') return [{ mocNo: 'MOC-1', name: 'Small Cart', numParts: 10, imageUrl: null, url: 'https://rebrickable.com/mocs/MOC-1/', designer: 'ada' }, { mocNo: 'MOC-2', name: 'Big Keep', numParts: 30, imageUrl: null, url: null, designer: null }];
    return [];
  },
  async buildParts(mocNo) {
    calls.push(`parts:${mocNo}`);
    if (mocNo === 'MOC-1') return [{ partNo: '3001', colorId: 5, qty: 4, mapped: true }, { partNo: '3001', colorId: 5, qty: 2, mapped: true }, { partNo: '3023', colorId: 11, qty: 4, mapped: true }];
    return [{ partNo: '3001', colorId: 5, qty: 10, mapped: true }, { partNo: '9999', colorId: 1, qty: 15, mapped: true }, { partNo: 'rb-only', colorId: 1000, qty: 5, mapped: false }];
  },
};

beforeEach(async () => {
  db = openNodeDb(':memory:').db;
  calls = [];
  // Own two copies of a set with 4 red 2x4 bricks and 3 black 1x2 plates, and one of a set with 2 more red bricks.
  await sets.addSet(db, { setNo: '31120-1', name: 'Medieval Castle', condition: 'Used', qty: 2 }, { lookup: null });
  await sets.addSet(db, { setNo: '6080-1', name: "King's Castle", condition: 'Used' }, { lookup: null });
  const a = (await sets.getSet(db, '31120-1'))!, b = (await sets.getSet(db, '6080-1'))!;
  await replaceParts(db, a.id, [part('3001', 5, 4), part('3023', 11, 1), { ...part('3002', 5, 9), alternate: true }]);
  await replaceParts(db, b.id, [part('3001', 5, 2)]);
});

it('maps Rebrickable inventory lines to BrickLink numbers', () => {
  expect(toBuildPart({ quantity: 3, part: { part_num: '3001', external_ids: { BrickLink: ['3001'] } }, color: { id: 4, external_ids: { BrickLink: { ext_ids: [5] } } } }))
    .toEqual({ partNo: '3001', colorId: 5, qty: 3, mapped: true });
  expect(toBuildPart({ quantity: 1, part: { part_num: '973c01' }, color: { id: 72 } })).toEqual({ partNo: '973c01', colorId: 72, qty: 1, mapped: false });
});

it('fetches alternates and parts through the client, skipping spares', async () => {
  const rb = createRebrickable('k', async (input) => {
    const url = String(input);
    if (url.includes('/alternates/')) return Response.json({ count: 1, next: null, results: [{ set_num: 'MOC-7', name: 'Cart', num_parts: 3, moc_img_url: 'https://cdn.rebrickable.com/x.jpg', moc_url: 'https://rebrickable.com/mocs/MOC-7/', designer_name: 'ada' }] });
    return Response.json({ count: 2, next: null, results: [
      { quantity: 2, part: { part_num: '3001', external_ids: { BrickLink: ['3001'] } }, color: { id: 4, external_ids: { BrickLink: { ext_ids: [5] } } } },
      { quantity: 1, is_spare: true, part: { part_num: '3001', external_ids: { BrickLink: ['3001'] } }, color: { id: 4, external_ids: { BrickLink: { ext_ids: [5] } } } },
    ] });
  }, 0);
  expect(await rb.alternates('31120-1')).toEqual([{ mocNo: 'MOC-7', name: 'Cart', numParts: 3, imageUrl: 'https://cdn.rebrickable.com/x.jpg', url: 'https://rebrickable.com/mocs/MOC-7/', designer: 'ada' }]);
  expect(await rb.buildParts('MOC-7')).toEqual([{ partNo: '3001', colorId: 5, qty: 2, mapped: true }]);
});

it('stays within the call budget and picks up where it stopped', async () => {
  expect(await syncBuilds(db, src, { maxCalls: 2 })).toEqual([]);
  expect(calls).toEqual(['alt:31120-1', 'alt:6080-1']);
  calls = [];
  await syncBuilds(db, src, { maxCalls: 5 });
  expect(calls).toEqual(['parts:MOC-1', 'parts:MOC-2']);
});

it('works out what you can build from every part you own', async () => {
  await syncBuilds(db, src);
  const [cart, keep] = await buildMatches(db);
  // Cart needs 6 red bricks (owned 4x2 + 2 = 10) and 4 black plates (owned 1x2 = 2).
  expect(cart).toMatchObject({ mocNo: 'MOC-1', need: 10, have: 8, pct: 80, missingLots: 1, missingPieces: 2, unmapped: 0, sourceSetNo: '31120-1' });
  expect(keep).toMatchObject({ mocNo: 'MOC-2', need: 30, have: 10, pct: 33, missingLots: 2, missingPieces: 20, unmapped: 1 });
  expect((await buildMatches(db, { sourceSetNo: '6080' }))).toEqual([]);
});

it('exports missing parts as a BrickLink Wanted List', async () => {
  await syncBuilds(db, src);
  const w = await wantedListXml(db, 'MOC-2');
  expect(w).toMatchObject({ items: 1, skipped: 1, name: 'Big Keep' });
  expect(w!.xml).toContain('<ITEMID>9999</ITEMID>\n    <COLOR>1</COLOR>\n    <MINQTY>15</MINQTY>');
  expect(w!.xml).not.toContain('3001'); // owned enough
  expect(await wantedListXml(db, 'MOC-404')).toBeNull();
});
