'use client';
import Image from 'next/image';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Download, ExternalLink } from 'lucide-react';
import type { BuildMatch } from '@/lib/service/builds';
import { displayNo } from '@/lib/sets';
import { PageHeader } from './shell/PageHeader';
import { EmptyState, FilterChip, buttonClass } from './ui';

type Filter = 'all' | 'ready' | 'close';
const FILTERS: [Filter, string][] = [['all', 'All'], ['ready', 'Ready to build'], ['close', '90% or more']];

/** Alternate builds of the sets you own, ranked by how much of each you already have. */
export default function BuildView({ builds, hasKey, hasParts }: { builds: BuildMatch[]; hasKey: boolean; hasParts: boolean }) {
  const [filter, setFilter] = useState<Filter>('all');
  const known = builds.filter((b) => b.partsKnown);
  const shown = useMemo(() => known.filter((b) => (filter === 'ready' ? b.pct === 100 : filter === 'close' ? b.pct >= 90 : true)), [known, filter]);
  const unavailable = builds.filter((b) => b.partsUnavailable);
  const waiting = builds.length - known.length - unavailable.length;

  return (
    <div className="space-y-6">
      <PageHeader title="What can I build?" badge={known.length ? <span className="text-sm text-fg-3 tabular-nums">{known.length} builds</span> : undefined}>
        <p>Alternate builds of the sets you own, from Rebrickable, matched against every part in your sets’ parts lists.</p>
      </PageHeader>

      {!hasKey ? (
        <EmptyState title="Needs a Rebrickable key">
          Set <code className="rounded-chip bg-muted px-1">REBRICKABLE_API_KEY</code> (free from your Rebrickable account) and the daily sync starts finding builds for your sets.
        </EmptyState>
      ) : !hasParts ? (
        <EmptyState title="No parts lists yet">
          Matching needs your sets’ parts lists. They come from BrickLink with each sync, or import the Parts tab in Settings.
        </EmptyState>
      ) : builds.length === 0 ? (
        <EmptyState title="Nothing found yet">Each sync looks up a few of your sets on Rebrickable. Builds appear here as they’re found.</EmptyState>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            {FILTERS.map(([f, label]) => (
              <FilterChip key={f} active={filter === f} onClick={() => setFilter(f)}>{label}</FilterChip>
            ))}
            {waiting > 0 && <span className="text-sm text-fg-3">{waiting} more waiting for their parts lists (next sync).</span>}
          </div>
          {unavailable.length > 0 && (
            <details className="text-sm text-fg-3">
              <summary className="cursor-pointer">
                {unavailable.length} {unavailable.length === 1 ? 'build has' : 'builds have'} no parts list Rebrickable shares, so {unavailable.length === 1 ? 'it' : 'they'} can’t be matched. Designers can keep a parts list private or sell it with the instructions.
              </summary>
              <ul className="mt-2 grid gap-1 sm:grid-cols-2">
                {unavailable.map((b) => (
                  <li key={b.mocNo} className="truncate">
                    {b.url ? <a href={b.url} target="_blank" rel="noreferrer" className="text-link hover:underline">{b.name}</a> : b.name}
                    <span> · {displayNo(b.sourceSetNo)}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
          {shown.length === 0 ? (
            <EmptyState title="No builds match">Try another filter.</EmptyState>
          ) : (
            <ul className="divide-y divide-line border-y border-line">
              {shown.map((b) => (
                <li key={b.mocNo} className="grid grid-cols-[5.5rem_minmax(0,1fr)] items-center gap-x-4 gap-y-2 py-4 sm:grid-cols-[6rem_4rem_minmax(0,1fr)_auto]">
                  <span className="text-2xl font-extrabold tracking-tight tabular-nums [font-stretch:115%] sm:text-3xl">{b.pct}%</span>
                  <span className="relative hidden size-16 overflow-hidden rounded-chip bg-tile sm:block">
                    {b.imageUrl && <Image src={b.imageUrl} alt="" fill sizes="64px" className="object-cover" />}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">{b.name}</span>
                    <span className="block text-xs text-fg-3">
                      Alternate build of <Link href={`/sets/${encodeURIComponent(displayNo(b.sourceSetNo))}`} className="font-semibold text-link hover:underline">{displayNo(b.sourceSetNo)}</Link>
                      {b.designer ? ` · by ${b.designer}` : ''} · {b.need.toLocaleString()} pcs
                    </span>
                    <span className={`mt-0.5 block text-xs ${b.missingPieces ? 'text-fg-2' : 'font-semibold text-ok'}`}>
                      {b.missingPieces ? `${b.missingPieces.toLocaleString()} ${b.missingPieces === 1 ? 'piece' : 'pieces'} missing in ${b.missingLots} ${b.missingLots === 1 ? 'lot' : 'lots'}` : 'You have every part'}
                      {b.unmapped ? ` · ${b.unmapped} ${b.unmapped === 1 ? 'lot' : 'lots'} without a BrickLink match` : ''}
                    </span>
                  </span>
                  <span className="col-span-2 flex flex-wrap items-center justify-end gap-1 sm:col-span-1">
                    {b.missingPieces > 0 && (
                      <a href={`/api/v1/builds/${encodeURIComponent(b.mocNo)}/wanted.xml`} className={buttonClass('secondary', 'sm')} title="Upload this in BrickLink under Wanted → Upload">
                        <Download aria-hidden className="size-4" />Wanted List
                      </a>
                    )}
                    {b.url && (
                      <a href={b.url} target="_blank" rel="noreferrer" className={buttonClass('ghost', 'sm')}>
                        <ExternalLink aria-hidden className="size-4" />Rebrickable
                      </a>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-fg-3">Builds and part lists from Rebrickable. Spare parts and alternates in your sets aren’t counted.</p>
        </>
      )}
    </div>
  );
}
