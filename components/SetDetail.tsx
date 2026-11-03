'use client';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import { Copy, Download, ExternalLink, ListX, Pencil, RefreshCw } from 'lucide-react';
import { editSet, refreshPartsFor, relookupSet, removeSet, priceSetParts, saveMissingParts, type Result } from '@/app/actions';
import type { BuildMatch } from '@/lib/service/builds';
import type { MissingSummary } from '@/lib/service/missing';
import type { Partout } from '@/lib/service/partout';
import { partKey } from '@/lib/bricklink/wanted';
import type { PartRow } from '@/lib/service/parts';
import { displayNo, num, type SetRow } from '@/lib/sets';
import { ModelViewer } from './ModelViewer';
import { PartList } from './board/PartsDialog';
import { RemoveButton, RetireChip } from './board/SetCard';
import { retailGain, retirement } from '@/lib/retail';
import { SetForm } from './board/SetForm';
import { blLink, moneyIn } from './board/ui';
import { Banner, Button, Callout, CONDITION_TONE, Chip, EmptyState, FilterChip, buttonClass, cx } from './ui';

type Props = { set: SetRow; parts: PartRow[]; prices: { date: string; avgSold: number | null }[]; currency: string; locations: string[]; priced: boolean; model: { fileName: string; author: string | null } | null; library: boolean; builds: BuildMatch[]; view?: '3d'; missing: MissingSummary; partout: (Partout & { unpriced: number }) | null; partsPriced: boolean };

