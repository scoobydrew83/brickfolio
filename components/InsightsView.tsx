// The Insights page: where the collection's value sits (theme, year, location), which sets earned the most and least
// on what they cost, what sold copies brought in, and how the collection compares to retail. Figures from lib/insights.ts.
import Link from 'next/link';
import type { Bar, Insights, Return } from '@/lib/insights';
import { displayNo } from '@/lib/sets';
import { moneyIn } from './board/ui';
import { PageHeader } from './shell/PageHeader';
import { Callout, EmptyState, Stat, cx } from './ui';

type Money = ReturnType<typeof moneyIn>;
const signed = (money: Money, v: number) => `${v >= 0 ? '+' : '−'}${money(Math.abs(v))}`;

/** Horizontal bars, longest = the biggest value. Plain HTML so labels wrap and it reads well on phones. */
function Bars({ heading, bars, money, note }: { heading: string; bars: Bar[]; money: Money; note?: string }) {
  const max = Math.max(...bars.map((b) => b.value), 0);
  return (
    <section aria-labelledby={`bars-${heading}`} className="min-w-0">
      <h2 id={`bars-${heading}`} className="text-sm font-semibold">{heading}</h2>
      {note && <p className="text-xs text-fg-3">{note}</p>}
      {bars.length ? (
        <ul className="mt-2 space-y-2">
          {bars.map((b) => (
            <li key={b.label} className="text-sm">
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate">{b.label}</span>
                <span className="shrink-0 tabular-nums"><b>{money(b.value)}</b> <span className="text-xs text-fg-3">· {b.count}</span></span>
              </div>
              <div className="mt-1 h-2 rounded-chip bg-subtle" aria-hidden>
                <div className="h-2 rounded-chip bg-outline" style={{ width: `${max ? Math.max(1, (b.value / max) * 100) : 0}%` }} />
              </div>
            </li>
          ))}
        </ul>
      ) : <p className="mt-2 text-sm text-fg-3">Nothing to show yet.</p>}
    </section>
  );
}

function ReturnList({ heading, rows, money }: { heading: string; rows: Return[]; money: Money }) {
  return (
    <section aria-label={heading} className="min-w-0">
      <h2 className="text-sm font-semibold">{heading}</h2>
      {rows.length ? (
        <Callout className="mt-2 divide-y divide-line">
          {rows.map((r) => (
            <Link key={r.setNo} href={`/sets/${displayNo(r.setNo)}`} className="flex items-baseline gap-3 px-3 py-2 text-sm hover:bg-subtle">
              <span className={cx('w-16 shrink-0 font-extrabold tabular-nums [font-stretch:112%]', r.gain >= 0 ? 'text-ok' : 'text-danger')}>{r.pct >= 0 ? '+' : '−'}{Math.abs(r.pct)}%</span>
              <span className="min-w-0 flex-1 truncate">{r.name} <span className="text-fg-3">#{displayNo(r.setNo)}</span></span>
              <span className="shrink-0 text-xs text-fg-3 tabular-nums">{money(r.cost)} → {money(r.value)}</span>
            </Link>
          ))}
        </Callout>
      ) : <p className="mt-2 text-sm text-fg-3">Add what you paid to a copy to see its return here.</p>}
    </section>
  );
}

export function InsightsView({ data, currency }: { data: Insights; currency: string }) {
  const money = moneyIn(currency);
  const t = data.total;
  if (!t.count && !t.sold) {
    return (
      <div className="space-y-6">
        <PageHeader title="Insights" />
        <EmptyState title="Nothing to analyse yet">Add sets on the <Link href="/" className="text-link underline">Sets page</Link>; their value, cost and sales show up here.</EmptyState>
      </div>
    );
  }
  return (
    <div className="space-y-8">
      <PageHeader title="Insights" badge={<span className="text-sm text-fg-3 tabular-nums">{t.count} sets · {t.copies} copies</span>} />
      <section aria-label="Totals" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Est. Value" value={money(t.estValue)} note="Owned copies" />
        <Stat label="Gain on cost" value={t.gain == null ? '—' : signed(money, t.gain)} note={t.costBasis == null ? 'Add prices paid to see it' : `Cost ${money(t.costBasis)} · ${data.costCoverage.covered} of ${data.costCoverage.of} sets`} tone={t.gain != null && t.gain < 0 ? 'danger' : undefined} />
        <Stat label="Realised" value={t.realised == null ? '—' : signed(money, t.realised)} note={t.sold ? `${t.sold} sold for ${money(t.saleTotal)} after fees` : 'Mark a copy Sold to see it'} tone={t.realised != null && t.realised < 0 ? 'danger' : undefined} />
        <Stat label="vs. retail" value={data.retail ? `${data.retail.gainPct >= 0 ? '+' : '−'}${Math.abs(data.retail.gainPct)}%` : '—'} note={data.retail ? `${data.retail.sets} sets: ${money(data.retail.retail)} → ${money(data.retail.value)}` : 'Needs Brickset retail prices'} tone={data.retail && data.retail.gainPct < 0 ? 'danger' : undefined} />
      </section>
      <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
        <Bars heading="Value by theme" bars={data.byTheme} money={money} note="Top 12 · copies after each value" />
        <Bars heading="Value by year" bars={data.byYear} money={money} note="Release year · copies after each value" />
        <Bars heading="Value by location" bars={data.byLocation} money={money} note="Top 12 · copies after each value" />
        <div className="space-y-8">
          <ReturnList heading="Best return on cost" rows={data.best} money={money} />
          <ReturnList heading="Lowest return on cost" rows={data.worst} money={money} />
        </div>
      </div>
    </div>
  );
}
