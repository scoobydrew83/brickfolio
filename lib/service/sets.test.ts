import { beforeEach, describe, expect, it } from 'vitest';
import type { Lookup, PriceLookup } from '../bricklink/client';
import { eq } from 'drizzle-orm';
import { priceObservations } from '../db/schema';
import { openNodeDb } from '../db/node';
import type { DB } from '../db/types';
import * as svc from './sets';
import { parseQuickList } from '../sets';

let db: DB;
const calls: string[] = [];
const lookup: Lookup = async (no, guide, _currency, opts) => {
  calls.push(`${no}:${guide}${opts?.parts ? '+parts' : ''}`);
  if (no === '404-1') throw new Error('item: not found');
  // 10 lots of 10 pieces, plus one alternate that doesn't count toward pieces
  const list = Array.from({ length: 10 }, (_, i) => ({ matchNo: 0, partNo: `300${i}`, name: 'Brick', type: 'PART', colorId: 5, qty: 10, extra: 0, alternate: false, counterpart: false }));
  list.push({ ...list[0], partNo: '3999', matchNo: 1, alternate: true });
  const parts = opts?.parts ? { parts: list, pieces: 100, partLots: 11 } : {};
  return { blName: `BL ${no}`, year: 2021, categoryId: 1, imageUrl: null, ...parts, avgSold: guide === 'N' ? 50 : 20, minSold: 10, maxSold: 90, qtySold: 5 };
};
const add = (setNo: string, extra: object = {}) => svc.addSet(db, { setNo, name: 'Test', condition: 'Used', ...extra }, { lookup });

beforeEach(() => {
  db = openNodeDb(':memory:').db;
  calls.length = 0;
});

describe('sets', () => {
  it('seeds default locations and currency', async () => {
    expect(await svc.listLocations(db)).toEqual(['Display', 'Storage', 'Sell']);
    expect(await svc.getCurrency(db)).toBe('USD');
  });

  it('adds a set and fills it from BrickLink', async () => {
    const r = await add('10280-1');
    expect(r.ok && r.set).toMatchObject({ blName: 'BL 10280-1', avgSold: 20, estValue: 20, pieces: 100, partLots: 11, qty: 1, blError: null });
    expect(calls).toEqual(['10280-1:U+parts']);
  });

  it('asks before adding a duplicate, then adds a copy', async () => {
    await add('10280-1');
    const dupe = await add('10280-1');
    expect(dupe).toMatchObject({ ok: false, status: 409, existing: { qty: 1 } });
    const r = await svc.addSet(db, { setNo: '10280-1', name: 'x', condition: 'Used' }, { another: true, lookup });
    expect(r.ok && r.set.qty).toBe(2);
  });

  it('stores lookup errors on the set', async () => {
    const r = await add('404-1');
    expect(r.ok && r.set.blError).toBe('item: not found');
    expect(await svc.relookup(db, '404-1', lookup)).toMatchObject({ ok: false, error: 'Still failing: item: not found' });
  });

  it('works without BrickLink keys', async () => {
    const r = await svc.addSet(db, { setNo: '1-1', name: 'x', condition: 'New' }, { lookup: null });
    expect(r.ok && r.set.avgSold).toBeNull();
  });

  it('removes one copy at a time', async () => {
    await add('10280-1', { qty: 2 });
    expect(await svc.removeOne(db, '10280-1')).toEqual({ ok: true, remaining: 1 });
    expect(await svc.removeOne(db, '10280-1')).toEqual({ ok: true, remaining: 0 });
    expect(await svc.removeOne(db, '10280-1')).toMatchObject({ ok: false, status: 404 });
  });

  it('recomputes Est. Value on edit and re-looks-up when new/used changes', async () => {
    await add('10280-1');
    let r = await svc.editSet(db, { setNo: '10280-1', condition: 'Partial', missingPct: 50 }, lookup);
    expect(r.ok && r.set.estValue).toBe(10); // used price 20, less 50%
    expect(calls).toHaveLength(1); // Used → Partial keeps the used price, no new lookup
    r = await svc.editSet(db, { setNo: '10280-1', condition: 'New' }, lookup);
    expect(r.ok && r.set.estValue).toBe(25); // new price 50, Missing % still 50
    expect(calls.at(-1)).toBe('10280-1:N'); // parts list already known, not fetched again
    expect(r.ok && r.set.pieces).toBe(100);
    expect(await svc.editSet(db, { setNo: '1-1', name: 'x' }, lookup)).toMatchObject({ ok: false, status: 404 });
  });
});

