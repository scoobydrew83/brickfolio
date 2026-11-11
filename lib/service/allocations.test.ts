import { beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { buildParts, builds, partAllocations, setCopies } from '../db/schema';
import { openNodeDb } from '../db/node';
import type { DB } from '../db/types';
import type { BuildSource } from '../rebrickable/client';
import * as sets from './sets';
import { replaceParts } from './parts';
import { addLot, editLot, listLots, removeLot } from './lots';
import { addBuild, buildMatches, parseBuildInput, removeBuild, setBuildParts, syncBuilds, wantedListXml } from './builds';
import { autoReserve, availability, listReservations, release, reserve } from './allocations';

let db: DB;
const ok = <T extends object>(r: ({ ok: true } & T) | { ok: false; error: string }): T => { if (!r.ok) throw new Error(r.error); return r; };
const part = (partNo: string, colorId: number | null, qty: number) => ({ matchNo: 0, partNo, name: partNo, type: 'PART', colorId, qty, extra: 0, alternate: false, counterpart: false });

/** A build with its parts list; `[partNo, colorId, qty]`. */
async function build(mocNo: string, lines: [string, number, number][], kind: 'alternate' | 'moc' | 'custom' = 'moc') {
  const [b] = await db.insert(builds).values({ mocNo, name: `Build ${mocNo}`, sourceSetNo: kind === 'alternate' ? '31120-1' : '', kind, partsFetchedAt: '2026-11-01T00:00:00Z' }).returning({ id: builds.id }).all();
  for (const [partNo, colorId, qty] of lines) await db.insert(buildParts).values({ buildId: b.id, partNo, colorId, qty, mapped: true });
  return b.id;
}
const lot = async (partNo: string, colorId: number, qty: number, more: { location?: string; approximate?: boolean } = {}) => ok(await addLot(db, { partNo, colorId, qty, ...more })).id;
const match = async (mocNo: string) => (await buildMatches(db)).find((b) => b.mocNo === mocNo)!;

beforeEach(async () => {
  db = openNodeDb(':memory:').db;
  await sets.addLocation(db, 'Drawer A');
  await sets.addLocation(db, 'Drawer B');
});

describe('reserving', () => {
  it('auto-reserves what each line still needs: exact lots first, then by location order, then the biggest', async () => {
    await build('MOC-1', [['3001', 5, 10], ['3023', 11, 4]]);
    const rough = await lot('3001', 5, 100, { location: 'Drawer A', approximate: true });
    const b = await lot('3001', 5, 6, { location: 'Drawer B' });
    const a = await lot('3001', 5, 3, { location: 'Drawer A' });
    const other = await lot('3001', 11, 50); // wrong colour
    expect(ok(await autoReserve(db, 'MOC-1'))).toMatchObject({ reserved: 3, pieces: 10, short: 4 }); // no 3023 lots
    const r = Object.fromEntries((await listReservations(db, { mocNo: 'MOC-1' })).map((x) => [x.lotId, x.qty]));
    expect(r).toEqual({ [a]: 3, [b]: 6, [rough]: 1 });
    expect(r[other]).toBeUndefined();
    expect(ok(await autoReserve(db, 'MOC-1'))).toMatchObject({ reserved: 0, pieces: 0, short: 4 }); // a second run changes nothing
  });

  it('two builds compete for one lot, and neither can take more than is free', async () => {
    await build('MOC-1', [['3001', 5, 10]]);
    await build('MOC-2', [['3001', 5, 10]]);
    const l = await lot('3001', 5, 12);
    ok(await autoReserve(db, 'MOC-1'));
    expect(ok(await autoReserve(db, 'MOC-2'))).toMatchObject({ pieces: 2, short: 8 });
    expect(await reserve(db, 'MOC-2', l, 5)).toMatchObject({ ok: false, status: 409, error: expect.stringMatching(/Only 2 of that lot are free/) });
    ok(await reserve(db, 'MOC-1', l, 4)); // lower A's
    ok(await reserve(db, 'MOC-2', l, 8));
    expect((await listReservations(db, { lotId: l })).map((x) => [x.mocNo, x.qty])).toEqual([['MOC-1', 4], ['MOC-2', 8]]);
  });

  it('refuses a lot the build does not use, and unknown builds and lots', async () => {
    await build('MOC-1', [['3001', 5, 10]]);
    const wrong = await lot('3001', 11, 5);
    expect(await reserve(db, 'MOC-1', wrong, 1)).toMatchObject({ ok: false, status: 400, error: expect.stringMatching(/doesn't use/) });
    expect(await reserve(db, 'MOC-9', wrong, 1)).toMatchObject({ ok: false, status: 404 });
    expect(await reserve(db, 'MOC-1', 999, 1)).toMatchObject({ ok: false, status: 404 });
    expect(await reserve(db, 'MOC-1', wrong, -1)).toMatchObject({ ok: false, status: 400 });
  });

  it('releases one lot or all, and reserving 0 releases too', async () => {
    await build('MOC-1', [['3001', 5, 10], ['3023', 11, 2]]);
    const a = await lot('3001', 5, 10), b = await lot('3023', 11, 2);
    ok(await autoReserve(db, 'MOC-1'));
    expect(ok(await release(db, 'MOC-1', a))).toMatchObject({ pieces: 10 });
    ok(await reserve(db, 'MOC-1', b, 0));
    expect(await listReservations(db, { mocNo: 'MOC-1' })).toEqual([]);
    ok(await autoReserve(db, 'MOC-1'));
    expect(ok(await release(db, 'MOC-1'))).toMatchObject({ pieces: 12 });
    expect((await availability(db)).freeLots.get('PART|3001|5')).toBe(10);
  });

  it('a lot cannot drop below what is reserved, or be removed without force', async () => {
    await build('MOC-1', [['3001', 5, 10]]);
    const l = await lot('3001', 5, 12);
    ok(await autoReserve(db, 'MOC-1'));
    expect((await listLots(db)).lots[0]).toMatchObject({ reserved: 10, reservedFor: [{ mocNo: 'MOC-1', name: 'Build MOC-1', qty: 10 }] });
    expect(await editLot(db, l, { qty: 9 })).toMatchObject({ ok: false, status: 409, error: expect.stringMatching(/reserved for Build MOC-1 \(10x\)/) });
    ok(await editLot(db, l, { qty: 10 }));
    expect(await removeLot(db, l)).toMatchObject({ ok: false, status: 409 });
    ok(await removeLot(db, l, true));
    expect(await db.select().from(partAllocations).all()).toEqual([]);
  });
});

describe('what you can build', () => {
  beforeEach(async () => {
    // A set with 4 red 2x4 bricks.
    await sets.addSet(db, { setNo: '31120-1', name: 'Medieval Castle', condition: 'Used' }, { lookup: null });
    await replaceParts(db, (await sets.getSet(db, '31120-1'))!.id, [part('3001', 5, 4)]);
  });

  it('counts set parts, free lots and the build\'s own reservations; another build\'s are gone', async () => {
    await build('MOC-A', [['3001', 5, 10]]);
    await build('MOC-B', [['3001', 5, 10]]);
    expect(await match('MOC-A')).toMatchObject({ have: 4, pct: 40, fromLots: 0 });
    await lot('3001', 5, 8);
    expect(await match('MOC-A')).toMatchObject({ have: 10, pct: 100, fromLots: 6, reserved: 0 }); // 4 in the set, 6 of the 8 free
    ok(await reserve(db, 'MOC-A', (await listLots(db)).lots[0].id, 6));
    expect(await match('MOC-A')).toMatchObject({ have: 10, pct: 100, reserved: 6, fromLots: 6 });
    expect(await match('MOC-B')).toMatchObject({ have: 6, missingPieces: 4, reserved: 0, fromLots: 2 }); // 4 in the set + 2 still free
    expect((await wantedListXml(db, 'MOC-B'))!.xml).toContain('<ITEMID>3001</ITEMID>\n    <COLOR>5</COLOR>\n    <MINQTY>4</MINQTY>');
    expect((await wantedListXml(db, 'MOC-A'))!.items).toBe(0);
  });

  it('a build covered by loose parts alone shows 100%', async () => {
    await build('MOC-A', [['3023', 11, 20]]);
    await lot('3023', 11, 20);
    expect(await match('MOC-A')).toMatchObject({ pct: 100, fromLots: 20 });
  });

  it('a parted-out copy\'s set parts no longer count', async () => {
    await build('MOC-A', [['3001', 5, 4]]);
    expect((await match('MOC-A')).pct).toBe(100);
    const [c] = (await sets.getSet(db, '31120-1'))!.copies;
    await db.update(setCopies).set({ status: 'parted_out' }).where(eq(setCopies.id, c.id));
    expect((await match('MOC-A')).pct).toBe(0);
  });
});

describe('MOCs and your own builds', () => {
  it('validates input', () => {
    expect(parseBuildInput({ kind: 'moc', mocNo: 'moc-123' })).toEqual({ ok: true, value: { kind: 'moc', mocNo: 'MOC-123', name: null } });
    expect(parseBuildInput({ kind: 'moc', mocNo: '123' }).ok).toBe(false);
    expect(parseBuildInput({ kind: 'custom', name: '' }).ok).toBe(false);
    expect(parseBuildInput({ kind: 'set' }).ok).toBe(false);
  });

  it('adds a MOC by number with its Rebrickable name, and the sync fetches its parts', async () => {
    ok(await addBuild(db, { kind: 'moc', mocNo: 'MOC-77' }, { async moc(no) { return { mocNo: no, name: 'Harbour Crane', numParts: 300, imageUrl: null, url: 'https://rebrickable.com/mocs/MOC-77/', designer: 'ada' }; } }));
    expect(await addBuild(db, { kind: 'moc', mocNo: 'MOC-77' })).toMatchObject({ ok: false, status: 409 });
    expect(await addBuild(db, { kind: 'moc', mocNo: 'MOC-78' }, { async moc() { return null; } })).toMatchObject({ ok: false, status: 404 });
    const custom = ok(await addBuild(db, { kind: 'custom', name: 'My tram' })).mocNo;
    const asked: string[] = [];
    const src: BuildSource = { async alternates() { return []; }, async buildParts(no) { asked.push(no); return [{ partNo: '3001', colorId: 4, qty: 2, part: { bricklink: ['3001'], ldraw: [] }, color: { bricklink: ['5'], ldraw: [] } }]; } };
    await syncBuilds(db, src);
    expect(asked).toEqual(['MOC-77']); // custom builds aren't Rebrickable numbers
    expect(await match('MOC-77')).toMatchObject({ name: 'Harbour Crane', kind: 'moc', sourceSetNo: '', partsKnown: true, need: 2 });
    expect(await match(custom)).toMatchObject({ name: 'My tram', kind: 'custom', partsKnown: false });
    expect((await buildMatches(db, { kind: 'custom' })).map((b) => b.mocNo)).toEqual([custom]);
  });

  it('takes a parts list for your own build from a file, and removes it with its reservations', async () => {
    const no = ok(await addBuild(db, { kind: 'custom', name: 'My tram' })).mocNo;
    const r = ok(await setBuildParts(db, no, 'bricklink_xml', '<INVENTORY><ITEM><ITEMTYPE>P</ITEMTYPE><ITEMID>3001</ITEMID><COLOR>5</COLOR><MINQTY>6</MINQTY></ITEM><ITEM><ITEMTYPE>P</ITEMTYPE><ITEMID>3001</ITEMID><COLOR>5</COLOR><MINQTY>2</MINQTY></ITEM><ITEM><ITEMTYPE>M</ITEMTYPE><ITEMID>sw0001</ITEMID><MINQTY>1</MINQTY></ITEM></INVENTORY>', null));
    expect(r).toMatchObject({ lines: 1, pieces: 8, skipped: 1 });
    await lot('3001', 5, 8);
    ok(await autoReserve(db, no));
    expect(await match(no)).toMatchObject({ partsKnown: true, need: 8, pct: 100, reserved: 8 });
    ok(await removeBuild(db, no));
    expect(await db.select().from(partAllocations).all()).toEqual([]);
    const alt = await build('MOC-5', [['3001', 5, 1]], 'alternate');
    expect(await removeBuild(db, 'MOC-5')).toMatchObject({ ok: false, status: 409 });
    expect(await setBuildParts(db, 'MOC-5', 'bricklink_xml', '<INVENTORY/>', null)).toMatchObject({ ok: false, status: 409 });
    expect(alt).toBeGreaterThan(0);
  });

  it('a new parts list gives back reservations the build no longer needs', async () => {
    const no = ok(await addBuild(db, { kind: 'custom', name: 'My tram' })).mocNo;
    const xml = (lines: [string, number, number][]) => `<INVENTORY>${lines.map(([p, c, q]) => `<ITEM><ITEMTYPE>P</ITEMTYPE><ITEMID>${p}</ITEMID><COLOR>${c}</COLOR><MINQTY>${q}</MINQTY></ITEM>`).join('')}</INVENTORY>`;
    ok(await setBuildParts(db, no, 'bricklink_xml', xml([['3001', 5, 10], ['3023', 11, 6]]), null));
    await lot('3001', 5, 4);
    await lot('3001', 5, 8, { approximate: true });
    await lot('3023', 11, 6);
    ok(await autoReserve(db, no));
    ok(await setBuildParts(db, no, 'bricklink_xml', xml([['3001', 5, 5]]), null)); // 3023 gone, 3001 down to 5
    const r = await listReservations(db, { mocNo: no });
    expect(r.map((x) => [x.partNo, x.qty, x.approximate])).toEqual([['3001', 4, false], ['3001', 1, true]]); // approximate trimmed first
    expect((await availability(db)).freeLots.get('PART|3023|11')).toBe(6);
    expect(await match(no)).toMatchObject({ reserved: 5 });
  });

  it('two reservations at once cannot take the same pieces', async () => {
    await build('MOC-1', [['3001', 5, 10]]);
    await build('MOC-2', [['3001', 5, 10]]);
    const l = await lot('3001', 5, 10);
    // Both checks pass before either writes (as on D1); the write itself re-checks.
    const [a, b] = await Promise.all([reserve(db, 'MOC-1', l, 10), reserve(db, 'MOC-2', l, 10)]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    const [{ total }] = await db.select({ total: sql<number>`sum(${partAllocations.qty})` }).from(partAllocations).all();
    expect(Number(total)).toBe(10);
  });
});

