import { beforeEach, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { Lookup } from '../bricklink/client';
import { openNodeDb } from '../db/node';
import type { DB } from '../db/types';
import { priceSnapshots, sets, themes, wishlist } from '../db/schema';
import { flagsFor, growthSince } from '../radar';
import type { Alert } from './alerts';
import { getRadar, notifyRetiring } from './radar';
import * as svc from './sets';
import * as wish from './wishlist';

let db: DB;
const TODAY = '2026-11-03';
const lookup: Lookup = async () => ({ blName: 'BL', year: 2020, categoryId: 1, imageUrl: null, avgSold: 200, minSold: 150, maxSold: 250, qtySold: 9 });
beforeEach(() => { db = openNodeDb(':memory:').db; });

it('works out growth per year from a stored price near retirement, else from retail', () => {
  const hist = [{ date: '2024-11-10', avgSold: 100 }, { date: '2025-06-01', avgSold: 110 }, { date: '2026-01-01', avgSold: 115 }];
  const g = growthSince('2024-11-01', 121, hist, { price: 80, currency: 'USD' }, 'USD', '2026-11-10')!;
  expect(g).toMatchObject({ basis: 'snapshot', from: 100, fromDate: '2024-11-10', totalPct: 21, thin: false });
  expect(g.perYear).toBeCloseTo(10, 0); // 21% over two years ≈ 10% a year

  const r = growthSince('2024-11-01', 121, [], { price: 100, currency: 'USD' }, 'USD', '2026-11-01')!;
  expect(r).toMatchObject({ basis: 'retail', from: 100, thin: true });
  expect(growthSince('2024-11-01', 121, [], { price: 100, currency: 'GBP' }, 'USD', TODAY)).toBeNull(); // other currency
  expect(growthSince('2026-10-01', 121, [], { price: 100, currency: 'USD' }, 'USD', TODAY)).toBeNull(); // too recent
  expect(growthSince('2027-01-01', 121, [], { price: 100, currency: 'USD' }, 'USD', TODAY)).toBeNull(); // not retired yet
});

it('flags Designer Program and SMART Play sets by theme or name', () => {
  expect(flagsFor('BrickLink', 'Designer Program Series 8')).toEqual(['designer']);
  expect(flagsFor('Star Wars', null, 'X-Wing SMART Play')).toEqual(['smart']);
  expect(flagsFor('Icons')).toEqual([]);
});

it('groups upcoming retirements by month and ranks retired sets by growth', async () => {
  for (const setNo of ['10497-1', '10305-1', '21325-1', '910001-1']) await svc.addSet(db, { setNo, name: `Set ${setNo}`, condition: 'New' }, { lookup });
  await db.insert(themes).values([{ id: 1, name: 'BrickLink' }, { id: 2, parentId: 1, name: 'Designer Program' }]);
  const upd = (no: string, v: Partial<typeof sets.$inferInsert>) => db.update(sets).set(v).where(eq(sets.setNo, no));
  await upd('10497-1', { exitDate: '2026-12-31', retailPrice: 99.99, retailCurrency: 'USD' });
  await upd('10305-1', { exitDate: '2024-11-01', retired: true, retailPrice: 100, retailCurrency: 'USD' });
  await upd('21325-1', { exitDate: '2025-11-01', retired: true, retailPrice: 180, retailCurrency: 'USD' });
  await upd('910001-1', { exitDate: '2026-01-01', retired: true, themeId: 2, retailPrice: 150, retailCurrency: 'USD' });
  const id = (await svc.getSet(db, '10305-1'))!.id;
  await db.insert(priceSnapshots).values({ setId: id, date: '2024-11-05', guide: 'N', avgSold: 120 }).onConflictDoNothing();
  await wish.addWish(db, { setNo: '10316-1', name: 'Rivendell', target: 430 }, null);
  await db.update(wishlist).set({ exitDate: '2026-12-15' });

  const r = await getRadar(db, TODAY);
  expect(r.retiring).toHaveLength(1);
  expect(r.retiring[0]).toMatchObject({ month: '2026-12' });
  expect(r.retiring[0].items.map((i) => [i.kind, i.setNo])).toEqual([['wish', '10316-1'], ['set', '10497-1']]);
  expect(r.retired.map((i) => i.setNo)).toEqual(['910001-1', '10305-1', '21325-1']); // ≈41%, ≈29%, ≈11% a year
  expect(r.retired.find((i) => i.setNo === '10305-1')!.growth).toMatchObject({ basis: 'snapshot', from: 120 });
  expect(r.retired[0].flags).toEqual(['designer']);
  expect(r.totals).toMatchObject({ retiringSoon: 2, wishesRetiringSoon: 1, retiredOwned: 3, retiredValue: 600, flagged: { designer: 1, smart: 0 } });
  expect(r.totals.medianGrowth).not.toBeNull();
});

it('alerts once about wishes retiring soon, and re-arms when the date moves away', async () => {
  const sent: Alert[] = [];
  const send = async (a: Alert) => { sent.push(a); };
  await wish.addWish(db, { setNo: '10316-1', name: 'Rivendell', target: 430 }, null);
  await wish.addWish(db, { setNo: '10305-1', name: 'Castle', target: 360 }, null);
  await db.update(wishlist).set({ exitDate: '2026-12-01' }).where(eq(wishlist.setNo, '10316-1'));
  await db.update(wishlist).set({ exitDate: '2027-12-01' }).where(eq(wishlist.setNo, '10305-1'));

  expect(await notifyRetiring(db, send, 60, TODAY)).toBeNull();
  expect(sent).toHaveLength(1);
  expect(sent[0].title).toBe('Rivendell retires soon');
  expect(sent[0].message).toContain('in 28 days');
  await notifyRetiring(db, send, 60, TODAY);
  expect(sent).toHaveLength(1); // already alerted

  await db.update(wishlist).set({ exitDate: '2027-06-01' }).where(eq(wishlist.setNo, '10316-1'));
  await notifyRetiring(db, send, 60, TODAY); // moved out: re-armed, nothing sent
  await db.update(wishlist).set({ exitDate: '2026-12-20' }).where(eq(wishlist.setNo, '10316-1'));
  await notifyRetiring(db, send, 60, TODAY);
  expect(sent).toHaveLength(2);
  expect(await notifyRetiring(db, async () => { throw new Error('down'); }, 0, TODAY)).toBeNull(); // off
});
