import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { colors, partLots } from '../db/schema';
import { openNodeDb } from '../db/node';
import type { DB } from '../db/types';
import type { PartLookup } from '../rebrickable/client';
import { remember } from '../identifiers/resolve';
import * as sets from './sets';
import { editCopy } from './copies';
import { replaceParts } from './parts';
import { saveMissing } from './missing';
import { detectKind, parseRebrickableCsv } from './partfile';
import * as L from './lots';

let db: DB;
const part = (partNo: string, colorId: number | null, qty: number, extra = 0, more: object = {}) => ({ matchNo: 0, partNo, name: `${partNo} name`, type: 'PART', colorId, qty, extra, alternate: false, counterpart: false, ...more });
const ok = <T extends object>(r: ({ ok: true } & T) | { ok: false; error: string }): T => { if (!r.ok) throw new Error(r.error); return r; };
const xml = (...items: [string, number | null, number, string?][]) =>
  `<INVENTORY>${items.map(([p, c, q, t = 'P']) => `<ITEM><ITEMTYPE>${t}</ITEMTYPE><ITEMID>${p}</ITEMID>${c === null ? '' : `<COLOR>${c}</COLOR>`}<MINQTY>${q}</MINQTY></ITEM>`).join('')}</INVENTORY>`;
const imp = (text: string, more: Partial<L.ImportInput> = {}) => L.importLots(db, { kind: 'bricklink_xml', text, location: 'Drawer', mode: 'add', approximate: false, ...more }, { rebrickable: null });

beforeEach(async () => {
  db = openNodeDb(':memory:').db;
  await db.insert(colors).values([{ id: 5, name: 'Red', rgb: 'C91A09' }, { id: 11, name: 'Black', rgb: '05131D' }]);
  await sets.addLocation(db, 'Drawer');
  await sets.addLocation(db, 'Shelf');
});

describe('input', () => {
  it('validates lots', () => {
    const locs = ['Drawer'];
    expect(L.parseLotInput({ partNo: '3001', colorId: '5', qty: '12', location: 'Drawer', approximate: 'on' }, locs)).toEqual({ ok: true, value: { partNo: '3001', colorId: 5, qty: 12, location: 'Drawer', approximate: true } });
    expect(L.parseLotInput({ partNo: '3001', qty: 0 }, locs)).toMatchObject({ ok: false, error: expect.stringMatching(/whole number of 1/) });
    expect(L.parseLotInput({ partNo: '3001', qty: 1.5 }, locs).ok).toBe(false);
    expect(L.parseLotInput({ partNo: '3001', qty: 1, location: 'Attic' }, locs)).toMatchObject({ ok: false, error: expect.stringMatching(/Location must be one of: Drawer/) });
    expect(L.parseLotInput({ qty: 1 }, locs).ok).toBe(false);
    expect(L.parseLotInput({ qty: 3 }, locs, true)).toEqual({ ok: true, value: { qty: 3 } });
    expect(L.parseLotInput({ partNo: '3001', qty: 1, colorId: 'red' }, locs).ok).toBe(false);
  });
});

describe('lots', () => {
  it('adds, edits, lists and removes, with names from parts lists and colours', async () => {
    await sets.addSet(db, { setNo: '10497-1', name: 'Galaxy Explorer', condition: 'Used' }, { lookup: null });
    await replaceParts(db, (await sets.getSet(db, '10497-1'))!.id, [part('3001', 5, 4)]);
    const id = ok(await L.addLot(db, { partNo: '3001', colorId: 5, qty: 12, location: 'Drawer' })).id;
    ok(await L.addLot(db, { partNo: '3023', colorId: 11, qty: 30, location: 'Shelf', approximate: true }));
    const all = await L.listLots(db);
    expect(all).toMatchObject({ total: 2, pieces: 42 });
    expect(all.lots[0]).toMatchObject({ id, partNo: '3001', name: '3001 name', colorName: 'Red', rgb: 'C91A09', qty: 12, location: 'Drawer', source: 'bin', reserved: 0 });
    expect((await L.listLots(db, { q: 'black' })).lots.map((l) => l.partNo)).toEqual(['3023']);
    expect((await L.listLots(db, { location: 'Shelf' })).total).toBe(1);
    ok(await L.editLot(db, id, { qty: 20 }));
    expect((await L.listLots(db, { q: '3001' })).lots[0].qty).toBe(20);
    ok(await L.removeLot(db, id));
    expect(await L.removeLot(db, id)).toMatchObject({ ok: false, status: 404 });
  });
});

