// Parts lists from Rebrickable (#38): mapping, spares, minifigs, the fallbacks to BrickLink, and what reads them.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Lookup } from '../bricklink/client';
import { openNodeDb } from '../db/node';
import type { DB } from '../db/types';
import { minifigs, rbInventories, rbInventoryParts, rbParts, setParts, sets } from '../db/schema';
import { remember } from '../identifiers/resolve';
import type { RbSetFig, RbSetPart, SetPartsSource } from '../rebrickable/client';
import { listSetParts, maxUnmappedPct, pairFigs, rebrickableParts } from './parts';
import { resolve } from '../identifiers/resolve';
import { listMissing, missingWantedList, saveMissing } from './missing';
import { partout } from './partout';
import { ownedParts } from './allocations';
import * as svc from './sets';

let db: DB;
let calls: string[];
const lookup: Lookup = async (no, guide, _c, opts) => {
  calls.push(`bl:${no}:${guide}${opts?.parts ? '+parts' : ''}`);
  const list = [
    { matchNo: 0, partNo: '3001', name: 'Brick 2 x 4', type: 'PART', colorId: 5, qty: 4, extra: 1, alternate: false, counterpart: false },
    { matchNo: 0, partNo: 'sw0001', name: 'Luke', type: 'MINIFIG', colorId: null, qty: 1, extra: 0, alternate: false, counterpart: false },
  ];
  return { blName: `BL ${no}`, year: 2021, categoryId: 1, imageUrl: null, ...(opts?.parts ? { parts: list } : {}), avgSold: 50, minSold: 10, maxSold: 90, qtySold: 5 };
};

const ext = (bl: string[] = []) => ({ bricklink: bl, ldraw: [] });
/** Rebrickable 3001 in red (4) = BrickLink 3001 in 5; 3004 in black (0) = 3004 in 11; 99999 has no BrickLink number. */
const line = (partNo: string, colorId: number, qty: number, isSpare = false, bl = true): RbSetPart => ({
  partNo, colorId, qty, isSpare, name: `Part ${partNo}`,
  part: ext(bl ? [partNo] : []), color: ext(bl ? [String({ 4: 5, 0: 11 }[colorId] ?? colorId)] : []),
});
function fakeRb(inv: Record<string, RbSetPart[] | null>, figs: Record<string, RbSetFig[]> = {}): SetPartsSource & { log: string[] } {
  const log: string[] = [];
  return {
    log,
    async setParts(no) { log.push(`parts:${no}`); calls.push(`rb:${no}`); return inv[no] ?? null; },
    async setMinifigs(no) { log.push(`figs:${no}`); return figs[no] ?? []; },
  };
}

beforeEach(() => { db = openNodeDb(':memory:').db; calls = []; });