describe('sync', () => {
  it('allows one running sync, updates every set and saves history', async () => {
    await add('10280-1');
    await add('404-1');
    const s = await svc.startSync(db);
    expect(s.ok).toBe(true);
    expect(await svc.startSync(db)).toMatchObject({ ok: false, status: 409 });
    if (!s.ok) return;
    await svc.runSync(db, s.runId, lookup);
    expect(await svc.syncStatus(db)).toMatchObject({ running: false, total: 2, processed: 2, errors: 1 });
    const [h] = await svc.listHistory(db);
    expect(h).toMatchObject({ sets: 2, copies: 2, estValue: 20 });
    expect((await svc.priceHistory(db, '10280-1')).length).toBe(1);
    expect((await svc.startSync(db)).ok).toBe(true); // lock released
  });

  it('stops BrickLink lookups when the daily limit is used up, and says so', async () => {
    for (const no of ['10280-1', '10497-1', '21325-1']) await add(no);
    const { BrickLinkError, QUOTA_MESSAGE } = await import('../bricklink/client');
    const seen: string[] = [];
    const limited: Lookup = async (no) => { seen.push(no); throw new BrickLinkError(QUOTA_MESSAGE, 'quota'); };
    const s = await svc.startSync(db);
    if (!s.ok) throw new Error(s.error);
    await svc.runSync(db, s.runId, limited);
    expect(seen).toHaveLength(1); // not once per set
    expect(await svc.syncStatus(db)).toMatchObject({ running: false, errors: 1, message: expect.stringContaining('daily limit') });
    expect(await svc.listHistory(db)).toHaveLength(1); // the rest of the sync still ran
  });

  it('fetches the other guide after the primary lookups, one price call each, or not at all when turned off', async () => {
    await add('10280-1');
    calls.length = 0;
    const price: PriceLookup = async (_t, no, guide) => { calls.push(`price ${no}:${guide}`); return { avgSold: 40, minSold: 30, maxSold: 50, qtySold: 3 }; };
    let s = await svc.startSync(db);
    if (!s.ok) throw new Error(s.error);
    await svc.runSync(db, s.runId, lookup, undefined, undefined, undefined, { price });
    expect(calls).toEqual(['10280-1:U', 'price 10280-1:N']);
    expect((await svc.priceHistory(db, '10280-1')).map((p) => p.guide).sort()).toEqual(['N', 'U']);

    process.env.OTHER_GUIDE_DAILY_CALLS = '0';
    try {
      calls.length = 0;
      await db.delete(priceObservations).where(eq(priceObservations.condition, 'N'));
      s = await svc.startSync(db);
      if (!s.ok) throw new Error(s.error);
      await svc.runSync(db, s.runId, lookup, undefined, undefined, undefined, { price });
      expect(calls).toEqual(['10280-1:U']);
    } finally {
      delete process.env.OTHER_GUIDE_DAILY_CALLS;
    }
  });

  it('refreshes the store after the sets and records store errors on the run', async () => {
    const s = await svc.startSync(db);
    if (!s.ok) throw new Error(s.error);
    const store = { inventory: async () => { throw new Error('inventories: Invalid IP'); }, orders: async () => [] };
    await svc.runSync(db, s.runId, lookup, store);
    expect(await svc.syncStatus(db)).toMatchObject({ running: false, message: 'Store inventory: inventories: Invalid IP' });
  });
});

describe('locations', () => {
  it('adds, renames (moving sets) and refuses to delete one in use', async () => {
    expect(await svc.addLocation(db, 'Attic')).toEqual({ ok: true });
    expect(await svc.addLocation(db, 'Attic')).toMatchObject({ ok: false, status: 409 });
    await add('10280-1', { location: 'Attic' });
    expect(await svc.renameLocation(db, 'Attic', 'Loft')).toEqual({ ok: true });
    expect((await svc.getSet(db, '10280-1'))?.location).toBe('Loft');
    expect(await svc.deleteLocation(db, 'Loft')).toMatchObject({ ok: false, status: 409 });
    expect(await svc.deleteLocation(db, 'Sell')).toEqual({ ok: true });
  });
  it('validates currency', async () => {
    expect((await svc.setCurrency(db, 'eur')).ok).toBe(true);
    expect(await svc.getCurrency(db)).toBe('EUR');
    expect((await svc.setCurrency(db, 'euro')).ok).toBe(false);
  });
});

describe('quick add', () => {
  const figLookup = async (no: string) => ({ blName: `Fig ${no}`, year: 2020, categoryId: 1, imageUrl: null, avgSold: 5, minSold: 1, maxSold: 9, qtySold: 2 });
  it('looks up a short list straight away and merges sets you already have', async () => {
    await add('10280-1');
    calls.length = 0;
    const r = await svc.quickAdd(db, parseQuickList('10280\n21325 x2\nsw0001'), { location: 'Display', condition: 'New', lookup, minifig: figLookup });
    expect(r).toMatchObject({ ok: true, added: 1, merged: 1, waiting: 0, figsAdded: 1, invalid: [] });
    expect(calls).toEqual(['21325-1:N+parts']);
    expect(await svc.getSet(db, '10280-1')).toMatchObject({ qty: 2 });
    expect(await svc.getSet(db, '21325-1')).toMatchObject({ name: 'BL 21325-1', qty: 2, location: 'Display', avgSold: 50 });
  });
  it('leaves a long list for the sync, which fills in the names', async () => {
    const text = Array.from({ length: 12 }, (_, i) => String(70000 + i)).join('\n');
    const r = await svc.quickAdd(db, parseQuickList(text), { lookup, minifig: null });
    expect(r).toMatchObject({ ok: true, added: 12, waiting: 12 });
    expect(calls).toEqual([]);
    expect(await svc.getSet(db, '70000-1')).toMatchObject({ name: 'Set 70000', blName: null });
    const run = await svc.startSync(db);
    if (run.ok) await svc.runSync(db, run.runId, lookup);
    expect(await svc.getSet(db, '70000-1')).toMatchObject({ name: 'BL 70000-1' });
    expect(await svc.quickAdd(db, parseQuickList('1234'), { location: 'Attic', lookup, minifig: null })).toMatchObject({ ok: false, status: 400 });
  });
});
