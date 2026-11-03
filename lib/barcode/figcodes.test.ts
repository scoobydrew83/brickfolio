import { beforeEach, expect, it } from 'vitest';
import { openNodeDb } from '../db/node';
import type { DB } from '../db/types';
import { cmfFigs, minifigs, themes } from '../db/schema';
import { bundledSeries, loose, parseFigCode, rememberFigCode, resolveFigCode } from './figcodes';
import { applyCommunity } from './community';

let db: DB;
beforeEach(() => { db = openNodeDb(':memory:').db; });

it('reads a box code: 7 digits, then factory and year from the production code', () => {
  expect(parseFigCode('6472866 444S3')).toEqual({ raw: '6472866 444S3', code: '6472866', factory: 'S', year: '3' });
  expect(parseFigCode('6472866')).toMatchObject({ code: '6472866', factory: '', year: '' });
  expect(parseFigCode('64728661234 44')).toMatchObject({ code: '6472866', factory: '', year: '' });
  expect(parseFigCode('5702015869935')).toMatchObject({ code: '5702015' }); // a retail barcode is only passed here by mistake // a retail barcode would only be passed here by mistake
  expect(parseFigCode('hello')).toBeNull();
  expect(parseFigCode('')).toBeNull();
});

it('compares names loosely without eating parts of words', () => {
  expect(loose('Spider-Man: Across the Spider-Verse')).toBe(loose('Spider-Man Across the Spider-Verses'));
  expect(loose('Series 25')).toBe('25');
  expect(loose('Panther')).toBe('panther');
});

it('finds a figure in the bundled L-Scan table, the exact factory first', async () => {
  const r = await resolveFigCode(db, '6472866 444S3');
  expect(r).toMatchObject({ status: 'matched', candidates: [{ name: 'Film Noir Detective', series: 'Series 25', source: 'lscan', exact: true, rbFigNo: null }] });
  expect(await resolveFigCode(db, '0000000 444S3')).toMatchObject({ status: 'not_found' });
  expect(await resolveFigCode(db, 'nope')).toMatchObject({ status: 'invalid' });
  expect(bundledSeries().length).toBeGreaterThan(5);
});

it('links to the Rebrickable checklist and says how many you own', async () => {
  await db.insert(themes).values([{ id: 535, parentId: null, name: 'Collectible Minifigures' }, { id: 9003, parentId: 535, name: 'Series 25' }]);
  await db.insert(cmfFigs).values({ rbFigNo: 'fig-013525', themeId: 9003, name: 'Film Noir Detective', numParts: 5, imageUrl: 'https://cdn.rebrickable.com/x.jpg', fetchedAt: new Date().toISOString() });
  await db.insert(minifigs).values({ rbFigNo: 'fig-013525', name: 'Film Noir Detective', qty: 2 });
  expect(await resolveFigCode(db, '6472866 444S3')).toMatchObject({ candidates: [{ rbFigNo: 'fig-013525', themeId: 9003, imageUrl: 'https://cdn.rebrickable.com/x.jpg', owned: 2 }] });
});

it('loads a missing checklist on demand', async () => {
  await db.insert(themes).values([{ id: 535, parentId: null, name: 'Collectible Minifigures' }, { id: 9003, parentId: 535, name: 'Series 25' }]);
  let asked = 0;
  const r = await resolveFigCode(db, '6472866 444S3', { loadSeries: async (id) => { asked = id; await db.insert(cmfFigs).values({ rbFigNo: 'fig-013525', themeId: id, name: 'Film Noir Detective', fetchedAt: 'x' }); } });
  expect(asked).toBe(9003);
  expect(r).toMatchObject({ candidates: [{ rbFigNo: 'fig-013525' }] });
});

it('your confirmed code wins over the community list, which wins over L-Scan', async () => {
  await applyCommunity(db, { license: 'CC0-1.0', sets: [], minifigs: [{ code: '6472866', factory: 'S', year: '3', name: 'Harpy', series: 'Series 25' }] });
  expect(await resolveFigCode(db, '6472866 444S3')).toMatchObject({ candidates: [{ name: 'Harpy', source: 'community' }] });
  expect(await rememberFigCode(db, '6472866 444S3', { name: 'Film Noir Detective', series: 'Series 25' })).toMatchObject({ ok: true });
  expect(await resolveFigCode(db, '6472866 444S3')).toMatchObject({ status: 'matched', candidates: [{ name: 'Film Noir Detective', source: 'user', verified: true }] });
  expect(await rememberFigCode(db, 'nope', { name: 'x', series: 'y' })).toMatchObject({ ok: false });
  expect(await rememberFigCode(db, '6472866', { name: 'x', series: 'y', rbFigNo: 'sw0001' })).toMatchObject({ ok: false });
});
