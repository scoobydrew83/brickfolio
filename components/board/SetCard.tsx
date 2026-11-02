import Image from 'next/image';
import Link from 'next/link';
import { useState } from 'react';
import { ExternalLink, Pencil, Puzzle, Trash2 } from 'lucide-react';
import { displayNo, num, type SetRow } from '@/lib/sets';
import { blLink, type Money } from './ui';
import { Button, Callout, CONDITION_TONE, Chip, IconButton, buttonClass, cx } from '../ui';

export type RowActions = { onEdit: (s: SetRow) => void; onParts: (s: SetRow) => void; onRemove: (s: SetRow) => void; onRetry: (s: SetRow) => void; pending: boolean; money: Money };

export function SetCard({ s, onEdit, onParts, onRemove, onRetry, pending, money }: { s: SetRow } & RowActions) {
  const theme = s.theme ? (s.subtheme ? `${s.theme} › ${s.subtheme}` : s.theme) : null;
  return (
    <article className="flex flex-col gap-3">
      <div className="relative h-36 overflow-hidden rounded-card bg-tile sm:h-44">
        {s.imageUrl ? (
          <Image src={s.imageUrl} alt="" fill sizes="(min-width: 1280px) 300px, (min-width: 640px) 45vw, 90vw" className="object-contain p-4 mix-blend-multiply" />
        ) : (
          <span className="absolute inset-0 flex items-center justify-center text-sm text-fg-3">No photo yet</span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-3 px-1">
        <div>
          <div className="flex items-baseline justify-between gap-2">
            <Link href={`/sets/${encodeURIComponent(displayNo(s.setNo))}`} className="rounded-chip text-3xl font-extrabold leading-none tracking-tight tabular-nums [font-stretch:115%] hover:text-link">
              {displayNo(s.setNo)}
            </Link>
            {s.condition && <Chip tone={CONDITION_TONE[s.condition] ?? 'neutral'}>{s.condition}</Chip>}
          </div>
          <h2 className="mt-1.5 text-base font-semibold leading-snug">
            <Link href={`/sets/${encodeURIComponent(displayNo(s.setNo))}`} className="hover:text-link hover:underline">{s.name}</Link>
          </h2>
          <p className="mt-0.5 text-xs text-fg-3">
            {[theme, s.year, s.pieces ? `${num(s.pieces).toLocaleString()} pcs` : null, s.minifigs ? `${s.minifigs} minifig${s.minifigs === 1 ? '' : 's'}` : null].filter(Boolean).join(' · ')}
          </p>
          {s.blName && s.blName !== s.name && <p className="text-xs italic text-fg-3">BrickLink calls it {s.blName}</p>}
        </div>
        {s.blError && (
          <div role="alert" className="flex items-start justify-between gap-2 rounded-control bg-danger-soft px-2 py-1 text-xs text-danger">
            <span>{s.blError}</span>
            <Button variant="danger-link" onClick={() => onRetry(s)} disabled={pending} className="shrink-0 text-xs font-semibold underline">Retry lookup</Button>
          </div>
        )}

        <Callout className="px-3 pt-2.5 pb-2">
          <div className="flex items-end justify-between gap-3">
            <p className="text-2xl font-extrabold leading-none tabular-nums [font-stretch:112%]" title={`${s.qty} ${s.qty === 1 ? 'copy' : 'copies'}`}>
              {s.qty}x
            </p>
            <div className="text-right">
              <p className="text-xs text-fg-3">Est. Value{s.qty > 1 ? ' each' : ''}</p>
              <p className="text-2xl font-extrabold leading-tight tracking-tight tabular-nums [font-stretch:112%]">{money(s.estValue)}</p>
            </div>
          </div>
          <dl className="mt-2 grid grid-cols-3 gap-1 border-t border-line pt-1.5 text-xs tabular-nums">
            <div><dt className="text-fg-3">Low</dt><dd className="font-semibold">{money(s.minSold)}</dd></div>
            <div><dt className="text-fg-3">Average</dt><dd className="font-semibold">{money(s.avgSold)}</dd></div>
            <div><dt className="text-fg-3">High</dt><dd className="font-semibold">{money(s.maxSold)}</dd></div>
          </dl>
          <p className="mt-1 text-xs text-fg-3">
            {s.qtySold ? `From ${s.qtySold} recent BrickLink sales` : 'No recent BrickLink sales'}
            {s.missingPct ? <span className="font-semibold text-warn"> · {s.missingPct}% missing</span> : null}
          </p>
        </Callout>

        <div className="mt-auto flex items-center gap-0.5 text-sm">
          <span className="mr-auto truncate text-xs text-fg-3" title="Location">{s.location || 'No location'}</span>
          <a href={blLink(s.setNo)} target="_blank" rel="noreferrer" aria-label="Open on BrickLink" title="Open on BrickLink" className={cx(buttonClass('ghost', 'sm'), 'size-8 px-0')}><ExternalLink aria-hidden className="size-4" /></a>
          <IconButton icon={Puzzle} label="Parts list" onClick={() => onParts(s)} />
          <IconButton icon={Pencil} label="Edit" onClick={() => onEdit(s)} />
          <RemoveButton s={s} onRemove={() => onRemove(s)} busy={pending} />
        </div>
      </div>
    </article>
  );
}

/** Two-step remove. With several copies it removes one. */
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
