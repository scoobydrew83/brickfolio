import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { buildParts, builds } from '../db/schema';
import { rebrickableStats } from './catalog';
import { openNodeDb } from '../db/node';
import type { DB } from '../db/types';
import { createRebrickable, PartsUnavailable, toBuildPart, type BuildSource, type RbBuildPart } from '../rebrickable/client';
import { resolve, toScheme } from '../identifiers/resolve';
import { replaceParts } from './parts';
import * as sets from './sets';
import { buildMatches, GIVE_UP_AFTER, RECHECK_UNAVAILABLE_DAYS, syncBuilds, wantedListXml } from './builds';

let db: DB;
const part = (partNo: string, colorId: number | null, qty: number) => ({ matchNo: 0, partNo, name: partNo, type: 'PART', colorId, qty, extra: 0, alternate: false, counterpart: false });

// A parts list line as the client returns it: Rebrickable numbers, here with the same BrickLink ones (or none: unmapped).
const line = (partNo: string, colorId: number, qty: number, mapped = true): RbBuildPart => ({
  partNo, colorId, qty, part: { bricklink: mapped ? [partNo] : [], ldraw: [] }, color: { bricklink: mapped ? [String(colorId)] : [], ldraw: [] },
});

let calls: string[];
const src: BuildSource = {
  async alternates(setNo) {
    calls.push(`alt:${setNo}`);
    if (setNo === '31120-1') return [{ mocNo: 'MOC-1', name: 'Small Cart', numParts: 10, imageUrl: null, url: 'https://rebrickable.com/mocs/MOC-1/', designer: 'ada' }, { mocNo: 'MOC-2', name: 'Big Keep', numParts: 30, imageUrl: null, url: null, designer: null }];
    return [];
  },
  async buildParts(mocNo) {
    calls.push(`parts:${mocNo}`);
    if (mocNo === 'MOC-1') return [line('3001', 5, 4), line('3001', 5, 2), line('3023', 11, 4)];
    return [line('3001', 5, 10), line('9999', 1, 15), line('rb-only', 1000, 5, false)];
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

it('keeps Rebrickable numbers on inventory lines, with the BrickLink and LDraw numbers it lists', () => {
  expect(toBuildPart({ quantity: 3, part: { part_num: '3001', external_ids: { BrickLink: ['3001'], LDraw: ['3001'] } }, color: { id: 4, external_ids: { BrickLink: { ext_ids: [5] }, LDraw: { ext_ids: [4] } } } }))
    .toEqual({ partNo: '3001', colorId: 4, qty: 3, part: { bricklink: ['3001'], ldraw: ['3001'] }, color: { bricklink: ['5'], ldraw: ['4'] } });
  expect(toBuildPart({ quantity: 1, part: { part_num: '973c01' }, color: { id: 72 } })).toEqual({ partNo: '973c01', colorId: 72, qty: 1, part: { bricklink: [], ldraw: [] }, color: { bricklink: [], ldraw: [] } });
});

it('saves the IDs a parts list came with, and maps lines to BrickLink numbers as before', async () => {
  const moc: BuildSource = {
    async alternates(setNo) { return setNo === '31120-1' ? [{ mocNo: 'MOC-9', name: 'Cart', numParts: 4, imageUrl: null, url: null, designer: null }] : []; },
    async buildParts() {
      return [
        { partNo: '3001', colorId: 4, qty: 2, part: { bricklink: ['3001'], ldraw: ['3001'] }, color: { bricklink: ['5'], ldraw: ['4'] } },
        { partNo: '3069bpr0001', colorId: 4, qty: 1, part: { bricklink: ['3069bpr0001', '3069bp01'], ldraw: [] }, color: { bricklink: ['5'], ldraw: ['4'] } },
        { partNo: 'rb-only', colorId: 4, qty: 1, part: { bricklink: [], ldraw: [] }, color: { bricklink: ['5'], ldraw: ['4'] } },
        { partNo: '3023', colorId: 9999, qty: 1, part: { bricklink: ['3023'], ldraw: [] }, color: { bricklink: [], ldraw: [] } },
      ];
    },
  };
  await syncBuilds(db, moc);
  const b = (await db.select().from(builds).where(eq(builds.mocNo, 'MOC-9')).get())!;
  const lines = (await db.select().from(buildParts).where(eq(buildParts.buildId, b.id)).all()).map(({ partNo, colorId, qty, mapped }) => ({ partNo, colorId, qty, mapped }));
  expect(lines).toEqual([
    { partNo: '3001', colorId: 5, qty: 2, mapped: true },
    { partNo: '3069bpr0001', colorId: 5, qty: 1, mapped: true }, // Rebrickable's first BrickLink number, as before
    { partNo: 'rb-only', colorId: 5, qty: 1, mapped: false },
    { partNo: '3023', colorId: 9999, qty: 1, mapped: false },
  ]);
  expect(await resolve(db, 'color', 'ldraw', 4)).toMatchObject({ canonical: '5' });
  expect(await resolve(db, 'part', 'ldraw', '3001.dat')).toMatchObject({ canonical: '3001' });
  expect(await toScheme(db, 'part', '3001', 'rebrickable')).toEqual(['3001']);
  expect((await resolve(db, 'part', 'rebrickable', '3069bpr0001')).candidates.map((c) => c.canonical)).toEqual(['3069bpr0001', '3069bp01']);
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
  expect(await rb.buildParts('MOC-7')).toEqual([{ partNo: '3001', colorId: 4, qty: 2, part: { bricklink: ['3001'], ldraw: [] }, color: { bricklink: ['5'], ldraw: [] } }]);
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

describe('builds whose parts list Rebrickable won’t share', () => {
  const many = (n: number) => Array.from({ length: n }, (_, i) => ({ mocNo: `MOC-${100 + i}`, name: `Build ${i}`, numParts: 5, imageUrl: null, url: null, designer: null }));
  const refusing = (open: Set<string>): BuildSource => ({
    async alternates(setNo) { calls.push(`alt:${setNo}`); return setNo === '31120-1' ? many(8) : []; },
    async buildParts(mocNo) {
      calls.push(`parts:${mocNo}`);
      if (open.has(mocNo)) return [line('3001', 5, 1)];
      throw new PartsUnavailable('forbidden', `Rebrickable doesn't share the parts list of ${mocNo}.`);
    },
  });

  it('notes refused builds once, moves on to the rest, and reports no errors', async () => {
    const src = refusing(new Set(['MOC-102', 'MOC-106']));
    expect(await syncBuilds(db, src, { maxCalls: 100 })).toEqual([]);
    const all = await buildMatches(db);
    expect(all.filter((b) => b.partsKnown).map((b) => b.mocNo).sort()).toEqual(['MOC-102', 'MOC-106']);
    expect(all.filter((b) => b.partsUnavailable)).toHaveLength(6);
    calls = [];
    await syncBuilds(db, src, { maxCalls: 100 });
    expect(calls.filter((c) => c.startsWith('parts:'))).toEqual([]); // nothing retried
    expect(await rebrickableStats(db)).toMatchObject({ builds: 8, buildsWithParts: 2, buildsUnavailable: 6 });
  });

  it('stops early when the key gets no parts lists at all, and continues with the next ones later', async () => {
    const src = refusing(new Set());
    await syncBuilds(db, src, { maxCalls: 100 });
    expect(calls.filter((c) => c.startsWith('parts:'))).toHaveLength(GIVE_UP_AFTER);
    calls = [];
    await syncBuilds(db, src, { maxCalls: 100 });
    expect(calls.filter((c) => c.startsWith('parts:'))).toEqual(['parts:MOC-105', 'parts:MOC-106', 'parts:MOC-107']); // the rest, never the same ones
  });

  it('asks about a refused build again after 90 days', async () => {
    await syncBuilds(db, refusing(new Set()), { maxCalls: 100 });
    const old = new Date(Date.now() - (RECHECK_UNAVAILABLE_DAYS + 1) * 86_400_000).toISOString();
    await db.update(builds).set({ partsCheckedAt: old }).where(eq(builds.mocNo, 'MOC-100'));
    calls = [];
    await syncBuilds(db, refusing(new Set(['MOC-100'])), { maxCalls: 100 });
    expect(calls).toContain('parts:MOC-100');
    expect((await buildMatches(db)).find((b) => b.mocNo === 'MOC-100')).toMatchObject({ partsKnown: true, partsUnavailable: false });
  });

  it('still reports other errors', async () => {
    const broken: BuildSource = { ...refusing(new Set()), async buildParts() { throw new Error('boom'); } };
    expect(await syncBuilds(db, broken, { maxCalls: 4 })) // 2 calls find the builds, 2 ask for parts.toEqual(['Rebrickable parts for MOC-100: boom', 'Rebrickable parts for MOC-101: boom']);
  });
});
