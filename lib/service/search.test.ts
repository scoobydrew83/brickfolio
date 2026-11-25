// The command palette's search (#107): what each person finds, and the query rules.
import { beforeEach, describe, expect, it } from 'vitest';
import { openNodeDb } from '../db/node';
import type { DB } from '../db/types';
import { matchPages, pagesFor, parseQuery, SEARCH_MAX, SEARCH_PER_GROUP } from '../search';
import { addCollection } from './collections';
import { addLot } from './lots';
import { addMinifig } from './minifigs';
import { replaceParts } from './parts';
import type { Access } from './permissions';
import { inIds, searchEverything } from './search';
import { addSet, getSet } from './sets';
import { sql } from 'drizzle-orm';
import { sets } from '../db/schema';
import { addWish } from './wishlist';

let db: DB;
let kids = 0;
const admin: Access = { login: 'admin@x.test', admin: true, roles: new Map() };
const viewer = (): Access => ({ login: 'viewer@x.test', admin: false, roles: new Map([[kids, 'viewer']]) });
const nobody: Access = { login: 'nobody@x.test', admin: false, roles: new Map() };
const part = (partNo: string, name: string) => ({ matchNo: 0, partNo, name, type: 'PART', colorId: null, qty: 1, extra: 0, alternate: false, counterpart: false });
const labels = (hits: { group: string; label: string }[], group: string) => hits.filter((h) => h.group === group).map((h) => h.label);

beforeEach(async () => {
  db = openNodeDb(':memory:').db;
  const r = await addCollection(db, 'Kids');
  if (!r.ok) throw new Error(r.error);
  kids = r.collection.id;
  await addSet(db, { setNo: '10497-1', name: 'Galaxy Explorer', condition: 'New' }, { lookup: null, collectionId: 1 });
  await addSet(db, { setNo: '60337-1', name: 'Express Passenger Train', condition: 'Used' }, { lookup: null, collectionId: kids });
  await replaceParts(db, (await getSet(db, '10497-1'))!.id, [part('3001', 'Brick 2 x 4 Galaxy')]);
  await replaceParts(db, (await getSet(db, '60337-1'))!.id, [part('3002', 'Brick 2 x 3 Express')]);
  await addMinifig(db, { figNo: 'sw0001', name: 'Galaxy Pilot' }, { lookup: null, collectionId: 1 });
  await addMinifig(db, { figNo: 'cty0001', name: 'Express Conductor' }, { lookup: null, collectionId: kids });
  await addWish(db, { setNo: '10316-1', name: 'Rivendell Express', condition: 'New' }, null);
  await addLot(db, { partNo: '3003', name: 'Brick 2 x 2 Express', qty: 40, location: null });
});

