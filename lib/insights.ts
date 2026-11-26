// The Insights page's figures, from the same set rows as the Sets page (owned copies only: parted out and sold copies
// aren't counted, except in the realised gain). Pure, so it's tested without a database (insights.test.ts).
import { collectionGain } from './retail';
import { groupTotals, num, totals, type SetRow } from './sets';

export type Bar = { label: string; value: number; count: number };
export type Return = { setNo: string; name: string; cost: number; value: number; gain: number; pct: number };
export type Insights = {
  total: ReturnType<typeof totals>;
  byTheme: Bar[];
  byYear: Bar[];
  byLocation: Bar[];
  best: Return[];
  worst: Return[];
  /** Sets with a cost and a value, out of all owned sets. */
  costCoverage: { covered: number; of: number };
  retail: ReturnType<typeof collectionGain>;
};

const r2 = (v: number) => Math.round(v * 100) / 100;

/** Value by release year, oldest first; sets without a year are left out. */
export function byYear(sets: SetRow[]): Bar[] {
  const m = new Map<number, Bar>();
  for (const s of sets) {
    if (!s.qty || !s.year) continue;
    const b = m.get(s.year) ?? { label: String(s.year), value: 0, count: 0 };
    b.value = r2(b.value + num(s.valueTotal));
    b.count += s.qty;
    m.set(s.year, b);
  }
  return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([, b]) => b);
}

/** Each owned set's return on what it cost (copies with both a cost and a value), best first. */
export function returns(sets: SetRow[]): Return[] {
  return sets
    .filter((s) => s.qty > 0 && s.costBasis != null && s.costBasis > 0 && s.gain != null)
    .map((s) => {
      const cost = num(s.costBasis), gain = num(s.gain);
      return { setNo: s.setNo, name: s.name, cost, value: r2(cost + gain), gain, pct: Math.round((gain / cost) * 1000) / 10 };
    })
    .sort((a, b) => b.pct - a.pct || b.gain - a.gain);
}

export function insights(sets: SetRow[], currency: string, top = 10, bars = 12): Insights {
  const owned = sets.filter((s) => s.qty > 0);
  const toBars = (g: ReturnType<typeof groupTotals>) => g.slice(0, bars).map((x) => ({ label: x.label, value: r2(x.estValue), count: x.copies }));
  const ret = returns(sets);
  return {
    total: totals(sets),
    byTheme: toBars(groupTotals(owned, 'theme')),
    byYear: byYear(owned),
    byLocation: toBars(groupTotals(owned, 'location')),
    // Best and lowest never share a set: with fewer than 2 × top, each list takes half.
    best: ret.slice(0, Math.min(top, Math.ceil(ret.length / 2))),
    worst: ret.slice(Math.min(top, Math.ceil(ret.length / 2))).reverse().slice(0, top),
    costCoverage: { covered: ret.length, of: owned.length },
    retail: collectionGain(owned, currency),
  };
}