describe('rebrickableParts', () => {
  it('maps parts and colours to BrickLink numbers, merges spares into extra, and adds minifigs', async () => {
    await remember(db, [{ kind: 'minifig', scheme: 'rebrickable', value: 'fig-000001', canonical: 'sw0001', source: 'community' }]);
    const rb = fakeRb(
      { '75192-1': [line('3001', 4, 4), line('3001', 4, 1, true), line('3004', 0, 2)] },
      { '75192-1': [{ figNo: 'fig-000001', name: 'Luke', qty: 1 }, { figNo: 'fig-000002', name: 'Han', qty: 2 }] },
    );
    const r = await rebrickableParts(db, rb, '75192');
    expect(r).toMatchObject({ ok: true, from: 'api', calls: 2, unmapped: 1 });
    if (!r.ok) return;
    expect(r.parts).toEqual([
      { matchNo: 0, partNo: '3001', name: 'Part 3001', type: 'PART', colorId: 5, qty: 4, extra: 1, alternate: false, counterpart: false, mapped: true },
      { matchNo: 0, partNo: '3004', name: 'Part 3004', type: 'PART', colorId: 11, qty: 2, extra: 0, alternate: false, counterpart: false, mapped: true },
      { matchNo: 0, partNo: 'sw0001', name: 'Luke', type: 'MINIFIG', colorId: null, qty: 1, extra: 0, alternate: false, counterpart: false, mapped: true },
      // No BrickLink number for this figure: kept, in Rebrickable's number, and left out of pricing.
      { matchNo: 0, partNo: 'fig-000002', name: 'Han', type: 'MINIFIG', colorId: null, qty: 2, extra: 0, alternate: false, counterpart: false, mapped: false },
    ]);
  });

  it('maps a minifigure through one you own that has both numbers', async () => {
    await db.insert(minifigs).values({ figNo: 'lor115', rbFigNo: 'fig-012345', name: 'Elrond', qty: 1, condition: 'Used' }).run();
    const rb = fakeRb({ '10316-1': [line('3001', 4, 1)] }, { '10316-1': [{ figNo: 'fig-012345', name: 'Elrond', qty: 1 }] });
    const r = await rebrickableParts(db, rb, '10316-1');
    expect(r.ok && r.parts.find((p) => p.type === 'MINIFIG')).toMatchObject({ partNo: 'lor115', mapped: true });
  });

  it('falls back when Rebrickable does not know the set, or too many lots are unmapped', async () => {
    const rb = fakeRb({ '75192-1': [...Array.from({ length: 49 }, (_, i) => line(`30${i}`, 4, 1)), line('99999', 4, 1, false, false)] });
    expect(await rebrickableParts(db, rb, '404-1')).toEqual({ ok: false, reason: 'unknown', calls: 1 });
    // 1 of 50 lots unmapped is 2%: allowed by default, not at 1%.
    expect((await rebrickableParts(db, rb, '75192-1')).ok).toBe(true);
    expect(await rebrickableParts(db, rb, '75192-1', 1)).toEqual({ ok: false, reason: 'unmapped', unmapped: 1, calls: 1 });
  });

  it('reads the local catalog first, with no API call for the parts', async () => {
    await remember(db, [
      { kind: 'part', scheme: 'rebrickable', value: '3001', canonical: '3001', source: 'rebrickable' },
      { kind: 'color', scheme: 'rebrickable', value: 4, canonical: 5, source: 'rebrickable' },
    ]);
    await db.insert(rbInventories).values([{ id: 1, version: 1, setNum: '75192-1' }, { id: 2, version: 2, setNum: '75192-1' }]).run();
    await db.insert(rbParts).values({ partNum: '3001', name: 'Brick 2 x 4' }).run();
    await db.insert(rbInventoryParts).values([
      { inventoryId: 1, partNum: '3001', colorId: 4, quantity: 99 }, // an older version: ignored
      { inventoryId: 2, partNum: '3001', colorId: 4, quantity: 6 },
      { inventoryId: 2, partNum: '3001', colorId: 4, quantity: 2, isSpare: true },
    ]).run();
    const rb = fakeRb({});
    const r = await rebrickableParts(db, rb, '75192-1');
    expect(r).toMatchObject({ ok: true, from: 'catalog', calls: 1 });
    expect(rb.log).toEqual(['figs:75192-1']);
    expect(r.ok && r.parts[0]).toMatchObject({ partNo: '3001', colorId: 5, qty: 6, extra: 2, name: 'Brick 2 x 4' });
  });

  it('asks the API when the local lines do not map well enough', async () => {
    await db.insert(rbInventories).values({ id: 2, version: 1, setNum: '75192-1' }).run();
    await db.insert(rbInventoryParts).values({ inventoryId: 2, partNum: '3001', colorId: 4, quantity: 6 }).run();
    const rb = fakeRb({ '75192-1': [line('3001', 4, 6)] }); // the API brings the IDs the local catalog lacks
    expect(await rebrickableParts(db, rb, '75192-1')).toMatchObject({ ok: true, from: 'api', calls: 2 });
  });

  it('reads REBRICKABLE_PARTS_MAX_UNMAPPED', () => {
    expect(maxUnmappedPct({})).toBe(2);
    expect(maxUnmappedPct({ REBRICKABLE_PARTS_MAX_UNMAPPED: '5%' })).toBe(5);
    expect(maxUnmappedPct({ REBRICKABLE_PARTS_MAX_UNMAPPED: 'x' })).toBe(2);
  });
});

