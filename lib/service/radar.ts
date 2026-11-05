// Retirement Radar: when your sets and wishes retire, and how retired sets have done since.
// Uses Brickset dates and retail prices plus the BrickLink sold prices stored at each sync. Makes no API calls.
import { and, asc, eq, gte, inArray, isNotNull, isNull, lte, or, sql } from 'drizzle-orm';
import type { DB } from '../db/types';
import { priceObservations, wishlist } from '../db/schema';
import { displayNo, money, setGuide } from '../sets';
import { retirement } from '../retail';
import { daysUntil, flagsFor, growthSince, type Flag, type Growth, type PricePoint } from '../radar';
import { getCurrency, listSets } from './sets';
import type { Send } from './alerts';

export type RadarItem = {
  kind: 'set' | 'wish';
  setNo: string;
  name: string;
  imageUrl: string | null;
  theme: string | null;
  flags: Flag[];
  exitDate: string | null;
  status: 'retired' | 'retiring' | 'available';
  qty: number; // copies owned (0 for a wish)
  value: number | null; // Est. Value per copy for a set, average sold for a wish
  retailPrice: number | null;
  retailCurrency: string | null;
  gainPct: number | null; // value against retail, same currency only
  growth: Growth | null; // retired sets only
};

export type Radar = {
  currency: string;
  today: string;
  retiring: { month: string; items: RadarItem[] }[]; // expected to retire, soonest first
  retired: RadarItem[]; // retired sets you own, best growth first
  totals: {
    retiringSoon: number; // within about six months (owned and wished)
    wishesRetiringSoon: number;
    retiredOwned: number;
    retiredValue: number; // Est. Value of retired sets you own (all copies)
    medianGrowth: number | null; // median growth per year over retired sets with a growth figure
    flagged: Record<Flag, number>;
  };
};

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round(((s[m - 1] + s[m]) / 2) * 10) / 10;
};
const gain = (value: number | null, retail: number | null, rc: string | null, currency: string) =>
  value != null && retail && rc === currency ? Math.round(((value - retail) / retail) * 1000) / 10 : null;

export async function getRadar(db: DB, todayIso = new Date().toISOString().slice(0, 10)): Promise<Radar> {
  const currency = await getCurrency(db);
  const owned = await listSets(db);
  const wishes = await db.select().from(wishlist).all();

  // Stored prices for retired sets, in the guide most of each set's copies need today.
  const retiredOwned = owned.filter((s) => retirement(s, todayIso)?.kind === 'retired');
  const obs = retiredOwned.length
    ? await db.select({ setNo: priceObservations.itemId, date: priceObservations.observedOn, guide: priceObservations.condition, avgSold: priceObservations.amount })
      .from(priceObservations)
      .where(and(eq(priceObservations.itemKind, 'set'), inArray(priceObservations.itemId, retiredOwned.map((s) => s.setNo)), eq(priceObservations.source, 'bricklink'), eq(priceObservations.type, 'sold_avg'), eq(priceObservations.currency, currency)))
      .orderBy(asc(priceObservations.observedOn)).all()
    : [];
  const bySet = new Map<string, PricePoint[]>();
  const guideOf = new Map(retiredOwned.map((s) => [s.setNo, setGuide(s.copies)]));
  for (const p of obs) if (p.guide === guideOf.get(p.setNo)) bySet.set(p.setNo, [...(bySet.get(p.setNo) ?? []), p]);

  const status = (r: { exitDate?: string | null; retired?: boolean | null }): RadarItem['status'] => retirement(r, todayIso)?.kind ?? (r.exitDate && r.exitDate >= todayIso ? 'retiring' : 'available');
  const items: RadarItem[] = [
    ...owned.map((s): RadarItem => ({
      kind: 'set', setNo: s.setNo, name: s.name, imageUrl: s.imageUrl, theme: s.subtheme ? `${s.theme} · ${s.subtheme}` : s.theme ?? null,
      flags: flagsFor(s.theme, s.subtheme, s.name, s.blName), exitDate: s.exitDate ?? null, status: status(s), qty: s.qty,
      value: s.estValue, retailPrice: s.retailPrice ?? null, retailCurrency: s.retailCurrency ?? null,
      gainPct: gain(s.estValue, s.retailPrice ?? null, s.retailCurrency ?? null, currency),
      growth: status(s) === 'retired'
        ? growthSince(s.exitDate, s.avgSold, bySet.get(s.setNo) ?? [], { price: s.retailPrice, currency: s.retailCurrency }, currency, todayIso)
        : null,
    })),
    ...wishes.map((w): RadarItem => ({
      kind: 'wish', setNo: w.setNo, name: w.name ?? `Set ${displayNo(w.setNo)}`, imageUrl: w.imageUrl, theme: null, flags: flagsFor(w.name),
      exitDate: w.exitDate, status: status(w), qty: 0, value: w.avgSold, retailPrice: w.retailPrice, retailCurrency: w.retailCurrency,
      gainPct: gain(w.avgSold, w.retailPrice, w.retailCurrency, currency), growth: null,
    })),
  ];

  const upcoming = items.filter((i) => i.status !== 'retired' && i.exitDate && i.exitDate >= todayIso)
    .sort((a, b) => a.exitDate!.localeCompare(b.exitDate!) || a.name.localeCompare(b.name));
  const months = new Map<string, RadarItem[]>();
  for (const i of upcoming) months.set(i.exitDate!.slice(0, 7), [...(months.get(i.exitDate!.slice(0, 7)) ?? []), i]);

  const retired = items.filter((i) => i.kind === 'set' && i.status === 'retired')
    .sort((a, b) => (b.growth?.perYear ?? -Infinity) - (a.growth?.perYear ?? -Infinity) || (b.gainPct ?? -Infinity) - (a.gainPct ?? -Infinity));
  const soon = items.filter((i) => retirement(i, todayIso)?.kind === 'retiring');
  const flagged = { designer: 0, smart: 0 } as Record<Flag, number>;
  for (const i of items) for (const f of i.flags) flagged[f]++;

  return {
    currency, today: todayIso,
    retiring: [...months].map(([month, list]) => ({ month, items: list })),
    retired,
    totals: {
      retiringSoon: soon.length,
      wishesRetiringSoon: soon.filter((i) => i.kind === 'wish').length,
      retiredOwned: retired.length,
      retiredValue: Math.round(retired.reduce((t, i) => t + (i.value ?? 0) * i.qty, 0) * 100) / 100,
      medianGrowth: median(retired.flatMap((i) => (i.growth ? [i.growth.perYear] : []))),
      flagged,
    },
  };
}

