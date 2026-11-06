// Part-out value: what a set would fetch sold as separate parts, priced with BrickLink's per-part sold price guide.
// Part prices are shared across sets and cached for 30 days. Each one costs a BrickLink call, so the daily sync
// fetches at most PARTOUT_DAILY_CALLS of them, and fewer when the rest of the sync has used the budget.
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { PartPriceLookup } from '../bricklink/client';
import { partKey } from '../bricklink/wanted';
import { partPrices, setMissingParts, setParts, sets } from '../db/schema';
import type { DB } from '../db/types';
import { isActive, priceGuide, setGuide, type Condition } from '../sets';
import { copiesBySet } from './sets';
import { DAILY_LIMIT, RESERVE } from './budget';

const NO_COLOR = -1;
const TTL_DAYS = 30;

/** PARTOUT_DAILY_CALLS: most part prices fetched per daily sync (default 1,500; 0 turns part-out pricing off). */
export const partoutDailyCalls = () => {
  const n = Number(process.env.PARTOUT_DAILY_CALLS ?? 1500);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), DAILY_LIMIT - RESERVE) : 0;
};

/** Calls left for part prices after the rest of today's sync: sets, wishes and minifigs cost 2 calls each. */
export function partoutBudget(usedCalls: number, cap = partoutDailyCalls()) {
  return Math.max(0, Math.min(cap, DAILY_LIMIT - RESERVE - usedCalls));
}

type Line = { type: string; partNo: string; colorId: number | null; qty: number };

/** A set's regular parts (no alternates or counterparts), merged by part and color, like the missing-parts list. */
async function lines(db: DB, setId: number): Promise<Line[]> {
  const rows = await db.select({ type: setParts.type, partNo: setParts.partNo, colorId: setParts.colorId, qty: setParts.qty }).from(setParts)
    .where(and(eq(setParts.setId, setId), eq(setParts.alternate, false), eq(setParts.counterpart, false))).all();
  const map = new Map<string, Line>();
  for (const r of rows) {
    const k = partKey(r.type, r.partNo, r.colorId);
    const m = map.get(k);
    if (m) m.qty += r.qty; else map.set(k, { ...r });
  }
  return [...map.values()];
}

const colorOf = (l: { type: string; colorId: number | null }) => (l.type === 'PART' && l.colorId !== null ? l.colorId : NO_COLOR);
const priceKey = (l: { type: string; partNo: string; colorId: number | null }) => partKey(l.type, l.partNo, colorOf(l) === NO_COLOR ? null : colorOf(l));

async function pricesFor(db: DB, ls: Line[], guide: 'N' | 'U', currency: string) {
  const nos = [...new Set(ls.map((l) => l.partNo))];
  const out = new Map<string, typeof partPrices.$inferSelect>();
  for (let i = 0; i < nos.length; i += 400) {
    const rows = await db.select().from(partPrices)
      .where(and(eq(partPrices.guide, guide), eq(partPrices.currency, currency), inArray(partPrices.partNo, nos.slice(i, i + 400)))).all();
    for (const r of rows) out.set(partKey(r.type, r.partNo, r.colorId === NO_COLOR ? null : r.colorId), r);
  }
  return out;
}

export type Partout = {
  guide: 'N' | 'U';
  value: number; // sum of qty × average sold, over the priced lots
  lots: number;
  pricedLots: number; // lots with a cached price (sold or not)
  soldLots: number; // lots whose price had recent sales
  pieces: number;
  pricedPieces: number;
  coverage: number; // % of pieces with a cached price
  oldest: string | null; // oldest price used, ISO time
  ageDays: number | null; // how many days old that price is
  missingValue: number | null; // value of the parts marked missing, when they're all priced
  missingPctByValue: number | null; // missingValue ÷ value, when coverage is at least 90%
};

/** Whole-set coverage needed before Missing % is weighted by part price instead of piece count. */
export const WEIGHTED_COVERAGE = 90;