describe('import', () => {
  it('adds to matching lots in the location, or replaces their quantity', async () => {
    const first = ok(await imp(xml(['3001', 5, 10], ['3001', 5, 2], ['sw0001', null, 1, 'M'])));
    expect(first).toMatchObject({ lots: 2, pieces: 13, merged: 0, unmapped: 0 }); // two 3001 lines merge into one lot
    const added = ok(await imp(xml(['3001', 5, 5], ['3023', 11, 4])));
    expect(added).toMatchObject({ lots: 1, merged: 1 });
    const qty = async () => Object.fromEntries((await L.listLots(db)).lots.map((l) => [`${l.partNo}/${l.location}`, l.qty]));
    expect(await qty()).toEqual({ '3001/Drawer': 17, '3023/Drawer': 4, 'sw0001/Drawer': 1 });
    ok(await imp(xml(['3001', 5, 3]), { mode: 'replace' }));
    ok(await imp(xml(['3001', 5, 7]), { location: 'Shelf' })); // another location: a new lot
    expect(await qty()).toEqual({ '3001/Drawer': 3, '3023/Drawer': 4, 'sw0001/Drawer': 1, '3001/Shelf': 7 });
  });

  it('keeps approximate counts apart from exact ones', async () => {
    ok(await imp(xml(['3001', 5, 10])));
    ok(await imp(xml(['3001', 5, 100]), { approximate: true }));
    expect((await L.listLots(db)).lots.map((l) => [l.qty, l.approximate])).toEqual([[10, false], [100, true]]);
  });

  it('refuses a malformed or huge file and writes nothing', async () => {
    expect(await imp('<INVENTORY><ITEM><ITEMID>3001</ITEMID><QTY>x</QTY></ITEM><ITEM><ITEMID>3002</ITEMID><QTY>1</QTY></ITEM></INVENTORY>')).toMatchObject({ ok: false, status: 400, error: expect.stringMatching(/Item 1 \(3001\).*Nothing was imported/) });
    expect(await imp('x'.repeat(5_000_001))).toMatchObject({ ok: false, status: 413 });
    expect((await L.listLots(db)).total).toBe(0);
  });

  it('writes large files in chunks', async () => {
    const items = Array.from({ length: 250 }, (_, i) => [`p${i}`, 5, i + 1] as [string, number, number]);
    expect(ok(await imp(xml(...items)))).toMatchObject({ lots: 250, pieces: (250 * 251) / 2 });
    expect((await L.listLots(db, { limit: 1000 })).total).toBe(250);
  });

  it('maps a Rebrickable CSV through the identifiers map, asking Rebrickable for the rest', async () => {
    await remember(db, [{ kind: 'part', scheme: 'rebrickable', value: '3001', canonical: '3001', source: 'rebrickable' }, { kind: 'color', scheme: 'rebrickable', value: 4, canonical: 5, source: 'rebrickable' }]);
    const asked: string[][] = [];
    const lookup: PartLookup = {
      async colors() { return [{ id: 0, name: 'Black', bricklink: ['11'], ldraw: ['0'] }]; },
      async partsByNumbers(nos) { asked.push(nos); return [{ partNo: '3069bpr0001', name: 'Tile', bricklink: ['3069bp01'], ldraw: [] }]; },
    };
    const csv = 'Part,Color,Quantity,Is Spare\n3001,4,6,False\n3001,4,2,True\n3069bpr0001,0,1,False\nrb-only,4,3,False\n3005,4,0,False\n';
    const r = ok(await L.importLots(db, { kind: 'rebrickable_csv', text: csv, location: null, mode: 'add', approximate: false }, { rebrickable: lookup }));
    expect(r).toMatchObject({ lots: 3, pieces: 12, unmapped: 1, skipped: 1, note: null });
    expect(asked).toEqual([['3069bpr0001', 'rb-only']]);
    const lots = (await L.listLots(db)).lots.map((l) => [l.partNo, l.colorId, l.qty, l.mapped]);
    expect(lots).toEqual([['3001', 5, 8, true], ['3069bp01', 11, 1, true], ['rb-only', 4, 3, false]]); // spares kept
  });

  it('imports a Rebrickable CSV unmapped without a key, and says so', async () => {
    const r = ok(await L.importLots(db, { kind: 'rebrickable_csv', text: 'part,color,quantity\n3001,4,6\n', location: null, mode: 'add', approximate: false }, { rebrickable: null }));
    expect(r).toMatchObject({ unmapped: 1, note: expect.stringMatching(/REBRICKABLE_API_KEY/) });
  });

  it('undoes an import: created lots go, merged ones get their quantity back', async () => {
    const keep = ok(await L.addLot(db, { partNo: '3001', colorId: 5, qty: 10, location: 'Drawer' })).id;
    const r = ok(await imp(xml(['3001', 5, 5], ['3023', 11, 4])));
    expect((await L.listImports(db)).map((i) => i.id)).toEqual([r.batch]);
    expect(ok(await L.undoImport(db, r.batch))).toMatchObject({ removed: 1, restored: 1, kept: 0 });
    expect((await L.listLots(db)).lots.map((l) => [l.id, l.qty])).toEqual([[keep, 10]]);
    expect(await L.undoImport(db, r.batch)).toMatchObject({ ok: false, error: expect.stringMatching(/already undone/) });
    expect(await L.listImports(db)).toEqual([]);
  });

  it('tells the file kinds apart', () => {
    expect(detectKind('', 'wanted.xml')).toBe('bricklink_xml');
    expect(detectKind('<?xml version="1.0"?><INVENTORY>')).toBe('bricklink_xml');
    expect(detectKind('﻿Part,Color,Quantity\n')).toBe('rebrickable_csv');
    expect(detectKind('hello')).toBeNull();
    expect(parseRebrickableCsv('Name,Qty\nx,1').errors[0]).toMatch(/Part, Color and Quantity/);
  });
});

