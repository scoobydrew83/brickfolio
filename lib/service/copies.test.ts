import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { Lookup } from '../bricklink/client';
import { openNodeDb } from '../db/node';
import { priceObservations } from '../db/schema';
import { recordPrice } from './prices';
import type { DB } from '../db/types';
import { addCopy, editCopy, ownedSummary, removeCopy, repriceCopies } from './copies';
import * as svc from './sets';

let db: DB;
const calls: string[] = [];
const lookup: Lookup = async (no, guide) => {
  calls.push(`${no}:${guide}`);
  return { blName: `BL ${no}`, year: 2021, categoryId: 1, imageUrl: null, avgSold: guide === 'N' ? 50 : 20, minSold: 10, maxSold: 90, qtySold: 5 };
};
const get = async (no = '10280-1') => (await svc.getSet(db, no))!;
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toLocaleDateString('en-CA');

beforeEach(() => {
  db = openNodeDb(':memory:').db;
  calls.length = 0;
});

describe('copies', () => {
  it('adds, edits and removes copies; removing the last copy removes the set', async () => {
    await svc.addSet(db, { setNo: '10280-1', name: 'Flower Bouquet', condition: 'Used', location: 'Display' }, { lookup });
    const r = await addCopy(db, '10280-1', { status: 'built', condition: 'Used', location: 'Storage', pricePaid: 40, tax: 3.2 });
    expect(r.ok).toBe(true);
    let s = await get();
    expect(s).toMatchObject({ qty: 2, location: null, mixed: { location: true, condition: false }, valueTotal: 40, costBasis: 43.2, costCovered: 1 });
    expect(s.gain).toBe(-23.2); // 20 value − 43.2 cost, over the one copy with a cost

    const [a, b] = s.copies;
    expect(await editCopy(db, b.id, { gwp: true })).toMatchObject({ ok: true });
    s = await get();
    expect(s.copies[1]).toMatchObject({ gwp: true, pricePaid: 0 });
    expect(s.gain).toBe(20); // a gift costs 0: its full value is gain

    expect(await editCopy(db, a.id, { status: 'sealed', condition: 'Partial' })).toMatchObject({ ok: false });
    expect(await removeCopy(db, b.id)).toMatchObject({ ok: true, remaining: 1 });
    expect(await removeCopy(db, a.id)).toMatchObject({ ok: true, remaining: 0 });
    expect(await svc.getSet(db, '10280-1')).toBeUndefined();
    expect(await removeCopy(db, a.id)).toMatchObject({ ok: false, status: 404 });
  });

  it('values a sealed and a built copy with new and used prices, using a recent snapshot for the other guide', async () => {
    await svc.addSet(db, { setNo: '10280-1', name: 'x', condition: 'New' }, { lookup }); // sealed: N fetched, 50
    const s0 = await get();
    // An older used price, from before the set's copies were mostly built.
    await recordPrice(db, { itemKind: 'set', itemId: s0.setNo, source: 'bricklink', type: 'sold_avg', condition: 'U', currency: 'USD', amount: 22, observedOn: daysAgo(10) });
    await addCopy(db, '10280-1', { status: 'built', condition: 'Used' });
    let s = await get();
    expect(s.copies.map((c) => [c.status, c.estValue, c.estGuide])).toEqual([['sealed', 50, 'N'], ['built', 22, 'U']]);
    expect(s.valueTotal).toBe(72);

    // Without a recent snapshot in its own guide, a copy falls back to today's price and says which guide that was.
    await db.delete(priceObservations).where(eq(priceObservations.condition, 'U'));
    await repriceCopies(db, s.id);
    s = await get();
    expect(s.copies[1]).toMatchObject({ estValue: 50, estGuide: 'N' });
  });

  it('fetches the guide most copies need; ties go to used', async () => {
    await svc.addSet(db, { setNo: '10280-1', name: 'x', condition: 'New' }, { lookup });
    await addCopy(db, '10280-1', { status: 'built' }, lookup); // 1 sealed, 1 built: tie → U, so it looks up again
    expect(calls).toEqual(['10280-1:N', '10280-1:U']);
    await addCopy(db, '10280-1', { status: 'sealed' }, lookup); // 2 sealed vs 1 built → N, already priced today
    expect(calls).toEqual(['10280-1:N', '10280-1:U']); // no new lookup: today's N price is still fresh
    // Each guide keeps its own row per day, so the built copy is still valued from today's used sales.
    expect((await get()).copies.map((c) => c.estGuide)).toEqual(['N', 'U', 'N']);
  });

  it('keeps the old set API working: another adds a copy, removeOne removes the newest, PATCH needs one copy', async () => {
    await svc.addSet(db, { setNo: '10280-1', name: 'x', condition: 'Used', location: 'Display' }, { lookup });
    expect(await svc.editSet(db, { setNo: '10280-1', location: 'Storage', condition: 'New' }, null)).toMatchObject({ ok: true, set: { location: 'Storage', condition: 'New' } });
    expect((await get()).copies[0].status).toBe('built'); // editing condition doesn't seal a built copy
    expect(await svc.addSet(db, { setNo: '10280-1', name: 'x', condition: 'Used' }, { another: true, lookup })).toMatchObject({ ok: true, set: { qty: 2 } });
    expect(await svc.editSet(db, { setNo: '10280-1', location: 'Display' }, null)).toMatchObject({ ok: false, status: 409 });
    expect(await svc.editSet(db, { setNo: '10280-1', name: 'Renamed', notes: 'n' }, null)).toMatchObject({ ok: true, set: { name: 'Renamed', notes: 'n' } });
    expect(await svc.editSet(db, { setNo: '10280-1', qty: 4 }, null)).toMatchObject({ ok: true, set: { qty: 4 } });
    const ids = (await get()).copies.map((c) => c.id);
    expect(await svc.removeOne(db, '10280-1')).toEqual({ ok: true, remaining: 3 });
    expect((await get()).copies.map((c) => c.id)).toEqual(ids.slice(0, 3)); // the newest went
    expect(await svc.editSet(db, { setNo: '10280-1', qty: 1 }, null)).toMatchObject({ ok: true, set: { qty: 1 } });
    expect(await svc.removeOne(db, '10280-1')).toEqual({ ok: true, remaining: 0 });
    expect(await svc.getSet(db, '10280-1')).toBeUndefined();
  });

  it('leaves parted out copies out of counts and value, and out of what you own', async () => {
    await svc.addSet(db, { setNo: '10280-1', name: 'x', condition: 'Used', qty: 2 }, { lookup });
    const [a] = (await get()).copies;
    await editCopy(db, a.id, { status: 'parted_out' });
    const s = await get();
    expect(s).toMatchObject({ qty: 1, partedOut: 1, valueTotal: 20 });
    expect((await ownedSummary(db)).get('10280-1')).toMatchObject({ qty: 1 });
    await svc.saveHistory(db);
    expect((await svc.listHistory(db))[0]).toMatchObject({ sets: 1, copies: 1, estValue: 20 });
  });

  it('quick add and pasted lists add copies; locations rename and count copies', async () => {
    await svc.quickAdd(db, { sets: [{ setNo: '10280-1', qty: 2 }], minifigs: [], invalid: [] }, { condition: 'New', location: 'Storage', lookup: null, minifig: null });
    await svc.quickAdd(db, { sets: [{ setNo: '10280-1', qty: 1 }], minifigs: [], invalid: [] }, { condition: 'Used', location: 'Display', lookup: null, minifig: null });
    const s = await get();
    expect(s.copies.map((c) => [c.status, c.condition, c.location])).toEqual([['sealed', 'New', 'Storage'], ['sealed', 'New', 'Storage'], ['built', 'Used', 'Display']]);
    expect(await svc.deleteLocation(db, 'Storage')).toMatchObject({ ok: false, error: '2 copies still use Storage. Move them first.' });
    expect(await svc.renameLocation(db, 'Storage', 'Vault')).toEqual({ ok: true });
    expect((await get()).copies.map((c) => c.location)).toEqual(['Vault', 'Vault', 'Display']);
  });
});