/** Part-out value of one set from cached part prices. Makes no API calls. */
/** Part-out value of a set. Missing value counts the parts marked on `copyId` (all copies' marks when not given). */
export async function partout(db: DB, setId: number, condition: Condition | null, currency: string, copyId?: number | null): Promise<Partout> {
  const guide = priceGuide(condition);
  const ls = await lines(db, setId);
  const cache = await pricesFor(db, ls, guide, currency);
  let value = 0, pricedLots = 0, soldLots = 0, pricedPieces = 0, oldest: string | null = null;
  for (const l of ls) {
    const p = cache.get(priceKey(l));
    if (!p || p.error) continue;
    pricedLots++; pricedPieces += l.qty;
    if (p.avgSold != null) { value += p.avgSold * l.qty; soldLots++; }
    if (!oldest || p.fetchedAt < oldest) oldest = p.fetchedAt;
  }
  const pieces = ls.reduce((t, l) => t + l.qty, 0);
  const coverage = pieces ? Math.round((pricedPieces / pieces) * 1000) / 10 : 0;

  const marked = await db.select().from(setMissingParts).where(copyId == null ? eq(setMissingParts.setId, setId) : and(eq(setMissingParts.setId, setId), eq(setMissingParts.copyId, copyId))).all();
  let missingValue: number | null = null;
  if (marked.length) {
    missingValue = 0;
    for (const m of marked) {
      const p = cache.get(priceKey({ type: m.type, partNo: m.partNo, colorId: m.colorId === NO_COLOR ? null : m.colorId }));
      if (!p || p.error) { missingValue = null; break; }
      missingValue += (p.avgSold ?? 0) * m.qty;
    }
  }
  const missingPctByValue = missingValue != null && value > 0 && coverage >= WEIGHTED_COVERAGE ? Math.round((missingValue / value) * 1000) / 10 : null;
  return { guide, value: Math.round(value * 100) / 100, lots: ls.length, pricedLots, soldLots, pieces, pricedPieces, coverage, oldest, ageDays: oldest ? Math.max(0, Math.round((Date.now() - Date.parse(oldest)) / 86_400_000)) : null, missingValue: missingValue == null ? null : Math.round(missingValue * 100) / 100, missingPctByValue };
}

/**
 * Fetches part prices that are missing or older than 30 days, for the given sets (most valuable first when
 * none are given), up to `maxCalls`. Errors are stored on the price row so a bad part isn't retried every day.
 */
export async function refreshPartPrices(
  db: DB, lookup: PartPriceLookup, currency: string, opts: { setIds?: number[]; maxCalls: number },
): Promise<{ fetched: number; errors: number; remaining: number }> {
  if (opts.maxCalls <= 0) return { fetched: 0, errors: 0, remaining: 0 };
  const copies = await copiesBySet(db, opts.setIds);
  // Most valuable first, each in the guide most of its copies need.
  const owned = (await db.select({ id: sets.id }).from(sets).where(opts.setIds ? inArray(sets.id, opts.setIds) : sql`1 = 1`).orderBy(asc(sets.id)).all())
    .map((s) => { const cs = copies.get(s.id) ?? []; return { id: s.id, guide: setGuide(cs), value: cs.filter(isActive).reduce((t, c) => t + (c.estValue ?? 0), 0) }; })
    .sort((a, b) => b.value - a.value || a.id - b.id);
  const stale = new Date(Date.now() - TTL_DAYS * 86_400_000).toISOString();
  const todo: { line: Line; guide: 'N' | 'U' }[] = [];
  const seen = new Set<string>();
  for (const s of owned) {
    const guide = s.guide;
    const ls = await lines(db, s.id);
    const cache = await pricesFor(db, ls, guide, currency);
    for (const l of ls) {
      const k = `${guide}|${priceKey(l)}`;
      if (seen.has(k)) continue;
      seen.add(k);
      const p = cache.get(priceKey(l));
      if (!p || p.fetchedAt < stale) todo.push({ line: l, guide });
    }
  }
  let fetched = 0, errors = 0;
  for (const { line: l, guide } of todo.slice(0, opts.maxCalls)) {
    const colorId = colorOf(l);
    const base = { type: l.type, partNo: l.partNo, colorId, guide, currency, fetchedAt: new Date().toISOString() };
    let row: typeof partPrices.$inferInsert;
    try {
      const p = await lookup(l.type, l.partNo, colorId === NO_COLOR ? null : colorId, guide, currency);
      row = { ...base, avgSold: p.avgSold, qtySold: p.qtySold, error: null };
      fetched++;
    } catch (e) {
      row = { ...base, avgSold: null, qtySold: null, error: (e instanceof Error ? e.message : String(e)).slice(0, 200) };
      errors++;
    }
    await db.insert(partPrices).values(row).onConflictDoUpdate({
      target: [partPrices.type, partPrices.partNo, partPrices.colorId, partPrices.guide, partPrices.currency],
      set: { avgSold: row.avgSold, qtySold: row.qtySold, error: row.error, fetchedAt: row.fetchedAt },
    });
  }
  return { fetched, errors, remaining: Math.max(0, todo.length - opts.maxCalls) };
}

/** How many part prices one set still needs, so the UI can say how long "Price parts now" will take. */
export async function unpricedLots(db: DB, setId: number, condition: Condition | null, currency: string): Promise<number> {
  const guide = priceGuide(condition);
  const ls = await lines(db, setId);
  const cache = await pricesFor(db, ls, guide, currency);
  const stale = new Date(Date.now() - TTL_DAYS * 86_400_000).toISOString();
  return ls.filter((l) => { const p = cache.get(priceKey(l)); return !p || p.fetchedAt < stale; }).length;
}
