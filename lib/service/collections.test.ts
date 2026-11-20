// Collections (#49): managing them, scoping every read to one, and adding and moving copies and minifigures.
import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { Lookup, MinifigLookup } from '../bricklink/client';
import { openNodeDb } from '../db/node';
import type { DB } from '../db/types';
import { collectionHistory, setParts } from '../db/schema';
import { totals } from '../sets';
import * as cols from './collections';
import * as svc from './sets';
import { editCopy } from './copies';
import { addMinifig, editMinifig, figRows, listMinifigs, removeMinifig, syncMinifigs } from './minifigs';
import { getRadar } from './radar';
import { valuation } from './report';
import { ownedParts } from './allocations';
import { createShareLink, sharedCollection, sharesItem } from './share';
import { handleRpc } from '../mcp/server';

let db: DB;
let figCalls: string[];
const lookup: Lookup = async (no, guide, _c, o) => ({
  blName: `BL ${no}`, year: 2021, categoryId: 1, imageUrl: null, avgSold: no === '10497-1' ? 100 : 40, minSold: 1, maxSold: 200, qtySold: 5,
  ...(o?.parts ? { parts: [{ matchNo: 0, partNo: '3001', name: 'Brick', type: 'PART', colorId: 5, qty: 10, extra: 0, alternate: false, counterpart: false }] } : {}),
});
const fig: MinifigLookup = async (no) => { figCalls.push(no); return { blName: `Fig ${no}`, year: 2020, categoryId: 1, imageUrl: null, avgSold: 7, minSold: 1, maxSold: 9, qtySold: 3 }; };

let kids: number;
beforeEach(async () => {
  db = openNodeDb(':memory:').db;
  figCalls = [];
  const r = await cols.addCollection(db, 'Kids');
  if (!r.ok) throw new Error(r.error);
  kids = r.collection.id;
});

describe('managing collections', () => {
  it('starts with My collection, adds, renames, reorders and refuses bad names', async () => {
    expect((await cols.listCollections(db)).map((c) => c.name)).toEqual(['My collection', 'Kids']);
    expect(await cols.defaultCollectionId(db)).toBe(1);
    expect(await cols.addCollection(db, 'Kids')).toMatchObject({ ok: false, status: 409 });
    expect(await cols.addCollection(db, '')).toMatchObject({ ok: false, status: 400 });
    expect(await cols.addCollection(db, 'All collections')).toMatchObject({ ok: false, status: 400 });
    expect(await cols.renameCollection(db, kids, 'Children')).toEqual({ ok: true });
    expect(await cols.renameCollection(db, kids, 'My collection')).toMatchObject({ ok: false, status: 409 });
    expect(await cols.reorderCollections(db, [kids])).toEqual({ ok: true });
    expect((await cols.listCollections(db)).map((c) => c.name)).toEqual(['Children', 'My collection']);
    expect(await cols.defaultCollectionId(db)).toBe(kids); // the first in the list
    expect(await cols.reorderCollections(db, [99])).toMatchObject({ ok: false, status: 400 });
  });

  it('parses scopes and checks them', async () => {
    expect(cols.parseScope(undefined)).toBe('all');
    expect(cols.parseScope('all')).toBe('all');
    expect(cols.parseScope('2')).toBe(2);
    expect(cols.parseScope('x')).toBeNull();
    expect(await cols.checkScope(db, '99')).toMatchObject({ ok: false, status: 400 });
    expect(await cols.checkScope(db, String(kids))).toEqual({ ok: true, scope: kids });
  });

  it('deletes only empty collections, never the last one, and not while a share link shows it', async () => {
    await svc.addSet(db, { setNo: '10497-1', name: 'Galaxy', condition: 'New' }, { lookup, collectionId: kids });
    expect(await cols.deleteCollection(db, kids)).toMatchObject({ ok: false, status: 409, error: 'Kids still holds 1 copy. Move them first.' });
    const s = (await svc.getSet(db, '10497-1'))!;
    await editCopy(db, s.copies[0].id, { collectionId: 1 });
    const link = await createShareLink(db, { name: 'x', showValues: false, showLocations: false, showNotes: false, showMinifigs: true, expiresAt: null, collectionId: kids });
    expect(link.ok).toBe(true);
    expect(await cols.deleteCollection(db, kids)).toMatchObject({ ok: false, status: 409, error: expect.stringContaining('share link') });
    const { revokeShareLink } = await import('./share');
    await revokeShareLink(db, (link as { id: number }).id);
    expect(await cols.deleteCollection(db, kids)).toEqual({ ok: true });
    expect(await cols.deleteCollection(db, 1)).toMatchObject({ ok: false, status: 409, error: expect.stringContaining('only collection') });
  });
});