describe('adding and refreshing sets', () => {
  const add = (setNo: string, rb: SetPartsSource | null) => svc.addSet(db, { setNo, name: 'Test', condition: 'Used' }, { lookup, rb });

  it('takes the list from Rebrickable with no BrickLink parts call, and marks where it came from', async () => {
    const rb = fakeRb({ '75192-1': [line('3001', 4, 4), line('3001', 4, 1, true)] });
    const r = await add('75192-1', rb);
    expect(calls).toEqual(['rb:75192-1', 'bl:75192-1:U']);
    expect(r.ok && r.set).toMatchObject({ pieces: 4, partLots: 1, partsSource: 'rebrickable', avgSold: 50 });
    expect(await db.select({ source: setParts.source, partNo: setParts.partNo, colorId: setParts.colorId, extra: setParts.extra }).from(setParts).all())
      .toEqual([{ source: 'rebrickable', partNo: '3001', colorId: 5, extra: 1 }]);
  });

  it('falls back to BrickLink when Rebrickable does not know the set, or fails, or is turned off', async () => {
    expect((await add('404-1', fakeRb({}))).ok).toBe(true);
    expect(calls).toEqual(['rb:404-1', 'bl:404-1:U+parts']);
    expect((await svc.getSet(db, '404-1'))?.partsSource).toBe('bricklink');

    calls = [];
    const broken: SetPartsSource = { async setParts() { throw new Error('Rebrickable: rate limited'); }, async setMinifigs() { return []; } };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await add('500-1', broken);
    expect(calls).toEqual(['bl:500-1:U+parts']);
    warn.mockRestore();

    calls = [];
    vi.stubEnv('REBRICKABLE_PARTS', 'off');
    await add('600-1', fakeRb({ '600-1': [line('3001', 4, 1)] }));
    expect(calls).toEqual(['bl:600-1:U+parts']);
    vi.unstubAllEnvs();
  });

  it('counts a sync\'s parts lists by source', async () => {
    const counts: svc.PartsCounts = { bricklink: 0, rebrickable: 0, rebrickableCalls: 0, figsLearned: 0 };
    for (const no of ['75192-1', '404-1']) await db.insert(sets).values({ setNo: no, name: no }).run();
    const rb = fakeRb({ '75192-1': [line('3001', 4, 1)] });
    for (const s of await db.select({ id: sets.id, setNo: sets.setNo }).from(sets).all()) await svc.lookupInto(db, { ...s, copies: [] }, lookup, 'USD', { rb, counts });
    expect(counts).toEqual({ bricklink: 1, rebrickable: 1, rebrickableCalls: 3, figsLearned: 0 });
  });

  it('never drops marked missing parts on a refresh: keeps the source, and refuses a list that would lose them', async () => {
    await add('75192-1', null); // BrickLink list: 3001 in 5, sw0001
    const s = (await svc.getSet(db, '75192-1'))!;
    expect((await saveMissing(db, '75192-1', s.copies[0].id, [{ partNo: '3001', colorId: 5, type: 'PART', qty: 2 }])).ok).toBe(true);

    // With marks, the refresh stays on BrickLink, so the marks keep matching.
    calls = [];
    const rb = fakeRb({ '75192-1': [line('3004', 0, 1)] });
    const r = await svc.refreshParts(db, '75192-1', lookup, rb);
    expect(r).toMatchObject({ ok: true, source: 'bricklink' });
    expect(calls).toEqual(['bl:75192-1:U+parts']);
    expect((await listMissing(db, s.id, s.copies[0].id)).pieces).toBe(2);

    // BrickLink's list changes and no longer has the marked part: nothing is replaced, and the answer says why.
    const changed: Lookup = async (no, g, c, o) => ({ ...(await lookup(no, g, c, o)), parts: [{ matchNo: 0, partNo: '3010', name: 'Brick', type: 'PART', colorId: 5, qty: 1, extra: 0, alternate: false, counterpart: false }] });
    const r2 = await svc.refreshParts(db, '75192-1', changed, rb);
    expect(r2).toMatchObject({ ok: false, status: 409, error: expect.stringContaining("doesn't have 1 part you marked missing (3001 (colour 5))") });
    expect((await listSetParts(db, s.id)).map((p) => p.partNo).sort()).toEqual(['3001', 'sw0001']);
    expect((await listMissing(db, s.id, s.copies[0].id)).pieces).toBe(2);
  });

  it('refreshes an unmarked set from Rebrickable', async () => {
    await add('75192-1', null);
    const r = await svc.refreshParts(db, '75192-1', lookup, fakeRb({ '75192-1': [line('3001', 4, 4)] }));
    expect(r).toMatchObject({ ok: true, source: 'rebrickable' });
    expect((await svc.getSet(db, '75192-1'))?.partsSource).toBe('rebrickable');
  });
});

describe('unmapped lines', () => {
  it('are left out of part-out value, owned parts and Wanted Lists, and counted', async () => {
    const rb = fakeRb(
      { '75192-1': [line('3001', 4, 4)] },
      { '75192-1': [{ figNo: 'fig-000002', name: 'Han', qty: 1 }] },
    );
    // BrickLink's list has no minifigures here, so Rebrickable's unmatched one stays.
    const noFigs: Lookup = async (no, g, c, o) => { const r = await lookup(no, g, c, o); return { ...r, parts: r.parts?.filter((p) => p.type !== 'MINIFIG') }; };
    await svc.addSet(db, { setNo: '75192-1', name: 'Falcon', condition: 'Used' }, { lookup: noFigs, rb });
    const s = (await svc.getSet(db, '75192-1'))!;
    expect((await partout(db, s.id, 'Used', 'USD')).unmappedLots).toBe(1);
    expect((await partout(db, s.id, 'Used', 'USD')).lots).toBe(1);
    expect([...(await ownedParts(db)).keys()]).toEqual(['PART|3001|5']);

    await saveMissing(db, '75192-1', s.copies[0].id, [{ partNo: '3001', colorId: 5, type: 'PART', qty: 1 }, { partNo: 'fig-000002', colorId: null, type: 'MINIFIG', qty: 1 }]);
    const w = await missingWantedList(db, '75192-1');
    expect(w).toMatchObject({ items: 1, skipped: 1 });
    expect(w?.xml).toContain('<ITEMID>3001</ITEMID>');
    expect(w?.xml).not.toContain('fig-000002');
  });
});