describe('parted-out copies', () => {
  beforeEach(async () => {
    await sets.addSet(db, { setNo: '10497-1', name: 'Galaxy Explorer', condition: 'Used', qty: 2, location: 'Shelf' }, { lookup: null });
    const s = (await sets.getSet(db, '10497-1'))!;
    await replaceParts(db, s.id, [part('3001', 5, 6, 1), part('3001', 5, 2), part('3023', 11, 4), part('3002', 5, 9, 0, { alternate: true }), part('3003', 5, 1, 0, { counterpart: true }), { ...part('sp047', null, 1), type: 'MINIFIG' }]);
  });

  it('makes lots from the parts list with spares, less missing parts, alternates and counterparts', async () => {
    const [c1] = (await sets.getSet(db, '10497-1'))!.copies;
    ok(await saveMissing(db, '10497-1', c1.id, [{ partNo: '3023', colorId: 11, type: 'PART', qty: 4 }, { partNo: '3001', colorId: 5, type: 'PART', qty: 1 }]));
    expect(ok(await editCopy(db, c1.id, { status: 'parted_out' }))).toMatchObject({ lots: 2 });
    const lots = (await L.listLots(db)).lots.map((l) => [l.type, l.partNo, l.colorId, l.qty, l.location, l.source, l.from]);
    expect(lots).toEqual([['PART', '3001', 5, 8, 'Shelf', 'set_copy', '10497, copy 1'], ['MINIFIG', 'sp047', null, 1, 'Shelf', 'set_copy', '10497, copy 1']]);
    expect(await L.partOutCopy(db, c1.id)).toBe(0); // only once
  });

  it('putting a copy back together removes its lots, unless one was changed', async () => {
    const [c1, c2] = (await sets.getSet(db, '10497-1'))!.copies;
    ok(await editCopy(db, c1.id, { status: 'parted_out' }));
    ok(await editCopy(db, c1.id, { status: 'built' }));
    expect((await L.listLots(db)).total).toBe(0);

    ok(await editCopy(db, c2.id, { status: 'parted_out' }));
    const [lot] = await db.select().from(partLots).where(eq(partLots.partNo, '3023')).all();
    await new Promise((r) => setTimeout(r, 2));
    ok(await L.editLot(db, lot.id, { qty: 2 }));
    expect(await editCopy(db, c2.id, { status: 'built' })).toMatchObject({ ok: false, status: 409, error: expect.stringMatching(/changed since it was parted out/) });
    expect((await sets.getSet(db, '10497-1'))!.copies.find((c) => c.id === c2.id)!.status).toBe('parted_out');
  });
});
