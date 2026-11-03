// Optional Brickset sync: each set's original retail price and its launch and retirement dates, for "value vs.
// retail" and the retirement watch. Prices you can sell for still come only from BrickLink.
import { asc, eq, isNull, lt, or, sql } from 'drizzle-orm';
import type { BsSet, RetailSource } from '../brickset/client';
import { sets, wishlist } from '../db/schema';
import type { DB } from '../db/types';
import { setNo as fullSetNo } from '../sets';
import { SOON_DAYS } from '../retail';
import { getCurrency } from './sets';
import { saveBricksetBarcodes } from './barcodes';

export { collectionGain, retailGain, retirement } from '../retail';

const RECHECK_DAYS = 30; // retirement dates move, so ask again monthly

/** Retail price in the collection currency when Brickset has it, else in US dollars. */
export function pickRetail(s: BsSet, currency: string): { price: number; currency: string } | null {
  const own = s.retail[currency as keyof BsSet['retail']];
  if (own) return { price: own, currency };
  return s.retail.USD ? { price: s.retail.USD, currency: 'USD' } : null;
}

/**
 * Asks Brickset about sets and wishes it hasn't checked in the last 30 days, using at most `maxCalls` calls
 * (50 sets each). Returns readable errors; never throws.
 */
export async function syncRetail(db: DB, src: RetailSource, opts: { maxCalls?: number } = {}): Promise<string[]> {
  const stale = new Date(Date.now() - RECHECK_DAYS * 86_400_000).toISOString();
  const currency = await getCurrency(db);
  const due = (t: typeof sets | typeof wishlist) => or(isNull(t.bricksetAt), lt(t.bricksetAt, stale));
  const owned = await db.select({ id: sets.id, setNo: sets.setNo }).from(sets).where(due(sets)).orderBy(asc(sets.bricksetAt), asc(sets.setNo)).all();
  const wanted = await db.select({ id: wishlist.id, setNo: wishlist.setNo }).from(wishlist).where(due(wishlist)).orderBy(asc(wishlist.bricksetAt)).all();
  const numbers = [...new Set([...owned, ...wanted].map((r) => fullSetNo(r.setNo)))];
  if (!numbers.length) return [];

  let result;
  try {
    result = await src.sets(numbers, { maxCalls: opts.maxCalls ?? 10 });
  } catch (e) {
    return [`Brickset: ${e instanceof Error ? e.message.replace(/^Brickset: /, '') : String(e)}`];
  }
  const bySetNo = new Map(result.found.map((s) => [s.setNo, s]));
  const now = new Date().toISOString();
  for (const no of result.asked) {
    const s = bySetNo.get(no);
    const retail = s ? pickRetail(s, currency) : null;
    const row = {
      retailPrice: retail?.price ?? null, retailCurrency: retail?.currency ?? null,
      launchDate: s?.launchDate ?? null, exitDate: s?.exitDate ?? null, retired: s ? s.retired : null, bricksetAt: now,
    };
    // Set numbers are stored with their suffix, but older rows may lack it; match both.
    const short = no.endsWith('-1') ? no.slice(0, -2) : no;
    await db.update(sets).set(row).where(or(eq(sets.setNo, no), eq(sets.setNo, short)));
    await db.update(wishlist).set(row).where(or(eq(wishlist.setNo, no), eq(wishlist.setNo, short)));
  }
  // Brickset's EAN and UPC for these sets, so scanning a box you own or want needs no outside lookup.
  await saveBricksetBarcodes(db, result.found);
  return [];
}

export type RetailStats = { sets: number; withRetail: number; retiring: number; retired: number; notChecked: number };

/** How far the Brickset sync has got, for Settings. */
export async function retailStats(db: DB): Promise<RetailStats> {
  const soon = new Date(Date.now() + SOON_DAYS * 86_400_000).toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  const [s] = await db.select({
    sets: sql<number>`count(*)`,
    withRetail: sql<number>`sum(case when ${sets.retailPrice} is not null then 1 else 0 end)`,
    retired: sql<number>`sum(case when ${sets.retired} = 1 or ${sets.exitDate} < ${today} then 1 else 0 end)`,
    retiring: sql<number>`sum(case when coalesce(${sets.retired}, 0) = 0 and ${sets.exitDate} >= ${today} and ${sets.exitDate} <= ${soon} then 1 else 0 end)`,
    notChecked: sql<number>`sum(case when ${sets.bricksetAt} is null then 1 else 0 end)`,
  }).from(sets).all();
  const n = (v: unknown) => Number(v ?? 0);
  return { sets: n(s.sets), withRetail: n(s.withRetail), retiring: n(s.retiring), retired: n(s.retired), notChecked: n(s.notChecked) };
}
