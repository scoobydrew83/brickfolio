// Insurance / valuation report: every set and minifigure with its value, where the number came from and when.
// The data is built here (testable); lib/report/pdf.ts draws it.
import type { DB } from '../db/types';
import { displayNo, groupTotals, isActive, num, totals, withCopies, type CopyRow, type SetRow } from '../sets';
import { listMinifigs, minifigTotals } from './minifigs';
import { getCurrency, listSets, syncStatus } from './sets';

export type ReportLine = {
  kind: 'set' | 'minifig';
  no: string; // display number: 10497, sw0001
  ref: string; // the number photos are looked up by: 10497-1, sw0001, fig-000123
  name: string;
  year: number | null;
  condition: string | null;
  missingPct: number | null;
  qty: number;
  location: string | null;
  each: number | null; // Est. Value per copy
  total: number | null;
  sales: number | null; // BrickLink sales the average is based on
  pricedAt: string | null; // YYYY-MM-DD of the last BrickLink lookup
  retail: number | null; // original retail price, same currency only
};

export type Valuation = {
  generatedAt: string; // ISO time
  owner: string | null;
  currency: string;
  lastSync: string | null; // ISO time the last full sync finished
  totals: { sets: number; setCopies: number; setValue: number; minifigs: number; minifigCopies: number; minifigValue: number; value: number; unpriced: number; retail: number | null; retailCovered: number };
  byLocation: { label: string; items: number; copies: number; value: number }[];
  lines: ReportLine[];
  partialWithParts: number; // Partial copies whose Missing % comes from marked parts
};

const round = (v: number) => Math.round(v * 100) / 100;
const day = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : null);

/** Everything the report shows. `owner` is printed on the cover line when given. */
export async function valuation(db: DB, opts: { owner?: string | null } = {}): Promise<Valuation> {
  const [sets, figs, currency, sync] = await Promise.all([listSets(db), listMinifigs(db), getCurrency(db), syncStatus(db)]);
  // One line per set and (location, condition, Missing %) group of its copies; parted out copies aren't listed.
  const groups = (s: SetRow): SetRow[] => {
    const by = new Map<string, CopyRow[]>();
    for (const c of s.copies.filter(isActive)) { const k = JSON.stringify([c.location, c.condition, c.missingPct]); by.set(k, [...(by.get(k) ?? []), c]); }
    return [...by.values()].map((cs) => withCopies(s, cs));
  };
  const lines: ReportLine[] = [
    ...sets.flatMap(groups).map((s): ReportLine => ({
      kind: 'set', no: displayNo(s.setNo), ref: s.setNo, name: s.name, year: s.year, condition: s.condition, missingPct: s.missingPct, qty: s.qty,
      location: s.location, each: s.estValue, total: s.valueTotal, sales: s.qtySold,
      pricedAt: day(s.lastUpdated), retail: s.retailPrice && s.retailCurrency === currency ? s.retailPrice : null,
    })),
    ...figs.map((m): ReportLine => ({
      kind: 'minifig', no: m.figNo ?? m.rbFigNo ?? '', ref: m.figNo ?? m.rbFigNo ?? '', name: m.name, year: m.year, condition: m.condition, missingPct: null, qty: m.qty,
      location: m.location, each: m.estValue, total: m.estValue == null ? null : round(m.estValue * m.qty), sales: m.qtySold,
      pricedAt: day(m.lastUpdated), retail: null,
    })),
  ].sort((a, b) => (a.location ?? '￿').localeCompare(b.location ?? '￿') || num(b.total) - num(a.total) || a.no.localeCompare(b.no, undefined, { numeric: true }));

  const st = totals(sets), ft = minifigTotals(figs);
  const loc = new Map<string, { label: string; items: number; copies: number; value: number }>();
  for (const g of groupTotals(sets, 'location')) loc.set(g.label, { label: g.label, items: g.count, copies: g.copies, value: g.estValue });
  for (const m of figs) {
    const k = m.location || '(none)';
    const e = loc.get(k) ?? { label: k, items: 0, copies: 0, value: 0 };
    e.items++; e.copies += m.qty; e.value += num(m.estValue) * m.qty;
    loc.set(k, e);
  }
  const withRetail = lines.filter((l) => l.retail != null);
  const owner = String(opts.owner ?? '').trim().slice(0, 80) || null;
  return {
    generatedAt: new Date().toISOString(), owner, currency, lastSync: sync?.finishedAt ?? null,
    totals: {
      sets: st.count, setCopies: st.copies, setValue: round(st.estValue), minifigs: ft.count, minifigCopies: ft.copies, minifigValue: round(ft.estValue),
      value: round(st.estValue + ft.estValue), unpriced: lines.filter((l) => l.each == null).length,
      retail: withRetail.length ? round(withRetail.reduce((t, l) => t + l.retail! * l.qty, 0)) : null, retailCovered: withRetail.length,
    },
    byLocation: [...loc.values()].map((l) => ({ ...l, value: round(l.value) })).sort((a, b) => b.value - a.value),
    lines,
    partialWithParts: sets.reduce((t, s) => t + s.copies.filter((c) => isActive(c) && c.condition === 'Partial' && c.missingMarked).length, 0),
  };
}

/** Photos for the report's lines, by `${kind}:${ref}`: from the image cache, fetched once if missing. PNG and JPEG only (what a PDF can hold). */
export async function reportPhotos(lines: Pick<ReportLine, 'kind' | 'ref'>[], get: (kind: 'set' | 'minifig', ref: string) => Promise<{ body: ArrayBuffer; type: string } | null>, opts: { max?: number; concurrency?: number } = {}): Promise<Map<string, { body: ArrayBuffer; type: string }>> {
  const keys = [...new Set(lines.filter((l) => l.ref).map((l) => `${l.kind}:${l.ref}`))].slice(0, opts.max ?? 1000);
  const out = new Map<string, { body: ArrayBuffer; type: string }>();
  let next = 0;
  const worker = async () => {
    while (next < keys.length) {
      const k = keys[next++];
      const [kind, ref] = [k.slice(0, k.indexOf(':')) as 'set' | 'minifig', k.slice(k.indexOf(':') + 1)];
      const img = await get(kind, ref).catch(() => null);
      if (img && (img.type === 'image/png' || img.type === 'image/jpeg')) out.set(k, img);
    }
  };
  await Promise.all(Array.from({ length: opts.concurrency ?? 4 }, worker));
  return out;
}
