import { beforeEach, expect, it } from 'vitest';
import { openNodeDb } from '../db/node';
import type { DB } from '../db/types';
import { parseCsv } from '../csv';
import { detectCollection, planCollection } from './collection-import';
import { importCsv } from './csv';
import * as svc from './sets';

let db: DB;
beforeEach(() => { db = openNodeDb(':memory:').db; });

// Header rows as documented (see the comment in collection-import.ts); bodies are made up.
const REBRICKABLE = 'Set Number,Quantity,Includes Spares,Inventory Ver\n75192-1,2,True,1\n10497-1,1,True,1\nnot-a-set,1,True,1\n';
const BRICKSET = [
  'SetID,Number,Variant,YearFrom,Category,Theme,ThemeGroup,Subtheme,SetName,Image,ImageFilename,USRetailPrice,Pieces,Minifigs,OwnCount,WantCount,Own,Want,QtyOwned,QtyOwnedNew,QtyOwnedUsed,QtyWanted,UserNotes',
  '32069,10497,1,2022,Normal,Icons,Model making,,Galaxy Explorer,X,,99.99,1254,3,9000,500,X,,3,1,1,0,Birthday',
  '1,6080,1,1984,Normal,Castle,Historical,,King\'s Castle,X,,,674,8,1,1,,X,0,0,0,1,',
].join('\n');
const BRICKECONOMY_COPIES = 'Number,Theme,Subtheme,Year,SetName,Retail,Paid,Value,Condition,Date,Notes\n'
  + '75192-1,Star Wars,UCS,2017,Millennium Falcon,$799.99,"$650.00",$900.00,New,2023-04-01,Imported from BrickEconomy\n'
  + '10280-1,Icons,Botanicals,2021,Flower Bouquet,$49.99,$40.00,$55.00,Used (incomplete),"Mar 5, 2024",Missing a leaf\n';
const BRICKECONOMY_SETS = 'Number,Name,Theme,Subtheme,Year,Retail,Owned,Wanted,Value\n42115-1,Lamborghini,Technic,,2020,$379.99,1,0,$450\n10305-1,Lion Knights,Icons,,2022,$399.99,0,1,$420\n';

const head = (csv: string) => parseCsv(csv)[0];
const plan = (csv: string) => { const [h, ...b] = parseCsv(csv); return planCollection(detectCollection(h)!, h, b); };

it('recognises each format by its header, and nothing else', () => {
  expect(detectCollection(head(REBRICKABLE))).toBe('rebrickable');
  expect(detectCollection(head(BRICKSET))).toBe('brickset');
  expect(detectCollection(head(BRICKECONOMY_COPIES))).toBe('brickeconomy');
  expect(detectCollection(head(BRICKECONOMY_SETS))).toBe('brickeconomy');
  expect(detectCollection(['setNo', 'name', 'qty', 'location'])).toBeNull(); // Brickfolio's own and the sheet's
  expect(detectCollection(['set_num', 'quantity'])).toBe('rebrickable');
});

it('reads Rebrickable quantities', () => {
  const p = plan(REBRICKABLE);
  expect(p.items.map((i) => [i.setNo, i.copies.length])).toEqual([['75192-1', 2], ['10497-1', 1]]);
  expect(p.skipped).toEqual([{ row: 4, reason: 'not a set number' }]);
});

it('reads Brickset owned counts as new and used copies, and skips wanted-only rows', () => {
  const p = plan(BRICKSET);
  expect(p.items).toHaveLength(1);
  const [g] = p.items;
  expect([g.setNo, g.name]).toEqual(['10497-1', 'Galaxy Explorer']);
  expect(g.copies.map((c) => c.status)).toEqual(['sealed', 'built', 'built']); // 1 new, 1 used, 1 unsplit
  expect(g.copies[0].notes).toBe('Birthday');
  expect(p.skipped).toEqual([{ row: 3, reason: 'wanted, not owned' }]);
});

it('reads BrickEconomy copies (paid, condition, unambiguous dates) and per-set counts', () => {
  const c = plan(BRICKECONOMY_COPIES);
  expect(c.items[0].copies[0]).toMatchObject({ status: 'sealed', condition: 'New', pricePaid: 650, acquiredDate: '2023-04-01', notes: null });
  expect(c.items[1].copies[0]).toMatchObject({ condition: 'Partial', pricePaid: 40, acquiredDate: '2024-03-05', notes: 'Missing a leaf' });
  const s = plan(BRICKECONOMY_SETS);
  expect(s.items.map((i) => [i.setNo, i.copies.length])).toEqual([['42115-1', 1]]);
  expect(s.skipped).toHaveLength(1);
});

it('previews without writing, then imports into new and existing sets', async () => {
  await svc.addSet(db, { setNo: '75192-1', name: 'Millennium Falcon', condition: 'Used' }, { lookup: null });
  const preview = await importCsv(db, REBRICKABLE, { dryRun: true });
  if (!preview.ok) throw new Error(preview.error);
  expect(preview.summary).toMatchObject({ format: 'rebrickable', newSets: 1, existingSets: 1, copies: 3, dryRun: true });
  expect(await svc.getSet(db, '10497-1')).toBeUndefined();
  const done = await importCsv(db, REBRICKABLE);
  if (!done.ok) throw new Error(done.error);
  expect((await svc.getSet(db, '75192-1'))!.qty).toBe(3); // 1 + 2
  expect((await svc.getSet(db, '10497-1'))!.qty).toBe(1);
});

it('refuses a preview of other files', async () => {
  expect((await importCsv(db, 'setNo,name\n10280-1,Flowers\n', { dryRun: true })).ok).toBe(false);
});