describe('minifigure numbers from BrickLink', () => {
  const fig = (figNo: string, name: string, qty = 1, bl: string | null = null) => ({ figNo, name, qty, bl });
  const blFig = (partNo: string, name: string, qty = 1) => ({ partNo, name, qty });

  it('pairs only when certain: the last one left, a unique quantity, or clearly matching names', () => {
    expect(pairFigs([fig('fig-1', 'Han Solo')], [blFig('sw0002', 'Han Solo, Hoth Outfit')])).toEqual(new Map([['fig-1', 'sw0002']]));
    expect(pairFigs([fig('fig-1', 'Stormtrooper', 4), fig('fig-2', 'Luke')], [blFig('sw0001', 'Luke Skywalker'), blFig('sw0188', 'Stormtrooper', 4)]))
      .toEqual(new Map([['fig-1', 'sw0188'], ['fig-2', 'sw0001']]));
    expect(pairFigs(
      [fig('fig-1', 'Luke Skywalker - Tatooine'), fig('fig-2', 'Princess Leia - Hoth')],
      [blFig('sw0778', 'Luke Skywalker (Tatooine)'), blFig('sw0877', 'Princess Leia (Hoth Outfit)')],
    )).toEqual(new Map([['fig-1', 'sw0778'], ['fig-2', 'sw0877']]));
    // Two look-alikes: no guess.
    expect(pairFigs([fig('fig-1', 'Clone Trooper'), fig('fig-2', 'Clone Trooper')], [blFig('sw0001', 'Clone Trooper'), blFig('sw0002', 'Clone Trooper')]).size).toBe(0);
    // Quantities disagree: no guess.
    expect(pairFigs([fig('fig-1', 'Han Solo', 2)], [blFig('sw0002', 'Han Solo', 1)]).size).toBe(0);
    // Figures already known are taken out first.
    expect(pairFigs([fig('fig-1', 'Luke', 1, 'sw0001'), fig('fig-2', 'Han')], [blFig('sw0001', 'Luke'), blFig('sw0002', 'Han')])).toEqual(new Map([['fig-2', 'sw0002']]));
  });

  it("takes BrickLink's minifigure lines in the same call, learns the pair, and needs no BrickLink call next time", async () => {
    const rb = fakeRb(
      { '75192-1': [line('3001', 4, 4)], '75159-1': [line('3004', 0, 2)] },
      { '75192-1': [{ figNo: 'fig-000001', name: 'Luke Skywalker', qty: 1 }], '75159-1': [{ figNo: 'fig-000001', name: 'Luke Skywalker', qty: 1 }] },
    );
    const counts: svc.PartsCounts = { bricklink: 0, rebrickable: 0, rebrickableCalls: 0, figsLearned: 0 };
    for (const no of ['75192-1', '75159-1']) await db.insert(sets).values({ setNo: no, name: no }).run();
    const by = new Map((await db.select({ id: sets.id, setNo: sets.setNo }).from(sets).all()).map((r) => [r.setNo, r]));
    const all = [by.get('75192-1')!, by.get('75159-1')!];

    await svc.lookupInto(db, { ...all[0], copies: [] }, lookup, 'USD', { rb, counts });
    expect(calls).toEqual(['rb:75192-1', 'bl:75192-1:U+parts']);
    const first = await listSetParts(db, all[0].id);
    // Parts from Rebrickable, the minifigure from BrickLink, all in BrickLink numbers.
    expect(first.map((p) => [p.type, p.partNo, p.colorId, p.mapped, p.source])).toEqual([['MINIFIG', 'sw0001', null, true, 'rebrickable'], ['PART', '3001', 5, true, 'rebrickable']]);
    expect((await resolve(db, 'minifig', 'rebrickable', 'fig-000001')).canonical).toBe('sw0001');

    calls = [];
    await svc.lookupInto(db, { ...all[1], copies: [] }, lookup, 'USD', { rb, counts });
    expect(calls).toEqual(['rb:75159-1', 'bl:75159-1:U']); // no parts call to BrickLink this time
    expect((await listSetParts(db, all[1].id)).find((p) => p.type === 'MINIFIG')).toMatchObject({ partNo: 'sw0001', mapped: true });
    expect(counts).toMatchObject({ bricklink: 1, rebrickable: 2, figsLearned: 1 });
  });
});