/** RETIRE_ALERT_DAYS (default 60; 0 turns it off): warn about wishes retiring within this many days. */
export const retireAlertDays = () => {
  const n = Number(process.env.RETIRE_ALERT_DAYS ?? 60);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 730) : 0;
};

/**
 * Sends one alert for wishes that will retire within `days` and haven't been alerted about yet, and marks them.
 * A wish whose exit date moves out of the window is re-armed. Returns an error message instead of throwing.
 */
export async function notifyRetiring(db: DB, send: Send, days = retireAlertDays(), todayIso = new Date().toISOString().slice(0, 10)): Promise<string | null> {
  if (!days) return null;
  const until = new Date(Date.parse(todayIso) + days * 86_400_000).toISOString().slice(0, 10);
  const inWindow = and(isNotNull(wishlist.exitDate), gte(wishlist.exitDate, todayIso), lte(wishlist.exitDate, until), sql`coalesce(${wishlist.retired}, 0) = 0`);
  await db.update(wishlist).set({ retireAlertedAt: null })
    .where(and(isNotNull(wishlist.retireAlertedAt), or(isNull(wishlist.exitDate), sql`not (${inWindow})`)));
  const fresh = await db.select().from(wishlist).where(and(inWindow, isNull(wishlist.retireAlertedAt))).all();
  if (!fresh.length) return null;
  const currency = await getCurrency(db);
  const lines = fresh.map((w) => {
    const d = daysUntil(w.exitDate!, todayIso);
    const price = w.avgSold != null ? `, average sold ${money(w.avgSold, currency)}` : '';
    return `${displayNo(w.setNo)} ${w.name ?? ''}: retires ${w.exitDate} (in ${d} day${d === 1 ? '' : 's'})${price}`.replace(/\s+:/, ':');
  });
  const base = process.env.APP_URL?.replace(/\/$/, '');
  try {
    await send({
      title: fresh.length === 1 ? `${fresh[0].name ?? displayNo(fresh[0].setNo)} retires soon` : `${fresh.length} wishlist sets retire soon`,
      message: lines.join('\n'),
      url: base ? `${base}/radar` : null,
      items: fresh.map((w) => ({ setNo: displayNo(w.setNo), name: w.name ?? displayNo(w.setNo), avgSold: w.avgSold ?? 0, target: w.target ?? 0 })),
    });
  } catch (e) {
    return `Retirement alert not sent: ${e instanceof Error ? e.message : String(e)}`;
  }
  const at = new Date().toISOString();
  for (const w of fresh) await db.update(wishlist).set({ retireAlertedAt: at }).where(eq(wishlist.id, w.id));
  return null;
}