describe('searchEverything', () => {
  it("finds only the sets, set parts and figures in the caller's collections", async () => {
    const v = await searchEverything(db, viewer(), 'express');
    expect(labels(v, 'Sets')).toEqual(['Express Passenger Train']);
    expect(labels(v, 'Minifigures')).toEqual(['Express Conductor']);
    expect(labels(v, 'Parts')).toEqual(['Brick 2 x 3 Express']);
    expect(await searchEverything(db, viewer(), 'galaxy')).toEqual([]); // My collection's set, part and figure
    expect(labels(await searchEverything(db, admin, 'galaxy'), 'Sets')).toEqual(['Galaxy Explorer']);
    expect(labels(await searchEverything(db, admin, 'galaxy'), 'Parts')).toEqual(['Brick 2 x 4 Galaxy']);
    // A narrower scope (the selected collection) narrows an admin too.
    expect(labels(await searchEverything(db, admin, 'galaxy', { scope: kids }), 'Sets')).toEqual([]);
  });

  it('shares the wishlist and loose parts with every member, and links each result', async () => {
    const v = await searchEverything(db, viewer(), 'express');
    expect(v.find((h) => h.group === 'Wishlist')).toMatchObject({ label: 'Rivendell Express', hint: '10316', href: '/wishlist' });
    expect(v.find((h) => h.group === 'Loose parts')).toMatchObject({ label: 'Brick 2 x 2 Express', href: '/parts/lots?q=3003' });
    expect(v.find((h) => h.group === 'Sets')).toMatchObject({ hint: '60337', href: '/sets/60337' });
    expect((await searchEverything(db, viewer(), '6033')).map((h) => h.label)).toEqual(['Express Passenger Train']); // by number
    expect((await searchEverything(db, viewer(), '60337-1')).map((h) => h.label)).toEqual(['Express Passenger Train']);
  });

  it("lets a viewer find pages but not Store or Orders; someone with no collection finds nothing of anyone's", async () => {
    expect(labels(await searchEverything(db, viewer(), 'store'), 'Pages')).toEqual([]);
    expect(labels(await searchEverything(db, viewer(), 'orders'), 'Pages')).toEqual([]);
    expect(labels(await searchEverything(db, viewer(), 'bricklink'), 'Pages')).toEqual([]);
    expect(labels(await searchEverything(db, admin, 'store'), 'Pages')).toEqual(['Store']);
    expect(labels(await searchEverything(db, admin, 'orders'), 'Pages')).toEqual(['Orders']);
    expect(await searchEverything(db, nobody, 'express')).toEqual([]);
    expect((await searchEverything(db, nobody, 'settings')).map((h) => h.href)).toEqual(['/settings']);
  });

  it('returns at most 8 per group and takes % and _ literally', async () => {
    for (let i = 0; i < 12; i++) await addSet(db, { setNo: `7${String(i).padStart(4, '0')}-1`, name: `Castle ${i}`, condition: 'New' }, { lookup: null, collectionId: 1 });
    expect(labels(await searchEverything(db, admin, 'castle'), 'Sets')).toHaveLength(SEARCH_PER_GROUP);
    expect(await searchEverything(db, admin, '%%')).toEqual([]);
    expect(await searchEverything(db, admin, '__')).toEqual([]);
  });
});

describe('queries and pages', () => {
  it('searches from 2 characters and refuses long queries', () => {
    expect(parseQuery('a')).toEqual({ ok: true, q: null });
    expect(parseQuery('  ab  ')).toEqual({ ok: true, q: 'ab' });
    expect(parseQuery('x'.repeat(SEARCH_MAX))).toMatchObject({ ok: true });
    expect(parseQuery('x'.repeat(SEARCH_MAX + 1))).toMatchObject({ ok: false });
  });

  it('lists Store and Orders for admins only, and the account page in better-auth mode only', () => {
    expect(pagesFor(false).map((p) => p.href)).not.toContain('/store');
    expect(pagesFor(false).map((p) => p.href)).not.toContain('/orders');
    expect(pagesFor(true).map((p) => p.href)).toEqual(expect.arrayContaining(['/store', '/orders']));
    expect(pagesFor(true).map((p) => p.href)).not.toContain('/account');
    expect(matchPages('acc', true, true).map((p) => p.href)).toEqual(['/account']);
  });
});

describe("D1's 100 bound parameters (#111 review)", () => {
  it('binds a scope of any size as one parameter', () => {
    const ids = Array.from({ length: 150 }, (_, i) => i + 1);
    const q = db.select({ id: sets.id }).from(sets).where(sql`${sets.id} in (${inIds(ids)})`).toSQL();
    expect(q.params).toHaveLength(1);
  });

  it('still finds the right sets for someone with 150 collections', async () => {
    const roles = new Map<number, 'viewer'>([[kids, 'viewer']]);
    for (let i = 0; i < 149; i++) {
      const r = await addCollection(db, `C${i}`);
      if (!r.ok) throw new Error(r.error);
      roles.set(r.collection.id, 'viewer');
    }
    const hits = await searchEverything(db, { login: 'many@x.test', admin: false, roles }, 'express');
    expect(labels(hits, 'Sets')).toEqual(['Express Passenger Train']); // Kids only, not My collection
    expect(labels(hits, 'Minifigures')).toEqual(['Express Conductor']);
  });
});