/** One set: its photo, value and price history, parts list and copies. */
export default function SetDetail({ set: s, parts, prices, currency, locations, priced, model, library, builds, view, missing, partout, partsPriced }: Props) {
  const router = useRouter();
  const money = useMemo(() => moneyIn(currency), [currency]);
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [pending, start] = useTransition();
  const act = (fn: () => Promise<Result>, ok: string, after?: () => void) =>
    start(async () => {
      const r = await fn();
      setMessage(r.ok ? { kind: 'ok', text: ok } : { kind: 'error', text: r.error });
      if (r.ok) after?.();
    });

  const theme = s.theme ? (s.subtheme ? `${s.theme} › ${s.subtheme}` : s.theme) : null;
  const gain = retailGain(s, currency);
  const ret = retirement(s);
  const regular = parts.filter((p) => !p.alternate);
  const saved = useMemo(() => Object.fromEntries(missing.items.map((i) => [partKey(i.type, i.partNo, i.colorId), i.qty])), [missing.items]);
  const [marking, setMarking] = useState(false);
  const [draft, setDraft] = useState<Record<string, number>>(saved);
  const [missingOnly, setMissingOnly] = useState(false);
  const shownMissing = marking ? draft : saved;
  const listed = missingOnly && !marking ? regular.filter((p) => (saved[partKey(p.type, p.partNo, p.colorId)] ?? 0) > 0) : regular;
  const saveMarks = () => act(
    () => saveMissingParts(s.setNo, regular.flatMap((p) => { const q = draft[partKey(p.type, p.partNo, p.colorId)] ?? 0; return q ? [{ partNo: p.partNo, colorId: p.colorId, type: p.type, qty: q }] : []; })),
    'Missing parts saved. Missing % and Est. Value now follow them.',
    () => setMarking(false),
  );
  const wantedUrl = `/api/v1/sets/${encodeURIComponent(displayNo(s.setNo))}/missing/wanted.xml`;
  const copyWanted = () => start(async () => {
    try {
      const res = await fetch(wantedUrl);
      if (!res.ok) throw new Error(`The server answered ${res.status}.`);
      await navigator.clipboard.writeText(await res.text());
      setMessage({ kind: 'ok', text: 'Wanted List XML copied. On BrickLink: Want → Upload → paste.' });
    } catch (e) {
      setMessage({ kind: 'error', text: `Couldn't copy the Wanted List: ${e instanceof Error ? e.message : String(e)}` });
    }
  });
  const alternates = parts.filter((p) => p.alternate);
  const remove = () => act(() => removeSet(s.setNo), s.qty > 1 ? `Removed one copy. ${s.qty - 1} left.` : `Removed ${s.name}.`, () => { if (s.qty <= 1) router.push('/'); });

  return (
    <div className="space-y-8">
      <nav aria-label="Breadcrumb" className="flex gap-1.5 text-sm text-fg-3">
        <Link href="/" className="text-link hover:underline">Sets</Link><span aria-hidden>/</span><span className="text-fg">{displayNo(s.setNo)}</span>
      </nav>

      {message && <Banner kind={message.kind} onDismiss={() => setMessage(null)}>{message.text}</Banner>}
      {s.blError && (
        <Banner kind="error">
          {s.blError}{' '}
          {priced && <Button variant="danger-link" className="underline" disabled={pending} onClick={() => act(() => relookupSet(s.setNo), 'Lookup worked.')}>Retry lookup</Button>}
        </Banner>
      )}

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:gap-10">
        <ModelViewer
          setNo={s.setNo}
          initialView={view}
          model={model}
          library={library}
          photo={
            <div className="relative h-72 overflow-hidden rounded-card bg-tile sm:h-[26rem]">
              {s.imageUrl ? (
                <Image src={s.imageUrl} alt={s.name} fill priority sizes="(min-width: 1024px) 600px, 100vw" className="object-contain p-6 mix-blend-multiply" />
              ) : (
                <span className="absolute inset-0 flex items-center justify-center text-sm text-tile-ink/75">No photo yet</span>
              )}
            </div>
          }
        />

        <section className="space-y-6">
          <div>
            <div className="flex items-center justify-between gap-3">
              <p className="text-lg font-bold tabular-nums text-fg-3">#{displayNo(s.setNo)}</p>
              <span className="flex items-center gap-1">
                {ret && <RetireChip ret={ret} />}
                {s.condition && <Chip tone={CONDITION_TONE[s.condition] ?? 'neutral'}>{s.condition}</Chip>}
              </span>
            </div>
            <h1 className="mt-1 text-4xl font-extrabold leading-tight tracking-tight [font-stretch:110%]">{s.name}</h1>
            <p className="mt-1 text-sm text-fg-3">
              {[theme, s.year, s.pieces ? `${num(s.pieces).toLocaleString()} pieces` : null, s.minifigs ? `${s.minifigs} minifig${s.minifigs === 1 ? '' : 's'}` : null, s.location ? `on ${s.location}` : 'no location'].filter(Boolean).join(' · ')}
            </p>
            {s.blName && s.blName !== s.name && <p className="mt-1 text-xs italic text-fg-3">BrickLink calls it {s.blName}</p>}
          </div>

          <Callout className="px-4 pt-3.5 pb-3">
            <div className="flex items-end justify-between gap-3">
              <p className="text-3xl font-extrabold leading-none tabular-nums [font-stretch:112%]" title={`${s.qty} ${s.qty === 1 ? 'copy' : 'copies'}`}>{s.qty}x</p>
              <div className="text-right">
                <p className="text-xs text-fg-3">Est. Value{s.qty > 1 ? ' each' : ''}</p>
                <p className="text-3xl font-extrabold tracking-tight tabular-nums [font-stretch:112%]">{money(s.estValue)}</p>
              </div>
            </div>
            <PriceHistory prices={prices} money={money} />
            <dl className="mt-3 grid grid-cols-3 gap-2 border-t border-line pt-2 text-sm tabular-nums">
              <div><dt className="text-xs text-fg-3">Low</dt><dd className="font-semibold">{money(s.minSold)}</dd></div>
              <div><dt className="text-xs text-fg-3">Average</dt><dd className="font-semibold">{money(s.avgSold)}</dd></div>
              <div><dt className="text-xs text-fg-3">High</dt><dd className="font-semibold">{money(s.maxSold)}</dd></div>
            </dl>
            <p className="mt-2 text-xs text-fg-3">
              {s.qtySold ? `BrickLink ${s.condition === 'New' ? 'new' : 'used'} sold prices from ${s.qtySold} recent sales` : 'No recent BrickLink sales'}
              {s.missingPct ? <span className="font-semibold text-warn"> · less {s.missingPct}% missing</span> : null}
              {s.qty > 1 && s.estValue != null ? <> · {money(num(s.estValue) * s.qty)} for all {s.qty}</> : null}
            </p>
            {(s.retailPrice || s.launchDate || s.exitDate) && (
              <dl className="mt-3 grid grid-cols-3 gap-2 border-t border-line pt-2 text-sm tabular-nums">
                <div>
                  <dt className="text-xs text-fg-3">Retail</dt>
                  <dd className="font-semibold">{s.retailPrice ? moneyIn(s.retailCurrency ?? currency)(s.retailPrice) : '—'}</dd>
                </div>
                <div>
                  <dt className="text-xs text-fg-3">vs. retail</dt>
                  <dd className={cx('font-semibold', gain && (gain.gainPct >= 0 ? 'text-ok' : 'text-danger'))}>{gain ? `${gain.gainPct >= 0 ? '+' : '−'}${Math.abs(gain.gainPct)}%` : '—'}</dd>
                </div>
                <div>
                  <dt className="text-xs text-fg-3">{ret?.kind === 'retired' ? 'Retired' : 'Retires'}</dt>
                  <dd className="font-semibold">{s.exitDate ?? '—'}</dd>
                </div>
                <p className="col-span-3 text-xs text-fg-3">
                  Retail price{s.launchDate ? `, released ${s.launchDate}` : ''} and retirement date from Brickset.
                  {s.retailPrice && s.retailCurrency !== currency ? ` Retail is in ${s.retailCurrency}, so no gain is shown.` : ''}
                </p>
              </dl>
            )}
          </Callout>

          {partout && (
            <PartoutCallout
              p={partout} complete={s.avgSold} money={money} canPrice={partsPriced} pending={pending}
              onPrice={() => start(async () => {
                const r = await priceSetParts(s.setNo);
                setMessage(r.ok ? { kind: 'ok', text: r.message ?? 'Pricing parts.' } : { kind: 'error', text: r.error });
              })}
            />
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" icon={Pencil} onClick={() => setEditing(true)}>Edit</Button>
            <a href={blLink(s.setNo)} target="_blank" rel="noreferrer" className={buttonClass('secondary')}><ExternalLink aria-hidden className="size-4" />BrickLink</a>
            <span className="ml-auto"><RemoveButton s={s} onRemove={remove} busy={pending} compact={false} /></span>
          </div>

          {builds.length > 0 && (
            <section aria-labelledby="alt-title">
              <div className="flex items-baseline justify-between gap-3">
                <h2 id="alt-title" className="text-sm font-semibold">Alternate builds</h2>
                <Link href="/build" className="text-sm text-link hover:underline">What can I build?</Link>
              </div>
              <Callout className="mt-2 divide-y divide-line">
                {builds.map((b) => (
                  <a key={b.mocNo} href={b.url ?? '/build'} target={b.url ? '_blank' : undefined} rel="noreferrer" className="flex items-baseline gap-3 px-3 py-2 hover:bg-subtle">
                    <span className="w-14 shrink-0 text-lg font-extrabold tabular-nums [font-stretch:112%]">{b.pct}%</span>
                    <span className="min-w-0 flex-1 truncate text-sm">{b.name}</span>
                    <span className="shrink-0 text-xs text-fg-3">{b.missingPieces ? `${b.missingPieces} missing` : 'all parts'}</span>
                  </a>
                ))}
              </Callout>
            </section>
          )}

          {s.notes && (
            <section aria-label="Notes">
              <h2 className="text-sm font-semibold">Notes</h2>
              <p className="mt-1 whitespace-pre-line text-sm text-fg-2">{s.notes}</p>
            </section>
          )}
        </section>
      </div>

      <section aria-labelledby="parts-title" className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 id="parts-title" className="text-xl font-extrabold [font-stretch:110%]">Parts</h2>
          <p className="text-sm text-fg-3 tabular-nums">
            {parts.length ? `${num(s.pieces).toLocaleString()} pieces in ${regular.length} lots` : ''}
            {priced && !marking && (
              <Button variant="link" className="ml-3" disabled={pending} onClick={() => act(() => refreshPartsFor(s.setNo), 'Parts list updated.')}>
                <RefreshCw aria-hidden className="size-4" />{parts.length ? 'Refresh from BrickLink' : 'Fetch from BrickLink'}
              </Button>
            )}
            {regular.length > 0 && !marking && (
              <Button variant="link" className="ml-3" disabled={pending} onClick={() => { setDraft(saved); setMissingOnly(false); setMarking(true); }}>
                <ListX aria-hidden className="size-4" />Mark missing parts
              </Button>
            )}
          </p>
        </div>
        {marking && (
          <Callout className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
            <p className="mr-auto">Type how many of each part are missing. Missing % and Est. Value will follow, and the set becomes Partial.</p>
            <Button variant="ghost" disabled={pending} onClick={() => { setDraft({}); }}>Clear all</Button>
            <Button disabled={pending} onClick={() => setMarking(false)}>Cancel</Button>
            <Button variant="primary" loading={pending} onClick={saveMarks}>Save missing parts</Button>
          </Callout>
        )}
        {!marking && missing.lots > 0 && (
          <Callout className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 text-sm">
            <p className="mr-auto">
              <b className="tabular-nums">{missing.pieces.toLocaleString()}</b> piece{missing.pieces === 1 ? '' : 's'} in <b className="tabular-nums">{missing.lots}</b> lot{missing.lots === 1 ? '' : 's'} missing
              {missing.pct !== null && <> (<span className="tabular-nums">{missing.pct}%</span>)</>}, so Est. Value is lowered to match.
            </p>
            <FilterChip active={missingOnly} onClick={() => setMissingOnly(!missingOnly)}>Missing only</FilterChip>
            <a href={wantedUrl} download className={buttonClass('secondary', 'sm')}><Download aria-hidden className="size-4" />Wanted List</a>
            <Button size="sm" icon={Copy} disabled={pending} onClick={copyWanted}>Copy XML</Button>
          </Callout>
        )}
        {parts.length === 0 ? (
          <EmptyState title="No parts list yet">
            {priced ? 'Fetch it from BrickLink, or import the Parts tab in Settings.' : 'Import the Parts tab in Settings, or add BrickLink keys to fetch it.'}
          </EmptyState>
        ) : (
          <Callout className="overflow-hidden">
            <PartList parts={listed} missing={shownMissing} editing={marking} onMissing={(p, q) => setDraft((d) => ({ ...d, [partKey(p.type, p.partNo, p.colorId)]: q }))} />
            {alternates.length > 0 && (
              <>
                <h3 className="border-t border-line bg-subtle px-4 py-2 text-sm font-semibold text-fg-2">Alternates (not counted)</h3>
                <PartList parts={alternates} />
              </>
            )}
          </Callout>
        )}
      </section>

      {editing && (
        <SetForm
          set={s}
          locations={locations}
          pending={pending}
          dupe={null}
          money={money}
          onClose={() => setEditing(false)}
          onAddAnother={() => {}}
          onSubmit={(form) => act(() => editSet(form), 'Saved.', () => setEditing(false))}
        />
      )}
    </div>
  );
}

/** Avg sold per sync for this set, from the saved price snapshots. A note until there are two. */
function PriceHistory({ prices, money }: { prices: { date: string; avgSold: number | null }[]; money: (v: unknown) => string }) {
  const p = prices.filter((x): x is { date: string; avgSold: number } => x.avgSold !== null);
  if (p.length < 2) return <p className="mt-3 text-xs text-fg-3">Price history fills in with each daily sync.</p>;
  const W = 400, H = 64, v = p.map((x) => x.avgSold), lo = Math.min(...v), hi = Math.max(...v);
  const pts = v.map((y, i) => `${(i / (v.length - 1)) * W},${hi === lo ? H / 2 : 4 + (1 - (y - lo) / (hi - lo)) * (H - 8)}`).join(' ');
  const change = v[v.length - 1] - v[0];
  return (
    <figure className="mt-3">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-16 w-full" role="img" aria-label={`Average sold from ${money(v[0])} on ${p[0].date} to ${money(v[v.length - 1])}`}>
        <polygon points={`0,${H} ${pts} ${W},${H}`} fill="var(--primary)" fillOpacity={0.22} />
        <polyline points={pts} fill="none" stroke="var(--outline)" strokeWidth={2} vectorEffect="non-scaling-stroke" />
      </svg>
      <figcaption className="mt-1 flex justify-between text-xs text-fg-3">
        <span>Average sold since {p[0].date}</span>
        <span className={change >= 0 ? 'font-semibold text-ok' : 'font-semibold text-danger'}>{change >= 0 ? '+' : '−'}{money(Math.abs(change))}</span>
      </figcaption>
    </figure>
  );
}

/** Part-out vs. complete: what the set fetches as separate parts, from BrickLink part prices, next to its sold price. */
function PartoutCallout({ p, complete, money, canPrice, pending, onPrice }: { p: Partout & { unpriced: number }; complete: number | null; money: (v: unknown) => string; canPrice: boolean; pending: boolean; onPrice: () => void }) {
  const days = p.ageDays;
  const ratio = complete && p.value && p.coverage >= 50 ? Math.round((p.value / complete) * 100) / 100 : null;
  const guide = p.guide === 'N' ? 'new' : 'used';
  return (
    <Callout className="px-4 py-3 text-sm">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-xs text-fg-3">Part-out value ({guide})</p>
          <p className="text-2xl font-extrabold tracking-tight tabular-nums [font-stretch:112%]">{p.pricedLots ? money(p.value) : '—'}</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-fg-3">Complete ({guide})</p>
          <p className="text-2xl font-extrabold tracking-tight tabular-nums [font-stretch:112%]">{money(complete)}</p>
        </div>
      </div>
      {ratio !== null && (
        <p className={cx('mt-1 font-semibold', ratio >= 1 ? 'text-ok' : 'text-fg-2')}>
          {ratio >= 1 ? `Worth ${ratio}× more as parts` : `Parts fetch ${Math.round(ratio * 100)}% of the complete price`}
        </p>
      )}
      <p className="mt-2 text-xs text-fg-3">
        {p.pricedLots
          ? <>BrickLink {guide} part prices for {p.coverage}% of the pieces ({p.pricedLots} of {p.lots} lots){days === 0 ? ', fetched today' : days !== null ? `, up to ${days} day${days === 1 ? '' : 's'} old` : ''}. Lots with no recent sales count as $0.</>
          : <>No part prices yet. The daily sync prices parts with BrickLink calls it has left over, most valuable sets first.</>}
        {p.missingPctByValue !== null && <> Missing % is weighted by these prices.</>}
      </p>
      {canPrice && p.unpriced > 0 && (
        <Button size="sm" className="mt-2" loading={pending} onClick={onPrice}>Price {p.unpriced} part{p.unpriced === 1 ? '' : 's'} now</Button>
      )}
    </Callout>
  );
}
