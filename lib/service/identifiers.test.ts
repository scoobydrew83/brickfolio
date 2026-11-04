import { beforeEach, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { openNodeDb } from '../db/node';
import type { DB } from '../db/types';
import { identifiers, settings } from '../db/schema';
import type { IdCatalog, RbPart } from '../rebrickable/client';
import { resolve } from '../identifiers/resolve';
import { startRebrickableSync, rebrickableRun } from '../rebrickable/run';
import { idPagesPerSync, REFRESH_DAYS, syncIdentifiers } from './identifiers';

const BASE = 'https://rebrickable.com/api/v3';
let db: DB;
beforeEach(() => { db = openNodeDb(':memory:').db; });

/** A parts catalog of `pages` pages, two parts each, that counts calls. */
function fake(pages: number) {
  const calls: string[] = [];
  const part = (n: number): RbPart => ({ partNo: `rb${n}`, name: `Part ${n}`, bricklink: [`bl${n}`], ldraw: [`ld${n}`] });
  const src: IdCatalog = {
    async colors() { calls.push('colors'); return [{ id: 4, name: 'Red', bricklink: ['5'], ldraw: ['4'] }, { id: 9999, name: 'Any', bricklink: [], ldraw: [] }]; },
    async partsPage(url) {
      const p = url ? Number(new URL(url).searchParams.get('page')) : 1;
      calls.push(`parts:${p}`);
      return { parts: [part(p * 2 - 1), part(p * 2)], next: p < pages ? `${BASE}/lego/parts/?page=${p + 1}` : null };
    },
  };
  return { src, calls };
}
const setting = async (key: string) => (await db.select().from(settings).where(eq(settings.key, key)).get())?.value ?? null;

it('stores colours and at most maxCalls part pages, then resumes from the saved cursor', async () => {
  const { src, calls } = fake(5);
  expect(await syncIdentifiers(db, src, { maxCalls: 2 })).toEqual([]);
  expect(calls).toEqual(['colors', 'parts:1', 'parts:2']);
  expect(await setting('rb_parts_cursor')).toBe(`${BASE}/lego/parts/?page=3`);
  expect((await resolve(db, 'color', 'rebrickable', 4)).canonical).toBe('5');
  expect((await resolve(db, 'color', 'ldraw', 4)).canonical).toBe('5');
  expect((await resolve(db, 'part', 'rebrickable', 'rb4')).canonical).toBe('bl4');
  expect((await resolve(db, 'part', 'ldraw', 'ld4.dat')).canonical).toBe('bl4');
  expect((await resolve(db, 'part', 'rebrickable', 'rb5')).canonical).toBeNull();

  calls.length = 0;
  await syncIdentifiers(db, src, { maxCalls: 2 });
  expect(calls).toEqual(['parts:3', 'parts:4']); // colours are fresh

  calls.length = 0;
  await syncIdentifiers(db, src, { maxCalls: 2 });
  expect(calls).toEqual(['parts:5']); // the last page ends the pass
  expect(await setting('rb_parts_cursor')).toBeNull();
  expect(await setting('rb_parts_synced_at')).not.toBeNull();
  expect(await db.select().from(identifiers).where(eq(identifiers.kind, 'part')).all()).toHaveLength(20);

  calls.length = 0;
  await syncIdentifiers(db, src, { maxCalls: 2 });
  expect(calls).toEqual([]); // nothing until the next pass is due

  const old = new Date(Date.now() - (REFRESH_DAYS + 1) * 86_400_000).toISOString();
  await db.update(settings).set({ value: old }).where(eq(settings.key, 'rb_parts_synced_at'));
  await db.update(settings).set({ value: old }).where(eq(settings.key, 'rb_colors_synced_at'));
  await syncIdentifiers(db, src, { maxCalls: 1 });
  expect(calls).toEqual(['colors', 'parts:1']);
});

it('reports errors readably, keeps the cursor, and can be turned off', async () => {
  const { src, calls } = fake(3);
  await syncIdentifiers(db, src, { maxCalls: 1 });
  const broken: IdCatalog = { async colors() { throw new Error('Rebrickable: Invalid token.'); }, async partsPage() { throw new Error('Rebrickable: Too many requests.'); } };
  await db.delete(settings).where(eq(settings.key, 'rb_colors_synced_at'));
  expect(await syncIdentifiers(db, broken, { maxCalls: 1 })).toEqual(['Rebrickable colours: Rebrickable: Invalid token.', 'Rebrickable part IDs: Rebrickable: Too many requests.']);
  expect(await setting('rb_parts_cursor')).toBe(`${BASE}/lego/parts/?page=2`);
  calls.length = 0;
  expect(await syncIdentifiers(db, src, { maxCalls: 0 })).toEqual([]);
  expect(calls).toEqual([]);
  expect(idPagesPerSync({})).toBe(20);
  expect(idPagesPerSync({ REBRICKABLE_ID_PAGES_PER_SYNC: '0' })).toBe(0);
  expect(idPagesPerSync({ REBRICKABLE_ID_PAGES_PER_SYNC: '5' })).toBe(5);
  expect(idPagesPerSync({ REBRICKABLE_ID_PAGES_PER_SYNC: 'lots' })).toBe(20);
  expect(idPagesPerSync({ REBRICKABLE_ID_PAGES_PER_SYNC: '' })).toBe(20);
});

it('runs in the Rebrickable sync', async () => {
  const { src, calls } = fake(30);
  const catalog = { async themes() { return []; }, async set() { return null; }, async minifigCount() { return 0; }, async alternates() { return []; }, async buildParts() { return []; } };
  await startRebrickableSync(db, { ...catalog, ...src });
  expect(rebrickableRun()).toMatchObject({ errors: [] });
  expect(calls).toHaveLength(1 + 20); // colours, then the default budget of part pages
  expect((await resolve(db, 'part', 'rebrickable', 'rb40')).canonical).toBe('bl40');
});
