import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useState, useTransition } from 'react';
import { RefreshCw } from 'lucide-react';
import { Button, Count, Dialog, EmptyState, Skeleton, cx } from '../ui';
import { partKey } from '@/lib/bricklink/wanted';
import { partsFor, refreshPartsFor } from '@/app/actions';
import { itemImage, itemPage } from '@/lib/bricklink/links';
import type { PartRow } from '@/lib/service/parts';
import { displayNo, type SetRow } from '@/lib/sets';

/** A set's parts list from BrickLink: regular parts, then alternates. */
export function PartsDialog({ set, priced, onClose }: { set: SetRow; priced: boolean; onClose: () => void }) {
  const [parts, setParts] = useState<PartRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  useEffect(() => { partsFor(set.setNo).then(setParts, (e) => setError(String(e))); }, [set.setNo]);

  const refresh = () => start(async () => {
    setError(null);
    const r = await refreshPartsFor(set.setNo);
    if (!r.ok) setError(r.error);
    setParts(await partsFor(set.setNo));
  });
  const regular = parts?.filter((p) => !p.alternate) ?? [];
  const alternates = parts?.filter((p) => p.alternate) ?? [];

  return (
    <Dialog
      size="lg"
      tall
      title={<>Parts · #{displayNo(set.setNo)} {set.name}</>}
      subtitle={`${set.pieces?.toLocaleString() ?? 0} pieces in ${parts ? regular.length : (set.partLots ?? 0)} lots (alternates not counted)`}
      onClose={onClose}
      footer={priced && (
        <Button icon={RefreshCw} loading={pending} onClick={refresh}>
          {pending ? 'Fetching…' : parts?.length ? 'Refresh parts list' : 'Fetch parts list'}
        </Button>
      )}
    >
      {error && <p role="alert" className="m-4 rounded-control bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      {parts === null ? (
        <div role="status" aria-label="Loading parts" className="space-y-3 p-4">
          {[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-12" />)}
        </div>
      ) : parts.length === 0 ? (
        <div className="p-4">
          <EmptyState title="No parts list yet">
            {priced ? 'Fetch it from BrickLink below, or import the Parts tab in Settings.' : 'Import the Parts tab in Settings, or add BrickLink keys.'}
          </EmptyState>
        </div>
      ) : (
        <>
          <PartList parts={regular} />
          {alternates.length > 0 && (
            <>
              <h3 className="bg-subtle px-4 py-2 text-sm font-semibold text-fg-2">Alternates</h3>
              <PartList parts={alternates} />
            </>
          )}
        </>
      )}
    </Dialog>
  );
}

type MissingProps = {
  /** Pieces marked missing, by partKey(). */
  missing?: Record<string, number>;
  /** Show a "missing" quantity box on each regular part. */
  editing?: boolean;
  onMissing?: (p: PartRow, qty: number) => void;
};

export function PartList({ parts, showSet, missing, editing, onMissing }: { parts: (PartRow & { setNo?: string; setName?: string })[]; showSet?: boolean } & MissingProps) {
  return (
    <ul className="divide-y divide-line">
      {parts.map((p, i) => {
        const gone = missing?.[partKey(p.type, p.partNo, p.colorId)] ?? 0;
        const markable = !p.alternate && !p.counterpart;
        return (
        <li key={`${p.setNo ?? ''}-${p.partNo}-${p.colorId}-${p.matchNo}-${i}`} className={cx('flex items-center gap-3 px-4 py-2', gone > 0 && 'bg-warn-soft')}>
          <p className="w-12 shrink-0 text-right text-lg leading-none">
            <Count n={p.qty} />
            {p.extra > 0 && <span className="mt-1 block text-xs font-normal text-fg-3">+{p.extra} spare</span>}
          </p>
          <a href={itemPage(p.type, p.partNo)} target="_blank" rel="noreferrer" className="flex size-12 shrink-0 items-center justify-center rounded-control bg-tile">
            <Image src={itemImage(p.type, p.partNo, p.colorId)} alt="" width={48} height={48} className="max-h-12 w-auto object-contain" />
          </a>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm">
              {p.rgb && <span className="mr-1.5 inline-block size-2.5 rounded-full ring-1 ring-line-strong" style={{ background: `#${p.rgb}` }} />}
              {p.colorName && p.type === 'PART' ? `${p.colorName} ` : ''}{p.name}
            </p>
            <p className="text-xs text-fg-3">
              <span className="font-mono">{p.partNo}</span> · {p.type.toLowerCase()}
              {p.counterpart && ' · counterpart'}
              {showSet && p.setNo && <> · in <Link href={`/sets/${encodeURIComponent(displayNo(p.setNo))}`} className="font-semibold text-link hover:underline">{displayNo(p.setNo)}</Link> {p.setName}</>}
            </p>
          </div>
          {editing && markable ? (
            <label className="flex shrink-0 items-center gap-2 text-xs text-fg-3">
              Missing
              <input
                type="number" min={0} max={p.qty} inputMode="numeric" value={gone || ''} placeholder="0"
                onChange={(e) => onMissing?.(p, Math.max(0, Math.min(p.qty, Math.floor(Number(e.target.value) || 0))))}
                aria-label={`Missing ${p.colorName ? `${p.colorName} ` : ''}${p.name}`}
                className="w-16 rounded-control border border-line-strong bg-surface px-2 py-1 text-right text-sm text-fg tabular-nums placeholder:text-fg-4"
              />
            </label>
          ) : gone > 0 ? (
            <span className="shrink-0 text-sm font-bold text-warn tabular-nums">{gone} missing</span>
          ) : null}
        </li>
        );
      })}
    </ul>
  );
}
