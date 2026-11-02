import { readFileSync } from 'node:fs';
import { beforeEach, expect, it, vi } from 'vitest';
import type { Lookup } from '../bricklink/client';
import { openNodeDb } from '../db/node';
import type { DB } from '../db/types';
import * as sets from './sets';
import { eq } from 'drizzle-orm';
import { sets as setsTable } from '../db/schema';
import { checkModel, getModel, importOmrModel, removeModel, saveModel, syncOmrModels } from './models';

vi.mock('server-only', () => ({}));
const { libraryPath, readLibraryFile } = await import('../ldraw/library');

let db: DB;
const lookup: Lookup = async () => ({ blName: 'BL', year: 2022, categoryId: 1, imageUrl: null, avgSold: 100, minSold: 90, maxSold: 110, qtySold: 3 });
const fixture = readFileSync(new URL('../ldraw/fixtures/test-model.ldr', import.meta.url), 'utf8');

beforeEach(() => { db = openNodeDb(':memory:').db; });

it('only serves library files', () => {
  expect(libraryPath(['parts', '3001.dat'])).toBe('parts/3001.dat');
  expect(libraryPath(['p', '48', '4-4cyli.dat'])).toBe('p/48/4-4cyli.dat');
  expect(libraryPath(['ldconfig.ldr'])).toBe('LDConfig.ldr');
  expect(libraryPath(['parts', '..', '..', 'etc', 'passwd'])).toBeNull();
  expect(libraryPath(['secrets', 'x.dat'])).toBeNull();
  expect(libraryPath(['parts', 'x.txt'])).toBeNull();
});

it('reads library files from a folder and refuses to leave it', async () => {
  const dir = new URL('../ldraw/fixtures/', import.meta.url).pathname;
  expect(await readLibraryFile({ kind: 'dir', dir }, 'parts/testbrick.dat')).toContain('Test Brick');
  expect(await readLibraryFile({ kind: 'dir', dir }, 'parts/missing.dat')).toBeNull();
  expect(await readLibraryFile({ kind: 'dir', dir }, '../models.test.ts')).toBeNull();
});

it('checks uploaded models', () => {
  expect(checkModel('galaxy.mpd', fixture)).toBeNull();
  expect(checkModel('galaxy.zip', fixture)).toMatch(/LDraw file/);
  expect(checkModel('notes.ldr', '0 just a comment\n')).toMatch(/No parts/);
  expect(checkModel('big.mpd', `${fixture}${'0 x\n'.repeat(600_000)}`)).toMatch(/over 2 MB/);
});

it('saves, replaces and removes a set model', async () => {
  await sets.addSet(db, { setNo: '10497-1', name: 'Galaxy Explorer', condition: 'New' }, { lookup });
  expect(await saveModel(db, '10497-1', 'C:\\models\\10497 - Galaxy Explorer.mpd', fixture)).toEqual({ ok: true });
  const s = (await sets.getSet(db, '10497-1'))!;
  expect(await getModel(db, s.id)).toMatchObject({ fileName: '10497 - Galaxy Explorer.mpd', content: fixture });
  await saveModel(db, '10497-1', 'v2.ldr', fixture);
  expect((await getModel(db, s.id))?.fileName).toBe('v2.ldr');
  expect((await saveModel(db, '99999-1', 'x.ldr', fixture)).ok).toBe(false);
  expect(await removeModel(db, '10497-1')).toEqual({ ok: true });
  expect(await getModel(db, s.id)).toBeUndefined();
});

it('imports a model from the LDraw OMR, or says it has none', async () => {
  await sets.addSet(db, { setNo: '8855-1', name: 'Prop Plane', condition: 'New' }, { lookup });
  await sets.addSet(db, { setNo: '75192-1', name: 'Falcon', condition: 'New' }, { lookup });
  const omr: typeof fetch = async (url) => (String(url).endsWith('/8855-1.mpd') ? new Response(fixture) : new Response('', { status: 404 }));
  expect(await importOmrModel(db, '8855-1', omr)).toEqual({ ok: true });
  expect((await getModel(db, (await sets.getSet(db, '8855-1'))!.id))?.fileName).toBe('8855-1.mpd');
  const miss = await importOmrModel(db, '75192-1', omr);
  expect(miss).toMatchObject({ ok: false, error: expect.stringMatching(/no model for #75192/) });
  expect((await db.select().from(setsTable).where(eq(setsTable.setNo, '75192-1')).get())?.omrCheckedAt).toBeTruthy();
});

it('syncs OMR models for sets without one, a few at a time, and waits a month to recheck', async () => {
  for (const no of ['1-1', '2-1', '3-1', '4-1']) await sets.addSet(db, { setNo: no, name: no, condition: 'New' }, { lookup });
  await saveModel(db, '1-1', 'mine.ldr', fixture);
  const asked: string[] = [];
  const omr: typeof fetch = async (url) => {
    asked.push(String(url).split('/').pop()!);
    if (String(url).endsWith('/3-1.mpd')) throw new Error('timeout');
    return String(url).endsWith('/2-1.mpd') ? new Response(fixture) : new Response('', { status: 404 });
  };
  const errors = await syncOmrModels(db, omr, { max: 2, gapMs: 0 });
  expect(asked).toEqual(['2-1.mpd', '3-1.mpd']);
  expect(errors).toEqual(['LDraw model for #3: timeout']);
  expect((await getModel(db, (await sets.getSet(db, '2-1'))!.id))?.fileName).toBe('2-1.mpd');
  expect((await getModel(db, (await sets.getSet(db, '1-1'))!.id))?.fileName).toBe('mine.ldr');

  asked.length = 0;
  await syncOmrModels(db, omr, { max: 10, gapMs: 0 });
  expect(asked).toEqual(['3-1.mpd', '4-1.mpd']); // 3 failed, so it is still unchecked; 2 has a model now
  asked.length = 0;
  await syncOmrModels(db, omr, { max: 10, gapMs: 0 });
  expect(asked).toEqual(['3-1.mpd']); // failures retry next time; 4 was missing, so not again for 30 days
});

it('marks sets that have a model in the collection list', async () => {
  await sets.addSet(db, { setNo: '10497-1', name: 'Galaxy Explorer', condition: 'New' }, { lookup });
  await sets.addSet(db, { setNo: '10280-1', name: 'Flower Bouquet', condition: 'New' }, { lookup });
  await saveModel(db, '10497-1', 'galaxy.mpd', fixture);
  const byNo = Object.fromEntries((await sets.listSets(db)).map((s) => [s.setNo, s.hasModel]));
  expect(byNo).toEqual({ '10280-1': false, '10497-1': true });
  expect((await sets.getSet(db, '10497-1'))?.hasModel).toBe(true);
});