describe('scoped reads and writes', () => {
  beforeEach(async () => {
    await svc.addSet(db, { setNo: '10497-1', name: 'Galaxy', condition: 'New' }, { lookup }); // All → the default, My collection
    await svc.addSet(db, { setNo: '10497-1', name: 'Galaxy', condition: 'New' }, { lookup, another: true, collectionId: kids });
    await svc.addSet(db, { setNo: '60337-1', name: 'Train', condition: 'Used' }, { lookup, collectionId: kids });
  });

  it('lists a set in each collection with only its copies there, and "All" matches the whole', async () => {
    const all = await svc.listSets(db);
    const mine = await svc.listSets(db, { collectionId: 1 });
    const theirs = await svc.listSets(db, { collectionId: kids });
    expect(mine.map((s) => [s.setNo, s.qty])).toEqual([['10497-1', 1]]);
    expect(theirs.map((s) => [s.setNo, s.qty])).toEqual([['10497-1', 1], ['60337-1', 1]]);
    expect(totals(all).estValue).toBe(totals(mine).estValue + totals(theirs).estValue);
    expect(totals(all).copies).toBe(3);
  });

  it('moves a copy and both collections follow', async () => {
    const s = (await svc.getSet(db, '10497-1'))!;
    const inMine = s.copies.find((c) => c.collectionId === 1)!;
    expect(await editCopy(db, inMine.id, { collectionId: 99 })).toMatchObject({ ok: false, status: 400 });
    await editCopy(db, inMine.id, { collectionId: kids });
    expect(await svc.listSets(db, { collectionId: 1 })).toEqual([]);
    expect((await svc.listSets(db, { collectionId: kids })).find((x) => x.setNo === '10497-1')?.qty).toBe(2);
  });

  it('saves history per collection, and quick add and new copies follow the scope', async () => {
    await svc.saveHistory(db);
    const rows = await db.select().from(collectionHistory).all();
    expect(rows.map((r) => [r.collectionId, r.copies])).toEqual([[1, 1], [kids, 2]]);
    expect((await svc.listHistory(db, { collectionId: kids }))[0]).toMatchObject({ copies: 2, estValue: 140 });
    expect((await svc.listHistory(db))[0]).toMatchObject({ copies: 3, estValue: 240 });

    const list = { sets: [{ setNo: '21325-1', qty: 1 }], minifigs: [], invalid: [] };
    await svc.quickAdd(db, list, { lookup: null, minifig: null, collectionId: kids });
    expect((await svc.listSets(db, { collectionId: kids })).map((s) => s.setNo)).toContain('21325-1');
    expect(await svc.addSet(db, { setNo: '1-1', name: 'x' }, { lookup: null, collectionId: 99 })).toMatchObject({ ok: false, status: 400 });
  });

  it('scopes the Radar, the report, owned parts and the group-by totals', async () => {
    expect((await getRadar(db, undefined, { collectionId: 1 })).totals).toBeDefined();
    const v = await valuation(db, { collectionId: kids });
    expect(v.lines.filter((l) => l.kind === 'set').reduce((t, l) => t + l.qty, 0)).toBe(2);
    // Every set's parts list is 10 × 3001 in colour 5.
    expect([...(await ownedParts(db, kids)).values()]).toEqual([20]);
    expect([...(await ownedParts(db)).values()]).toEqual([30]);
    expect(await db.select().from(setParts).where(eq(setParts.partNo, '3001')).all()).toHaveLength(2);
    const { groupTotals } = await import('../sets');
    const g = groupTotals(await svc.listSets(db), 'collection', new Map([[1, 'My collection'], [kids, 'Kids']]));
    expect(g.map((x) => [x.label, x.copies])).toEqual([['Kids', 2], ['My collection', 1]]);
  });

  it('shows only one collection on a share link scoped to it', async () => {
    const link = { name: 'Kids', showValues: true, showLocations: false, showNotes: false, showMinifigs: true, collectionId: kids };
    const shared = await sharedCollection(db, link, 'USD', 'bf_share_x');
    expect(shared.sets.map((s) => s.setNo)).toEqual(['10497-1', '60337-1']);
    expect(shared.totals.copies).toBe(2);
    expect(await sharesItem(db, { showMinifigs: true, collectionId: 1 }, 'set', '60337-1')).toBe(false);
    expect(await sharesItem(db, { showMinifigs: true, collectionId: kids }, 'set', '60337-1')).toBe(true);
  });

  it('answers MCP tools for one collection by name, and lists collections', async () => {
    const call = async (name: string, args: object = {}) => (await handleRpc(db, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }))!.result as { structuredContent?: Record<string, unknown>; isError: boolean; content: { text: string }[] };
    expect((await call('list_collections')).structuredContent).toEqual({ collections: [{ id: 1, name: 'My collection', copies: 1, minifigs: 0 }, { id: kids, name: 'Kids', copies: 2, minifigs: 0 }] });
    expect((await call('search_sets', { collection: 'kids' })).structuredContent).toMatchObject({ matched: 2 });
    expect((await call('search_sets', { collection: String(kids) })).structuredContent).toMatchObject({ matched: 2 });
    const bad = await call('search_sets', { collection: 'Attic' });
    expect(bad.isError).toBe(true);
    expect(bad.content[0].text).toContain('No collection called Attic');
  });
});

