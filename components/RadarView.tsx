'use client';
import Image from 'next/image';
import Link from 'next/link';
import { useMemo } from 'react';
import type { Radar, RadarItem } from '@/lib/service/radar';
import type { ProjectRow } from '@/lib/service/designer';
import { DesignerSection } from './DesignerSection';
import { FLAG_LABEL, daysUntil, monthLabel } from '@/lib/radar';
import { displayNo } from '@/lib/sets';
import { moneyIn, type Money } from './board/ui';
import { PageHeader } from './shell/PageHeader';
import { Chip, EmptyState, Stat, cx } from './ui';

const pct = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v)}%`;

export default function RadarView({ radar, projects, hasBrickset }: { radar: Radar; projects: ProjectRow[]; hasBrickset: boolean }) {
  const money = useMemo(() => moneyIn(radar.currency), [radar.currency]);
  const { totals: t } = radar;
  const empty = !radar.retiring.length && !radar.retired.length;

  return (
    <div className="space-y-8">
      <PageHeader title="Retirement Radar">
        <p>Retirement dates and retail prices from Brickset. Growth is worked out from the BrickLink sold prices Brickfolio stored at each sync.</p>
      </PageHeader>

      {empty ? (
        <EmptyState title={hasBrickset ? 'No retirement dates yet' : 'Add a Brickset key to see retirement dates'}>
          {hasBrickset
            ? 'Brickset fills in retirement dates at the next sync. Sets it has no date for stay off the Radar.'
            : <>Set <code>BRICKSET_API_KEY</code> on the server (see <Link href="/settings" className="text-link underline">Settings → Brickset</Link>). Brickfolio then fills in each set’s retail price and expected retirement date in the daily sync.</>}
        </EmptyState>
      ) : (
        <>
          <section aria-label="Summary" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Retiring within 6 months" value={String(t.retiringSoon)} note={t.wishesRetiringSoon ? `${t.wishesRetiringSoon} on your wishlist` : 'Owned and wished'} />
            <Stat label="Retired sets you own" value={String(t.retiredOwned)} note={`Est. Value ${money(t.retiredValue)}`} />
            <Stat label="Median growth since retiring" value={t.medianGrowth == null ? '—' : `${pct(t.medianGrowth)}/yr`} note="Per year, over retired sets with a starting price" />
            <Stat label="Designer Program · SMART Play" value={`${t.flagged.designer} · ${t.flagged.smart}`} note="Sets and wishes in these lines" />
          </section>

          <section aria-labelledby="r-soon" className="space-y-4">
            <h2 id="r-soon" className="text-xl font-extrabold tracking-tight">Retiring</h2>
            {radar.retiring.length === 0 ? (
              <p className="text-sm text-fg-3">Nothing you own or want has an expected retirement date.</p>
            ) : radar.retiring.map((g) => (
              <div key={g.month}>
                <h3 className="text-sm font-semibold text-fg-3">{monthLabel(g.month)}</h3>
                <ul className="mt-2 divide-y divide-line border-y border-line">
                  {g.items.map((i) => <Row key={`${i.kind}-${i.setNo}`} i={i} money={money} today={radar.today} />)}
                </ul>
              </div>
            ))}
          </section>

          <section aria-labelledby="r-retired" className="space-y-3">
            <h2 id="r-retired" className="text-xl font-extrabold tracking-tight">Retired sets you own</h2>
            {radar.retired.length === 0 ? (
              <p className="text-sm text-fg-3">None of your sets have retired yet, as far as Brickset knows.</p>
            ) : (
              <ul className="divide-y divide-line border-y border-line">
                {radar.retired.map((i) => <Row key={i.setNo} i={i} money={money} today={radar.today} />)}
              </ul>
            )}
          </section>
        </>
      )}

      <DesignerSection projects={projects} money={money} />
    </div>
  );
}

function Row({ i, money, today }: { i: RadarItem; money: Money; today: string }) {
  const href = i.kind === 'set' ? `/sets/${encodeURIComponent(displayNo(i.setNo))}` : '/wishlist';
  const days = i.exitDate ? daysUntil(i.exitDate, today) : null;
  const g = i.growth;
  return (
    <li className="grid grid-cols-[3rem_minmax(0,1fr)_auto] items-center gap-x-4 py-3">
      <span className="relative size-12 overflow-hidden rounded-chip bg-tile">
        {i.imageUrl && <Image src={i.imageUrl} alt="" fill sizes="48px" className="object-contain p-1 mix-blend-multiply" />}
      </span>
      <span className="min-w-0">
        <Link href={href} className="block truncate font-semibold hover:text-link">
          <span className="tabular-nums text-fg-3">{displayNo(i.setNo)}</span> {i.name}
        </Link>
        <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-fg-3">
          {i.kind === 'wish' ? <Chip tone="primary">Wishlist</Chip> : i.qty > 1 && <span>{i.qty} copies ·</span>}
          {i.flags.map((f) => <Chip key={f} tone="info">{FLAG_LABEL[f]}</Chip>)}
          {i.status === 'retired'
            ? <span>Retired{i.exitDate ? ` ${i.exitDate}` : ''}</span>
            : days != null && <span className={cx(days <= 60 && 'font-semibold text-warn')}>Retires {i.exitDate} · in {days} day{days === 1 ? '' : 's'}</span>}
          {i.retailPrice != null && <span>· Retail {moneyIn(i.retailCurrency ?? 'USD')(i.retailPrice)}</span>}
        </span>
      </span>
      <span className="text-right">
        <span className="block font-extrabold tabular-nums [font-stretch:112%]">{money(i.value)}</span>
        {g ? (
          <span
            className={cx('block text-xs font-semibold tabular-nums', g.perYear >= 0 ? 'text-ok' : 'text-danger')}
            title={`${money(g.from)} on ${g.fromDate} (${g.basis === 'retail' ? 'retail price, Brickset' : 'stored BrickLink sold price'}) → ${money(g.to)} now, over ${g.years} years.${g.thin ? ' From your own price history, which is still short.' : ''}`}
          >
            {pct(g.perYear)}/yr{g.thin ? '*' : ''}
          </span>
        ) : i.gainPct != null && (
          <span className={cx('block text-xs font-semibold tabular-nums', i.gainPct >= 0 ? 'text-ok' : 'text-danger')} title="Against retail (Brickset)">{pct(i.gainPct)} vs retail</span>
        )}
      </span>
    </li>
  );
}
