import { expect, it } from 'vitest';
import { inArray } from 'drizzle-orm';
import { openNodeDb } from '../db/node';
import { sets } from '../db/schema';
import { importCsv, parseCsv, setsCsv } from './csv';
import { listSetParts } from './parts';
import { listHistory, listLocations, listSets } from './sets';

it('parses quoted CSV', () => {
  expect(parseCsv('a,"b ""x"", c"\r\n1,2\n\n')).toEqual([['a', 'b "x", c'], ['1', '2']]);
});

it('imports the Google Sheet tabs and round-trips its own export', async () => {
  const { db } = openNodeDb(':memory:');
  const sheet = [
    'row_number,Lego #,Set Name,Location,Condition,Reg?,Avg Sold,Est. Value,Pieces,Qty,Missing %',
    '2,10280,Flower Bouquet,Out,Used,Y,$22.88,22.88,"1,765",,',
    '3,43205-1,"Castle, Ultimate",Storage,New,,81.84,81.84,749,2,0.25',
    '5,6000,Pct,,,,,,,,15%',
    '6,6001,Whole,,,,,,,,30',
    '4,junk,x,,,,,,,,',
  ].join('\n');
  expect(await importCsv(db, sheet)).toEqual({ ok: true, kind: 'sets', count: 4 });
  expect((await listSets(db)).map((r) => r.missingPct)).toEqual([null, 25, 15, 30]); // fraction, "15%", percent
  await db.delete(sets).where(inArray(sets.setNo, ['6000-1', '6001-1']));
  const rows = await listSets(db);
  expect(rows.map((r) => [r.setNo, r.name, r.qty, r.avgSold, r.pieces])).toEqual([
    ['10280-1', 'Flower Bouquet', 1, 22.88, 1765],
    ['43205-1', 'Castle, Ultimate', 2, 81.84, 749],
  ]);
  expect(await listLocations(db)).toContain('Out'); // unknown locations are added

  expect(rows[1].copies.map((c) => [c.status, c.condition, c.location, c.missingPct])).toEqual([['sealed', 'New', 'Storage', 25], ['sealed', 'New', 'Storage', 25]]);
  expect(await importCsv(db, setsCsv(rows))).toMatchObject({ ok: true, count: 3 }); // one row per copy, idempotent
  expect(await listSets(db)).toEqual(rows);
  expect(await importCsv(db, sheet.split('\n').slice(0, 3).join('\n'))).toMatchObject({ ok: true, count: 2 }); // the sheet again: same copy counts
  expect((await listSets(db)).map((r) => r.qty)).toEqual([1, 2]);

  expect(await importCsv(db, 'Date,Sets,Copies,Est. Value,Avg Sold,Pieces\n2026-10-25,2,3,100,120,2000\nbad,1,1,1,1,1')).toEqual({ ok: true, kind: 'history', count: 1 });
  expect(await listHistory(db)).toEqual([{ date: '2026-10-25', sets: 2, copies: 3, estValue: 100, avgSold: 120, pieces: 2000 }]);
  expect((await importCsv(db, 'foo,bar\n1,2')).ok).toBe(false);
});

it('imports the Parts tab, replacing each set\'s list and counting pieces like the sheet', async () => {
  const { db } = openNodeDb(':memory:');
  await importCsv(db, 'Lego #,Set Name,Pieces\n10280,Flower Bouquet,999');
  const csv = [
    'Set No,Part No,Part Name,Type,Color ID,Qty,Extra,Alternate,Counterpart',
    '10280-1,3001,Brick 2 x 4,PART,5,10,1,FALSE,FALSE',
    '10280-1,3002,"Brick 2 x 3, Red",PART,5,4,0,TRUE,FALSE',
    '10280-1,col1,Gardener,MINIFIG,,1,0,false,true',
    '99999-1,3001,Brick,PART,5,1,0,FALSE,FALSE',
  ].join('\n');
  expect(await importCsv(db, csv)).toEqual({ ok: true, kind: 'parts', count: 3, skipped: 1 });
  expect(await importCsv(db, csv)).toMatchObject({ count: 3 }); // replaces, doesn't duplicate
  const [s] = await listSets(db);
  expect([s.pieces, s.partLots]).toEqual([11, 3]); // 10 + 1, alternate skipped
  expect((await listSetParts(db, s.id)).find((p) => p.partNo === 'col1')).toMatchObject({ type: 'MINIFIG', colorId: null, counterpart: true });
});

it('exports formula-like text as plain text and imports it back unchanged', async () => {
  const { db } = openNodeDb(':memory:');
  await importCsv(db, 'Lego #,Set Name,Notes\n10280,"=HYPERLINK(""http://evil"")",@sum\n10281,-dash,+plus');
  const out = setsCsv(await listSets(db));
  expect(out).toContain(`"'=HYPERLINK(""http://evil"")"`);
  expect(out).toContain("'@sum");
  expect(out).toContain("'-dash");
  expect(out).not.toMatch(/(^|,)[=+@]/m); // no cell starts a formula
  const before = await listSets(db);
  await importCsv(db, out);
  expect(await listSets(db)).toEqual(before);
});