describe('minifigures in several collections', () => {
  it('keeps one row per collection, merges within one, and needs the collection to change one', async () => {
    await addMinifig(db, { figNo: 'sw0001', qty: 1 }, { lookup: fig });
    await addMinifig(db, { figNo: 'sw0001', qty: 2 }, { lookup: fig, collectionId: kids });
    expect(figCalls).toEqual(['sw0001']); // the second row copies the first's price: no second lookup
    expect((await figRows(db, 'sw0001')).map((r) => [r.collectionId, r.qty, r.avgSold])).toEqual([[1, 1, 7], [kids, 2, 7]]);
    expect(await addMinifig(db, { figNo: 'sw0001' }, { lookup: null, collectionId: kids })).toMatchObject({ ok: false, status: 409 });
    expect((await listMinifigs(db, { collectionId: kids })).map((m) => m.qty)).toEqual([2]);

    expect(await removeMinifig(db, 'sw0001')).toMatchObject({ ok: false, status: 409, error: expect.stringContaining('2 collections') });
    expect(await removeMinifig(db, 'sw0001', kids)).toEqual({ ok: true, remaining: 1 });

    // Moving into a collection that has it merges the two rows.
    expect(await editMinifig(db, 'sw0001', { collectionId: kids }, null, 1)).toMatchObject({ ok: true, minifig: { collectionId: kids, qty: 2 } });
    expect(await figRows(db, 'sw0001')).toHaveLength(1);
    // Moving where it isn't just moves it.
    expect(await editMinifig(db, 'sw0001', { collectionId: 1, location: null }, null)).toMatchObject({ ok: true, minifig: { collectionId: 1, qty: 2 } });
    expect(await editMinifig(db, 'sw0001', { collectionId: 99 }, null)).toMatchObject({ ok: false, status: 400 });
  });

  it('looks a figure up once in the sync, however many collections have it', async () => {
    await addMinifig(db, { figNo: 'sw0001' }, { lookup: null });
    await addMinifig(db, { figNo: 'sw0001' }, { lookup: null, collectionId: kids });
    expect(await syncMinifigs(db, fig, 'USD')).toBe(0);
    expect(figCalls).toEqual(['sw0001']);
    expect((await figRows(db, 'sw0001')).map((r) => r.avgSold)).toEqual([7, 7]);
  });
});
