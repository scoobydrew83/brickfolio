import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { buildParts, builds, colors, layoutModuleItems, setCopies } from '../db/schema';
import { openNodeDb } from '../db/node';
import type { DB } from '../db/types';
import { replaceParts } from './parts';
import { saveMissing } from './missing';
import * as sets from './sets';
import * as L from './layouts';
import { addLot } from './lots';
import { reserve } from './allocations';

let db: DB;
const part = (partNo: string, colorId: number | null, qty: number, type = 'PART') => ({ matchNo: 0, partNo, name: `${partNo} name`, type, colorId, qty, extra: 0, alternate: false, counterpart: false });

/** Adds a Rebrickable build with its parts list; `[partNo, colorId, qty, mapped?]`. */
async function build(mocNo: string, lines: [string, number, number, boolean?][]): Promise<number> {
  const [b] = await db.insert(builds).values({ mocNo, name: `Build ${mocNo}`, sourceSetNo: '31120-1', partsFetchedAt: '2026-11-01T00:00:00Z' }).returning({ id: builds.id }).all();
  for (const [partNo, colorId, qty, mapped = true] of lines) await db.insert(buildParts).values({ buildId: b.id, partNo, colorId, qty, mapped });
  return b.id;
}

const ok = <T extends object>(r: { ok: true } & T | { ok: false; error: string }): T => {
  if (!r.ok) throw new Error(r.error);
  return r;
};

async function layout(cols = 4, rows = 3) {
  return ok(await L.createLayout(db, { name: 'Town', cols, rows })).id;
}

beforeEach(async () => {
  db = openNodeDb(':memory:').db;
  await db.insert(colors).values([{ id: 5, name: 'Red', rgb: 'C91A09' }, { id: 11, name: 'Black', rgb: '05131D' }]);
  await sets.addSet(db, { setNo: '31120-1', name: 'Medieval Castle', condition: 'Used', qty: 2 }, { lookup: null });
  const s = (await sets.getSet(db, '31120-1'))!;
  await replaceParts(db, s.id, [part('3001', 5, 10), part('3023', 11, 4), part('sw0001', null, 1, 'MINIFIG'), part('sw0001', 5, 3)]);
});

describe('input', () => {
  it('validates layouts', () => {
    expect(L.parseLayoutInput({ name: 'Town', cols: '4', rows: 3 })).toEqual({ ok: true, value: { name: 'Town', cols: 4, rows: 3 } });
    expect(L.parseLayoutInput({ name: '', cols: 4, rows: 3 }).ok).toBe(false);
    expect(L.parseLayoutInput({ name: 'Town', cols: 25, rows: 3 })).toMatchObject({ ok: false, error: expect.stringMatching(/1 to 24/) });
    expect(L.parseLayoutInput({ name: 'Town', cols: 1.5, rows: 3 }).ok).toBe(false);
    expect(L.parseLayoutInput({ rows: 5 }, true)).toEqual({ ok: true, value: { rows: 5 } });
  });
  it('validates modules', () => {
    expect(L.parseModuleInput({ x: 0, y: 1, kind: 'road_corner', rotation: 90 })).toEqual({ ok: true, value: { x: 0, y: 1, kind: 'road_corner', rotation: 90 } });
    expect(L.parseModuleInput({ y: 1 }).ok).toBe(false);
    expect(L.parseModuleInput({ rotation: 45 }, true).ok).toBe(false);
    expect(L.parseModuleInput({ kind: 'rail' }, true).ok).toBe(false);
    expect(L.parseModuleInput({ w: 3 }, true).ok).toBe(false);
    expect(L.parseItemsInput({ setCopyIds: [1, '2', 2] })).toEqual({ ok: true, value: { setCopyIds: [1, 2], buildIds: [] } });
    expect(L.parseItemsInput({ buildIds: 'x' }).ok).toBe(false);
  });
});

