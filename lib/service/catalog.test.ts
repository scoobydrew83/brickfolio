import { beforeEach, expect, it } from 'vitest';
import type { Lookup } from '../bricklink/client';
import { openNodeDb } from '../db/node';
import type { DB } from '../db/types';
import type { Catalog } from '../rebrickable/client';
import { rebrickableStats, syncCatalog, themeMap, themeNames } from './catalog';
import { rebrickableRun, startRebrickableSync } from '../rebrickable/run';
import * as svc from './sets';

let db: DB;
const lookup: Lookup = async () => ({ blName: 'BL', year: 2021, categoryId: 1, imageUrl: null, avgSold: 40, minSold: 30, maxSold: 50, qtySold: 3 });
let calls: string[];
const catalog: Catalog = {
  async themes() { calls.push('themes'); return [{ id: 721, parentId: null, name: 'Icons' }, { id: 722, parentId: 721, name: 'Botanical Collection' }, { id: 158, parentId: null, name: 'Star Wars' }]; },
  async set(no) { calls.push(`set:${no}`); if (no === '10280-1') return { setNo: no, name: 'Flower Bouquet', year: 2021, themeId: 722, numParts: 756, imageUrl: null }; if (no === '75192-1') return { setNo: no, name: 'Falcon', year: 2017, themeId: 158, numParts: 7541, imageUrl: null }; if (no === '500-1') throw new Error('boom'); return null; },
  async minifigCount(no) { calls.push(`figs:${no}`); return no === '75192-1' ? 8 : 0; },
};

beforeEach(() => { db = openNodeDb(':memory:').db; calls = []; });

it('names top-level themes and subthemes', async () => {
  const map = new Map([[1, { name: 'Icons', parentId: null }], [2, { name: 'Botanical', parentId: 1 }], [3, { name: 'Bouquets', parentId: 2 }]]);
  expect(themeNames(map, 3)).toEqual({ theme: 'Icons', subtheme: 'Bouquets' });
  expect(themeNames(map, 1)).toEqual({ theme: 'Icons', subtheme: null });
  expect(themeNames(map, null)).toEqual({ theme: null, subtheme: null });
  expect(themeNames(map, 99)).toEqual({ theme: null, subtheme: null });
});

it('fills theme and minifigs once, keeps BrickLink prices, and skips matched sets next time', async () => {
  for (const setNo of ['10280-1', '75192-1', '1234-1', '500-1']) await svc.addSet(db, { setNo, name: 'Test', condition: 'Used' }, { lookup });
  const before = (await svc.listSets(db)).map((s) => s.estValue);

  const errors = await syncCatalog(db, catalog);
  expect(errors).toEqual(['Rebrickable #500-1: boom']);
  const byNo = Object.fromEntries((await svc.listSets(db)).map((s) => [s.setNo, s]));
  expect(byNo['10280-1']).toMatchObject({ theme: 'Icons', subtheme: 'Botanical Collection', minifigs: 0 });
  expect(byNo['75192-1']).toMatchObject({ theme: 'Star Wars', subtheme: null, minifigs: 8 });
  expect(byNo['1234-1']).toMatchObject({ theme: null, minifigs: null }); // unknown on Rebrickable
  expect((await svc.listSets(db)).map((s) => s.estValue)).toEqual(before);
  expect((await themeMap(db)).size).toBe(3);

  calls = [];
  await syncCatalog(db, catalog);
  expect(calls).toEqual(['themes', 'set:500-1']); // only the one that failed is retried
});

it('runs as part of the full sync and reports its errors in the sync message', async () => {
  await svc.addSet(db, { setNo: '500', name: 'Test', condition: 'Used' }, { lookup }); // stored without suffix; the sync adds it
  const run = await svc.startSync(db);
  if (!run.ok) throw new Error(run.error);
  await svc.runSync(db, run.runId, lookup, undefined, catalog);
  expect(await svc.syncStatus(db)).toMatchObject({ running: false, message: 'Rebrickable #500-1: boom' });
});

it('asks again about unknown sets after 30 days, or right away on recheck, and counts progress', async () => {
  for (const setNo of ['10280-1', '1234-1']) await svc.addSet(db, { setNo, name: 'Test', condition: 'Used' }, { lookup });
  await syncCatalog(db, catalog);
  calls = [];
  await syncCatalog(db, catalog);
  expect(calls).toEqual(['themes']); // 1234-1 was unknown a moment ago: not asked again yet
  calls = [];
  const progress: string[] = [];
  await syncCatalog(db, catalog, { recheck: true, onProgress: (d, t) => progress.push(`${d}/${t}`) });
  expect(calls).toEqual(['themes', 'set:1234-1']);
  expect(progress).toEqual(['0/1']);
  expect(await rebrickableStats(db)).toEqual({ sets: 2, matched: 1, notFound: 1, waiting: 0, builds: 0, buildsWithParts: 0, buildsUnavailable: 0 });
});

it('runs Rebrickable on its own, without BrickLink, and reports a bad key', async () => {

  await svc.addSet(db, { setNo: '10280-1', name: 'Test', condition: 'Used' }, { lookup });
  const builds = { alternates: async () => [], buildParts: async () => [] };
  expect(await rebrickableStats(db)).toMatchObject({ matched: 0, waiting: 1 });
  await startRebrickableSync(db, { ...catalog, ...builds, check: async () => {} });
  expect(rebrickableRun()).toMatchObject({ running: false, errors: [] });
  expect(await rebrickableStats(db)).toMatchObject({ matched: 1, waiting: 0 });

  await startRebrickableSync(db, { ...catalog, ...builds, check: async () => { throw new Error('Rebrickable: Invalid token.'); } });
  expect(rebrickableRun()).toMatchObject({ running: false, errors: ['Rebrickable: Invalid token.'] });
});
