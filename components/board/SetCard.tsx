import Image from 'next/image';
import Link from 'next/link';
import { useState } from 'react';
import { Box, ExternalLink, Pencil, Puzzle, Trash2 } from 'lucide-react';
import { copiesSummary, displayNo, num, type SetRow } from '@/lib/sets';
import { retailGain, retirement } from '@/lib/retail';
import { blLink, type Money } from './ui';
import { Button, Callout, CONDITION_TONE, Chip, IconButton, buttonClass, cx } from '../ui';

export type RowActions = { onEdit: (s: SetRow) => void; onParts: (s: SetRow) => void; onRemove: (s: SetRow) => void; onRetry: (s: SetRow) => void; pending: boolean; money: Money; currency: string };

export function SetCard({ s, onEdit, onParts, onRemove, onRetry, pending, money, currency }: { s: SetRow } & RowActions) {
  const theme = s.theme ? (s.subtheme ? `${s.theme} › ${s.subtheme}` : s.theme) : null;
  const href = `/sets/${encodeURIComponent(displayNo(s.setNo))}`;
  const gain = retailGain(s, currency);
  const ret = retirement(s);
  const meta = [theme, s.year, s.pieces ? `${num(s.pieces).toLocaleString()} pcs` : null, s.minifigs ? `${s.minifigs} minifig${s.minifigs === 1 ? '' : 's'}` : null].filter(Boolean).join(' · ');
  return (
    <article className="flex h-full flex-col gap-3">
      <div className="relative h-36 overflow-hidden rounded-card bg-tile sm:h-44">
        {s.hasModel && (
          <Link href={`${href}?view=3d`} aria-label="Has a 3D model: open it" title="Has a 3D model" className="absolute top-2 left-2 z-10 inline-flex items-center gap-1 rounded-chip border border-outline bg-surface px-1.5 py-0.5 text-xs font-bold text-fg hover:bg-primary hover:text-on-primary">
            <Box aria-hidden className="size-3.5" />3D
          </Link>
        )}
        {s.imageUrl ? (
          <Image src={s.imageUrl} alt="" fill sizes="(min-width: 1280px) 300px, (min-width: 640px) 45vw, 90vw" className="object-contain p-4 mix-blend-multiply" />
        ) : (
          <span className="absolute inset-0 flex items-center justify-center text-sm text-fg-3">No photo yet</span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-3 px-1">
        <div>
          <div className="flex items-center justify-between gap-2">
            <Link href={href} className="rounded-chip text-sm font-bold tabular-nums text-fg-3 hover:text-link">#{displayNo(s.setNo)}</Link>
            <span className="flex items-center gap-1">
              {ret && <RetireChip ret={ret} />}
              {s.condition ? <Chip tone={CONDITION_TONE[s.condition] ?? 'neutral'}>{s.condition}</Chip> : s.mixed.condition ? <Chip>Mixed</Chip> : null}
            </span>
          </div>
          {/* Two lines reserved for the name on multi-column layouts, so cards in a row line up. */}
          <h2 className="mt-1 line-clamp-2 sm:min-h-[2lh] text-xl font-extrabold leading-tight tracking-tight [font-stretch:110%]">
            <Link href={href} title={s.blName && s.blName !== s.name ? `${s.name} (BrickLink: ${s.blName})` : s.name} className="hover:text-link">{s.name}</Link>
          </h2>
          <p className="mt-1 truncate text-xs text-fg-3" title={meta || undefined}>{meta || '\u00a0'}</p>
        </div>
        {s.blError && (
          <div role="alert" className="flex items-start justify-between gap-2 rounded-control bg-danger-soft px-2 py-1 text-xs text-danger">
            <span>{s.blError}</span>
            <Button variant="danger-link" onClick={() => onRetry(s)} disabled={pending} className="shrink-0 text-xs font-semibold underline">Retry lookup</Button>
          </div>
        )}

        <Callout className="mt-auto px-3 pt-2.5 pb-2">
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="text-2xl font-extrabold leading-none tabular-nums [font-stretch:112%]" title={`${s.qty} ${s.qty === 1 ? 'copy' : 'copies'}`}>
                {s.qty}x
              </p>
              <p className="mt-1 text-xs text-fg-3">{copiesSummary(s.copies)}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-fg-3">Est. Value{s.qty > 1 ? ` (${money(s.estValue)} each)` : ''}</p>
              <p className="text-2xl font-extrabold leading-tight tracking-tight tabular-nums [font-stretch:112%]">{money(s.valueTotal)}</p>
            </div>
          </div>
          <dl className="mt-2 grid grid-cols-3 gap-1 border-t border-line pt-1.5 text-xs tabular-nums">
            <div><dt className="text-fg-3">Low</dt><dd className="font-semibold">{money(s.minSold)}</dd></div>
            <div><dt className="text-fg-3">Average</dt><dd className="font-semibold">{money(s.avgSold)}</dd></div>
            <div><dt className="text-fg-3">High</dt><dd className="font-semibold">{money(s.maxSold)}</dd></div>
          </dl>
          <p className="mt-1 text-xs text-fg-3" title={s.qtySold ? `From ${s.qtySold} recent BrickLink sales` : 'No recent BrickLink sales'}>
            {gain
              ? <>Retail {money(gain.retail)} · <b className={gain.gainPct >= 0 ? 'text-ok' : 'text-danger'}>{gain.gainPct >= 0 ? '+' : '−'}{Math.abs(gain.gainPct)}%</b></>
              : s.qtySold ? `From ${s.qtySold} recent BrickLink sales` : 'No recent BrickLink sales'}
            {s.missingPct ? <span className="font-semibold text-warn" title={s.missingMarked ? `From ${s.missingMarked} marked missing piece${s.missingMarked === 1 ? '' : 's'}` : 'Typed in by hand'}> · {s.missingPct}% missing</span> : null}
          </p>
          {s.gain !== null && (
            <p className="text-xs text-fg-3" title={s.costCovered < s.qty ? `Cost known for ${s.costCovered} of ${s.qty} copies` : undefined}>
              Cost {money(s.costBasis)} · <b className={s.gain >= 0 ? 'text-ok' : 'text-danger'}>{s.gain >= 0 ? '+' : '−'}{money(Math.abs(s.gain))}</b>
              {s.costCovered < s.qty ? ` (${s.costCovered} of ${s.qty})` : ''}
            </p>
          )}
        </Callout>

        <div className="flex items-center gap-0.5 text-sm">
          <span className="mr-auto truncate text-xs text-fg-3" title="Location">{locationLabel(s)}</span>
          <a href={blLink(s.setNo)} target="_blank" rel="noreferrer" aria-label="Open on BrickLink" title="Open on BrickLink" className={cx(buttonClass('ghost', 'sm'), 'size-8 px-0')}><ExternalLink aria-hidden className="size-4" /></a>
          <IconButton icon={Puzzle} label="Parts list" onClick={() => onParts(s)} />
          <IconButton icon={Pencil} label="Edit" onClick={() => onEdit(s)} />
          <RemoveButton s={s} onRemove={() => onRemove(s)} busy={pending} />
        </div>
      </div>
    </article>
  );
}

/** The shared location, "2 locations" when copies differ, or "No location". */
export function locationLabel(s: Pick<SetRow, 'location' | 'mixed' | 'copies'>): string {
  if (s.location) return s.location;
  if (!s.mixed.location) return 'No location';
  return `${new Set(s.copies.filter((c) => c.status !== 'parted_out').map((c) => c.location ?? '')).size} locations`;
}

/** Two-step remove. With several copies it removes the newest one. */
export function RemoveButton({ s, onRemove, busy, compact = true }: { s: SetRow; onRemove: () => void; busy: boolean; compact?: boolean }) {
  const [confirming, setConfirming] = useState(false);
  const label = s.qty > 1 ? 'Remove one' : 'Remove';
  if (confirming) {
    return (
      <span className="inline-flex gap-1">
        <Button variant="danger" size="sm" disabled={busy} onClick={() => { setConfirming(false); onRemove(); }}>{label}</Button>
        <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>Cancel</Button>
      </span>
    );
  }
  return compact
    ? <IconButton icon={Trash2} label={label} tone="danger" disabled={busy} onClick={() => setConfirming(true)} />
    : <button type="button" disabled={busy} onClick={() => setConfirming(true)} className="inline-flex items-center text-sm font-medium text-danger hover:underline disabled:opacity-50">{label}</button>;
}

/** "Retiring 2026" or "Retired", from Brickset's dates. */
export function RetireChip({ ret }: { ret: { kind: 'retired' | 'retiring'; date: string | null } }) {
  const year = ret.date?.slice(0, 4);
  return ret.kind === 'retiring'
    ? <Chip tone="warn"><span title={ret.date ? `Expected to retire ${ret.date} (Brickset)` : undefined}>Retiring{year ? ` ${year}` : ''}</span></Chip>
    : <Chip tone="neutral"><span title={ret.date ? `Retired ${ret.date} (Brickset)` : 'Retired (Brickset)'}>Retired</span></Chip>;
}