describe('layouts and modules', () => {
  it('creates, places, moves, rotates and removes', async () => {
    const id = await layout();
    const a = ok(await L.addModule(db, id, { x: 0, y: 0, kind: 'road_straight', name: 'Main street' })).id;
    const b = ok(await L.addModule(db, id, { x: 1, y: 0, w: 1, h: 2 })).id;
    expect(await L.addModule(db, id, { x: 1, y: 1 })).toMatchObject({ ok: false, status: 409 });
    expect(await L.addModule(db, id, { x: 4, y: 0 })).toMatchObject({ ok: false, error: expect.stringMatching(/doesn't fit/) });

    ok(await L.moveModule(db, a, 3, 2));
    expect(await L.moveModule(db, a, 1, 1)).toMatchObject({ ok: false, error: expect.stringMatching(/overlaps/) });
    ok(await L.rotateModule(db, a));
    ok(await L.rotateModule(db, b)); // 1 × 2 turned is 2 × 1 at (1, 0): fits
    expect((await L.getModule(db, b))!.rotation).toBe(90);
    ok(await L.moveModule(db, b, 2, 0)); // 2 × 1 at (2, 0)
    ok(await L.rotateModule(db, b)); // 180°: 1 × 2 at (2, 0)
    ok(await L.moveModule(db, a, 3, 0));
    // 270° would make it 2 × 1 again, over (2, 0) and (3, 0), where the street now is.
    expect(await L.rotateModule(db, b)).toMatchObject({ ok: false, error: expect.stringMatching(/overlaps Main street/) });
    expect((await L.getModule(db, b))!.rotation).toBe(180);
    ok(await L.removeModule(db, a));
    expect(await L.removeModule(db, a)).toMatchObject({ ok: false, status: 404 });
    ok(await L.rotateModule(db, b));
  });

  it('refuses a turn that would leave the layout', async () => {
    const id = await layout(2, 2);
    const m = ok(await L.addModule(db, id, { x: 1, y: 0, w: 1, h: 2 })).id;
    expect(await L.rotateModule(db, m)).toMatchObject({ ok: false, error: expect.stringMatching(/doesn't fit/) });
  });

  it('lists layouts with module counts and gets one with its modules', async () => {
    const id = await layout();
    await L.addModule(db, id, { x: 0, y: 0 });
    await L.addModule(db, id, { x: 2, y: 1, name: 'Park' });
    expect(await L.listLayouts(db)).toMatchObject([{ id, name: 'Town', cols: 4, rows: 3, modules: 2 }]);
    const l = (await L.getLayout(db, id))!;
    expect(l.modules.map((m) => [m.x, m.y, m.name])).toEqual([[0, 0, null], [2, 1, 'Park']]);
    expect(await L.getLayout(db, 999)).toBeUndefined();
  });

  it('renames, resizes, and refuses a resize that cuts off a module', async () => {
    const id = await layout();
    await L.addModule(db, id, { x: 3, y: 2, name: 'Corner' });
    ok(await L.editLayout(db, id, { name: 'Harbour', cols: 6 }));
    expect(await L.editLayout(db, id, { cols: 3 })).toMatchObject({ ok: false, status: 409, error: expect.stringMatching(/Corner/) });
    expect((await L.getLayout(db, id))!).toMatchObject({ name: 'Harbour', cols: 6, rows: 3 });
    expect(await L.editLayout(db, 999, { name: 'x' })).toMatchObject({ ok: false, status: 404 });
  });
});

describe('linking', () => {
  it('links copies and builds, one module each, and says where one already is', async () => {
    const id = await layout();
    const m1 = ok(await L.addModule(db, id, { x: 0, y: 0, name: 'Castle hill' })).id;
    const m2 = ok(await L.addModule(db, id, { x: 1, y: 0 })).id;
    const [copy] = (await sets.getSet(db, '31120-1'))!.copies;
    const b = await build('MOC-1', [['3001', 5, 2]]);
    ok(await L.setModuleItems(db, m1, { setCopyIds: [copy.id], buildIds: [b] }));
    const items = (await L.getLayout(db, id))!.modules[0].items;
    expect(items).toMatchObject([{ kind: 'copy', refId: copy.id, name: 'Medieval Castle', detail: 'Copy 1 · Built' }, { kind: 'build', refId: b, name: 'Build MOC-1', detail: 'MOC-1' }]);

    expect(await L.setModuleItems(db, m2, { setCopyIds: [copy.id], buildIds: [] })).toMatchObject({ ok: false, status: 409, error: expect.stringMatching(/Medieval Castle is already on Town, Castle hill/) });
    expect(await L.setModuleItems(db, m2, { setCopyIds: [], buildIds: [b] })).toMatchObject({ ok: false, error: expect.stringMatching(/Build MOC-1 is already on Town/) });
    ok(await L.setModuleItems(db, m1, { setCopyIds: [copy.id], buildIds: [b] })); // saving the same module again is fine
    expect(await L.setModuleItems(db, m2, { setCopyIds: [9999], buildIds: [] })).toMatchObject({ ok: false, error: "Copy 9999 doesn't exist." });

    // Moving is explicit: take it off the first module, then put it on the second.
    ok(await L.setModuleItems(db, m1, { setCopyIds: [], buildIds: [b] }));
    ok(await L.setModuleItems(db, m2, { setCopyIds: [copy.id], buildIds: [] }));

    const found = await L.searchLinkables(db, 'castle');
    expect(found.filter((f) => f.kind === 'copy').map((f) => f.placed?.moduleId ?? null)).toEqual([m2, null]);
  });

  it('deleting a layout removes modules and links, never the copies or builds', async () => {
    const id = await layout();
    const m = ok(await L.addModule(db, id, { x: 0, y: 0 })).id;
    const [copy] = (await sets.getSet(db, '31120-1'))!.copies;
    const b = await build('MOC-1', [['3001', 5, 2]]);
    ok(await L.setModuleItems(db, m, { setCopyIds: [copy.id], buildIds: [b] }));
    ok(await L.deleteLayout(db, id));
    expect(await db.select().from(layoutModuleItems).all()).toEqual([]);
    expect(await L.getModule(db, m)).toBeUndefined();
    expect(await db.select().from(setCopies).where(eq(setCopies.id, copy.id)).get()).toBeTruthy();
    expect(await db.select().from(builds).where(eq(builds.id, b)).get()).toBeTruthy();
  });

  it('removing a copy or build drops its link, not the module', async () => {
    const id = await layout();
    const m = ok(await L.addModule(db, id, { x: 0, y: 0 })).id;
    const b = await build('MOC-1', [['3001', 5, 2]]);
    ok(await L.setModuleItems(db, m, { setCopyIds: [], buildIds: [b] }));
    await db.delete(builds).where(eq(builds.id, b));
    expect((await L.getLayout(db, id))!.modules[0].items).toEqual([]);
  });
});

describe('what a layout needs', () => {
  it('adds up builds by part and colour, with names, colours and the modules that need them', async () => {
    const id = await layout();
    const m1 = ok(await L.addModule(db, id, { x: 0, y: 0 })).id;
    const m2 = ok(await L.addModule(db, id, { x: 1, y: 0 })).id;
    const a = await build('MOC-A', [['3001', 5, 10], ['3023', 11, 2]]);
    const b = await build('MOC-B', [['3001', 5, 10]]);
    ok(await L.setModuleItems(db, m1, { setCopyIds: [], buildIds: [a] }));
    ok(await L.setModuleItems(db, m2, { setCopyIds: [], buildIds: [b] }));
    const n = (await L.layoutNeeds(db, id))!;
    // Parts in your sets aren't taken off: the set stands on the layout too. No loose parts yet, so all of it is to buy.
    expect(n.lines[0]).toEqual({ type: 'PART', partNo: '3001', colorId: 5, name: '3001 name', colorName: 'Red', rgb: 'C91A09', need: 20, inLots: 0, toBuy: 20, modules: [m1, m2] });
    expect(n.lines[1]).toMatchObject({ partNo: '3023', colorId: 11, colorName: 'Black', need: 2, toBuy: 2, modules: [m1] });
    expect(n.totals).toEqual({ needLots: 2, needPieces: 22, inLots: 0, toBuyLots: 2, toBuyPieces: 22 });
    expect(n).toMatchObject({ builds: 2, copies: 0, unmapped: 0, buildsWithoutParts: 0 });
    expect(n.modules).toEqual({ [m1]: 12, [m2]: 10 });
    expect(await L.moduleNeeds(db, id)).toEqual(new Map([[m1, 12], [m2, 10]]));
  });

  it('counts a build once, leaves out unmapped lines, and notes builds without a parts list', async () => {
    const id = await layout();
    const m1 = ok(await L.addModule(db, id, { x: 0, y: 0 })).id;
    const a = await build('MOC-A', [['3001', 5, 10], ['rb-only', 1000, 3, false]]);
    const [none] = await db.insert(builds).values({ mocNo: 'MOC-X', name: 'Private', sourceSetNo: '31120-1', partsError: 'forbidden' }).returning({ id: builds.id }).all();
    ok(await L.setModuleItems(db, m1, { setCopyIds: [], buildIds: [a, none.id] }));
    // The one-module rule stops a second link through the service; a stray duplicate row still counts once.
    const m2 = ok(await L.addModule(db, id, { x: 1, y: 0 })).id;
    await db.insert(layoutModuleItems).values({ moduleId: m2, buildId: a });
    const n = (await L.layoutNeeds(db, id))!;
    expect(n.lines).toHaveLength(1);
    expect(n.lines[0]).toMatchObject({ need: 10, modules: [m1] });
    expect(n).toMatchObject({ builds: 2, unmapped: 1, buildsWithoutParts: 1 });
  });

  it("adds a set copy's missing parts, keeping minifigs apart from parts with the same number", async () => {
    const id = await layout();
    const m = ok(await L.addModule(db, id, { x: 0, y: 0 })).id;
    const [c1, c2] = (await sets.getSet(db, '31120-1'))!.copies;
    ok(await saveMissing(db, '31120-1', c1.id, [{ partNo: '3001', colorId: 5, type: 'PART', qty: 2 }, { partNo: 'sw0001', colorId: null, type: 'MINIFIG', qty: 1 }, { partNo: 'sw0001', colorId: 5, type: 'PART', qty: 3 }]));
    ok(await saveMissing(db, '31120-1', c2.id, [{ partNo: '3001', colorId: 5, type: 'PART', qty: 7 }])); // not on the layout
    ok(await L.setModuleItems(db, m, { setCopyIds: [c1.id], buildIds: [] }));
    const n = (await L.layoutNeeds(db, id))!;
    expect(n.lines.map((l) => [l.type, l.partNo, l.colorId, l.toBuy])).toEqual([['PART', 'sw0001', 5, 3], ['PART', '3001', 5, 2], ['MINIFIG', 'sw0001', null, 1]]);
    expect(n.copies).toBe(1);

    const w = (await L.layoutWantedListXml(db, id))!;
    expect(w).toMatchObject({ items: 3, skipped: 0, name: 'Town' });
    expect(w.xml).toContain('<!-- Parts to buy for layout Town -->');
    expect(w.xml).toContain('<ITEMTYPE>M</ITEMTYPE>\n    <ITEMID>sw0001</ITEMID>\n    <MINQTY>1</MINQTY>'); // minifigs carry no colour
    expect(w.xml).toContain('<ITEMTYPE>P</ITEMTYPE>\n    <ITEMID>3001</ITEMID>\n    <COLOR>5</COLOR>\n    <MINQTY>2</MINQTY>');
    expect(w.xml.match(/<ITEM>/g)).toHaveLength(3);
  });

  it('an empty layout needs nothing; an unknown one is undefined', async () => {
    const id = await layout();
    expect(await L.layoutNeeds(db, id)).toMatchObject({ lines: [], totals: { toBuyPieces: 0 }, builds: 0, copies: 0, modules: {} });
    expect(await L.layoutNeeds(db, 999)).toBeUndefined();
    expect(await L.layoutWantedListXml(db, 999)).toBeNull();
  });

  it('takes off what is reserved for each build, and fills from free loose parts (the issue #48 example)', async () => {
    const id = await layout();
    const m1 = ok(await L.addModule(db, id, { x: 0, y: 0 })).id;
    const m2 = ok(await L.addModule(db, id, { x: 1, y: 0 })).id;
    await build('MOC-A', [['3001', 5, 10]]);
    await build('MOC-B', [['3001', 5, 10]]);
    const [a, b] = (await db.select().from(builds).all()).map((x) => x.id);
    ok(await L.setModuleItems(db, m1, { setCopyIds: [], buildIds: [a] }));
    ok(await L.setModuleItems(db, m2, { setCopyIds: [], buildIds: [b] }));
    const lot = ok(await addLot(db, { partNo: '3001', colorId: 5, qty: 11 })).id;
    ok(await reserve(db, 'MOC-A', lot, 6)); // 6 reserved for A, 5 free
    const n = (await L.layoutNeeds(db, id))!;
    expect(n.lines[0]).toMatchObject({ need: 14, inLots: 5, toBuy: 9 });
    expect(n.modules).toEqual({ [m2]: 9 }); // A's 4 come from the free lot first (lower module id), B gets the last 1
    const w = (await L.layoutWantedListXml(db, id))!;
    expect(w.xml).toContain('<MINQTY>9</MINQTY>');
  });

  it('reserves for every build on the layout; a second run changes nothing', async () => {
    const id = await layout();
    const m1 = ok(await L.addModule(db, id, { x: 0, y: 0 })).id;
    await build('MOC-A', [['3001', 5, 10]]);
    await build('MOC-B', [['3023', 11, 4]]);
    ok(await L.setModuleItems(db, m1, { setCopyIds: [], buildIds: (await db.select().from(builds).all()).map((x) => x.id) }));
    await addLot(db, { partNo: '3001', colorId: 5, qty: 7 });
    await addLot(db, { partNo: '3023', colorId: 11, qty: 10 });
    expect(ok(await L.reserveForLayout(db, id))).toMatchObject({ builds: 2, pieces: 11, short: 3 });
    expect(ok(await L.reserveForLayout(db, id))).toMatchObject({ pieces: 0, short: 3 });
    const n = (await L.layoutNeeds(db, id))!;
    expect(n.totals).toMatchObject({ needPieces: 3, inLots: 0, toBuyPieces: 3 }); // 3001: 10 − 7 reserved; 3023: all reserved
    expect(await L.reserveForLayout(db, 999)).toMatchObject({ ok: false, status: 404 });
  });
});

