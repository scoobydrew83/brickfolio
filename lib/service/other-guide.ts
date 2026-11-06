// The other condition's BrickLink price guide for each set (used for a mostly sealed set, new for a mostly built or
// partial one), so the set page and Radar can show what a set sells for new against used, and every copy is valued
// in its own condition. One price call each (no catalog call), refreshed about weekly within the sync's budget.
import type { PriceLookup } from '../bricklink/client';
import { sets } from '../db/schema';
import type { DB } from '../db/types';
import { isActive, setGuide } from '../sets';
import { repriceCopies } from './copies';
import { brickLinkGuidesMany, recordPrice } from './prices';
import { copiesBySet, today } from './sets';

const REFRESH_DAYS = 7;

/**
 * Fetches the other guide for sets whose newest price in it is missing or older than a week, oldest first, using at
 * most `maxCalls` calls, and re-values their copies. Never throws.
 */
export async function refreshOtherGuide(db: DB, price: PriceLookup, currency: string, opts: { maxCalls: number }): Promise<{ fetched: number; errors: number; remaining: number }> {
  if (opts.maxCalls <= 0) return { fetched: 0, errors: 0, remaining: 0 };
  const copies = await copiesBySet(db);
  const owned = (await db.select({ id: sets.id, setNo: sets.setNo }).from(sets).all())
    .map((s) => ({ ...s, active: (copies.get(s.id) ?? []).filter(isActive) }))
    .filter((s) => s.active.length)
    .map((s) => ({ ...s, other: setGuide(s.active) === 'N' ? 'U' as const : 'N' as const }));
  const guides = await brickLinkGuidesMany(db, 'set', owned.map((s) => s.setNo), currency);
  const stale = new Date(Date.parse(today()) - REFRESH_DAYS * 86_400_000).toISOString().slice(0, 10);
  const last = (s: (typeof owned)[number]) => guides.get(s.setNo)?.[s.other]?.observedOn ?? '';
  const due = owned.filter((s) => last(s) <= stale).sort((a, b) => last(a).localeCompare(last(b)) || a.setNo.localeCompare(b.setNo));

  let fetched = 0, errors = 0, failedInARow = 0;
  for (const s of due) {
    if (fetched + errors >= opts.maxCalls || failedInARow >= 3) break;
    try {
      const r = await price('SET', s.setNo, s.other, currency);
      await recordPrice(db, { itemKind: 'set', itemId: s.setNo, source: 'bricklink', type: 'sold_avg', condition: s.other, currency, amount: r.avgSold, low: r.minSold, high: r.maxSold, sampleSize: r.qtySold, observedOn: today() });
      await repriceCopies(db, s.id);
      fetched++;
      failedInARow = 0;
    } catch {
      errors++;
      failedInARow++;
    }
  }
  return { fetched, errors, remaining: Math.max(0, due.length - fetched - errors) };
}
