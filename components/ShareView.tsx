'use client';
/* eslint-disable @next/next/no-img-element -- photos come from the share link's own image route, which next/image can't fetch */
import { useMemo, useState } from 'react';
import type { SharedCollection } from '@/lib/service/share';
import { displayNo, money as fmt, num } from '@/lib/sets';
import { CONDITION_TONE, Callout, Chip, EmptyState, SearchInput, Select } from './ui';

const blSet = (no: string) => `https://www.bricklink.com/v2/catalog/catalogitem.page?S=${encodeURIComponent(no)}`;

/** The shared collection: totals, sets with search and a theme filter, and minifigures when the link includes them. */
export default function ShareView({ data }: { data: SharedCollection }) {
  const [q, setQ] = useState('');
  const [theme, setTheme] = useState('');
  const money = (v: unknown) => fmt(v, data.currency ?? 'USD');
  const themes = useMemo(() => [...new Set(data.sets.map((s) => s.theme).filter((t): t is string => !!t))].sort(), [data.sets]);
  const needle = q.trim().toLowerCase();
  const sets = data.sets.filter((s) =>
    (!theme || s.theme === theme) &&
    (!needle || [s.setNo, s.name, s.theme, s.subtheme, s.year].some((v) => String(v ?? '').toLowerCase().includes(needle))));
  const figs = data.minifigs.filter((f) => !needle || [f.figNo, f.name].some((v) => String(v ?? '').toLowerCase().includes(needle)));
  const t = data.totals;

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-fg-3">Shared collection</p>
        <h1 className="text-3xl font-extrabold tracking-tight [font-stretch:110%]">{data.name}</h1>
        <p className="mt-1 text-sm text-fg-3 tabular-nums">
          {t.sets} sets · {t.copies} copies · {num(t.pieces).toLocaleString()} pieces{t.minifigs ? ` · ${t.minifigs} minifigures` : ''}
        </p>
        {t.estValue !== undefined && (
          <p className="mt-2"><span className="text-sm text-fg-3">Est. Value </span><span className="text-3xl font-extrabold tabular-nums [font-stretch:112%]">{money(t.estValue)}</span></p>
        )}
      </div>

      <div className="flex flex-wrap gap-3">
        <SearchInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, set #, theme…" aria-label="Search the collection" />
        {themes.length > 1 && <Select label="Theme" value={theme} onChange={(e) => setTheme(e.target.value)} options={[['', 'All themes'], ...themes.map((x) => [x, x])]} />}
      </div>

      {sets.length === 0 ? <EmptyState title="No sets match" /> : (
        <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {sets.map((s) => (
            <li key={s.setNo} className="flex flex-col gap-2">
              <div className="relative h-40 overflow-hidden rounded-card bg-tile">
                {s.image
                  ? <img src={s.image} alt="" loading="lazy" className="absolute inset-0 size-full object-contain p-4 mix-blend-multiply" />
                  : <span className="absolute inset-0 flex items-center justify-center text-sm text-tile-ink/75">No photo</span>}
              </div>
              <div className="flex items-center justify-between gap-2">
                <a href={blSet(s.setNo)} target="_blank" rel="noreferrer noopener" className="text-sm font-bold tabular-nums text-fg-3 hover:text-link">#{displayNo(s.setNo)}</a>
                {s.condition && <Chip tone={CONDITION_TONE[s.condition] ?? 'neutral'}>{s.condition}</Chip>}
              </div>
              <h2 className="line-clamp-2 text-lg font-extrabold leading-tight [font-stretch:110%]">{s.name}</h2>
              <p className="text-xs text-fg-3">
                {[s.subtheme ? `${s.theme} › ${s.subtheme}` : s.theme, s.year, s.pieces ? `${num(s.pieces).toLocaleString()} pcs` : null, s.minifigs ? `${s.minifigs} minifig${s.minifigs === 1 ? '' : 's'}` : null].filter(Boolean).join(' · ')}
              </p>
              <Callout className="flex items-end justify-between gap-3 px-3 py-2 text-sm">
                <span><b className="tabular-nums">{s.qty}x</b> <span className="text-xs text-fg-3">{s.copies}</span></span>
                {s.estValue !== undefined && <b className="tabular-nums">{money(s.estValue)}</b>}
              </Callout>
              {s.location !== undefined && s.location && <p className="text-xs text-fg-3">{s.location}</p>}
              {s.notes && <p className="whitespace-pre-line text-xs text-fg-2">{s.notes}</p>}
            </li>
          ))}
        </ul>
      )}

      {data.options.minifigs && data.minifigs.length > 0 && (
        <section aria-labelledby="figs-title" className="space-y-3">
          <h2 id="figs-title" className="text-xl font-extrabold [font-stretch:110%]">Minifigures</h2>
          <Callout className="divide-y divide-line">
            {figs.map((f, i) => (
              <div key={`${f.figNo ?? f.name}-${i}`} className="flex items-center gap-3 px-3 py-2 text-sm">
                <span className="relative size-10 shrink-0 overflow-hidden rounded-chip bg-tile">
                  {f.image && <img src={f.image} alt="" loading="lazy" className="absolute inset-0 size-full object-contain mix-blend-multiply" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{f.name}</span>
                  <span className="text-xs text-fg-3">{[f.figNo, f.year, f.condition, f.location, f.notes].filter(Boolean).join(' · ')}</span>
                </span>
                <span className="tabular-nums">{f.qty}x</span>
                {f.estValue !== undefined && <span className="w-20 text-right font-semibold tabular-nums">{money(f.estValue)}</span>}
              </div>
            ))}
          </Callout>
        </section>
      )}
    </div>
  );
}
