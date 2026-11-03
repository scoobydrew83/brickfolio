import { beforeEach, expect, it } from 'vitest';
import type { MinifigLookup } from '../bricklink/client';
import { openNodeDb } from '../db/node';
import type { DB } from '../db/types';
import { themes } from '../db/schema';
import type { FigSource } from '../rebrickable/client';
import * as figs from './minifigs';

let db: DB;
let calls: string[];
const lookup: MinifigLookup = async (no, guide) => {
  calls.push(`${no}:${guide}`);
  if (no === 'xx0000') throw new Error('item: not found');
  return { blName: `BL ${no}`, year: 2020, categoryId: 65, imageUrl: null, avgSold: guide === 'N' ? 12 : 8, minSold: 5, maxSold: 20, qtySold: 4 };
};
const locs = ['Display', 'Storage', 'Sell'];
beforeEach(() => { db = openNodeDb(':memory:').db; calls = []; });

it('validates input', () => {
  expect(figs.parseFigInput({ figNo: 'SW0001', condition: 'New' }, locs)).toEqual({ ok: true, value: { figNo: 'sw0001', condition: 'New' } });
  expect(figs.parseFigInput({ figNo: 'col25-3' }, locs).ok).toBe(true);
  expect(figs.parseFigInput({ figNo: '10497' }, locs).ok).toBe(false);
  expect(figs.parseFigInput({}, locs).ok).toBe(false);
  expect(figs.parseFigInput({ figNo: 'sw0001', location: 'Attic' }, locs).ok).toBe(false);
});

it('adds, prices, merges copies, edits and removes a figure', async () => {
  const r = await figs.addMinifig(db, { figNo: 'sw0001', condition: 'Used' }, { lookup });
  expect(r.ok && r.minifig).toMatchObject({ name: 'BL sw0001', avgSold: 8, estValue: 8, qty: 1, blError: null });
  expect(await figs.addMinifig(db, { figNo: 'sw0001' }, { lookup })).toMatchObject({ ok: false, status: 409 });
  expect(await figs.addMinifig(db, { figNo: 'sw0001', qty: 2 }, { lookup, merge: true })).toMatchObject({ ok: true, merged: true, minifig: { qty: 3 } });

  calls = [];
  const e = await figs.editMinifig(db, 'sw0001', { condition: 'New', location: 'Display' }, lookup);
  expect(e.ok && e.minifig).toMatchObject({ condition: 'New', avgSold: 12, location: 'Display' });
  expect(calls).toEqual(['sw0001:N']); // re-priced at the new guide

  expect(await figs.removeMinifig(db, 'sw0001')).toEqual({ ok: true, remaining: 2 });
  expect(figs.minifigTotals(await figs.listMinifigs(db))).toEqual({ count: 1, copies: 2, estValue: 24, unpriced: 0 });
});

it('keeps lookup errors on the figure, and the sync re-prices only BrickLink-numbered figures', async () => {
  await figs.addMinifig(db, { figNo: 'xx0000' }, { lookup });
  await figs.addMinifig(db, { rbFigNo: 'fig-000001', name: 'Mermaid' }, { lookup });
  expect((await figs.getMinifig(db, 'xx0000'))!.blError).toContain('not found');
  calls = [];
  expect(await figs.syncMinifigs(db, lookup)).toBe(1);
  expect(calls).toEqual(['xx0000:U']);
});

it('builds the Collectible Minifigures checklist from Rebrickable and caches it', async () => {
  await db.insert(themes).values([{ id: 535, name: 'Collectible Minifigures' }, { id: 700, parentId: 535, name: 'Series 25' }, { id: 701, parentId: 535, name: 'Series 26' }]);
  expect(await figs.cmfSeries(db)).toEqual([{ themeId: 701, name: 'Series 26' }, { themeId: 700, name: 'Series 25' }]);
  let asked = 0;
  const src: FigSource = { async themeFigs() { asked++; return [{ figNo: 'fig-000001', name: 'Mermaid', numParts: 5, imageUrl: null }, { figNo: 'fig-000002', name: 'Goatherd', numParts: 6, imageUrl: null }]; } };
  await figs.addMinifig(db, { rbFigNo: 'fig-000001', name: 'Mermaid' }, { lookup: null });

  const c = await figs.cmfChecklist(db, 700, src);
  expect(c).toMatchObject({ ok: true, owned: 1, total: 2 });
  expect(c.ok && c.figs.map((f) => [f.name, f.owned])).toEqual([['Goatherd', 0], ['Mermaid', 1]]);
  await figs.cmfChecklist(db, 700, src);
  expect(asked).toBe(1); // cached

  // Adding the BrickLink number later attaches it to the ticked-off figure instead of making a second one.
  const r = await figs.addMinifig(db, { figNo: 'col25-1', rbFigNo: 'fig-000001' }, { lookup, merge: true });
  expect(r.ok && r.minifig).toMatchObject({ figNo: 'col25-1', rbFigNo: 'fig-000001', qty: 2 });
  expect(await figs.cmfChecklist(db, 701, null)).toMatchObject({ ok: false });
});
