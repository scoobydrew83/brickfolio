'use client';
/* eslint-disable @next/next/no-img-element -- set photos come from the image cache route, which next/image can't fetch */
import Link from 'next/link';
import { useEffect, useState, useTransition } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Boxes, ExternalLink, Hammer, Link2, Move, RotateCw, Trash2 } from 'lucide-react';
import { searchLayoutItems } from '@/app/actions';
import { cachedImageSrc, fallBackTo } from '@/lib/images/url';
import { KIND_LABEL, MODULE_KINDS, footprint } from '@/lib/layouts';
import type { LayoutItem, LayoutModule, Linkable } from '@/lib/service/layouts';
import { displayNo } from '@/lib/sets';
import { Button, Callout, Chip, Count, Dialog, IconButton, SearchInput, Select, Skeleton, cx, field } from '../ui';
import { moduleName } from './LayoutGrid';

const SIZES = [['1x1', 'Single (1 × 1)'], ['1x2', 'Double (1 × 2)'], ['2x2', 'Quad (2 × 2)']] as const;
const KINDS = MODULE_KINDS.map((k) => [k, KIND_LABEL[k]] as const);

type Props = {
  module: LayoutModule | null;
  /** Pieces still to buy for it. */
  need: number;
  moving: boolean;
  pending: boolean;
  onEdit: (patch: Partial<Pick<LayoutModule, 'name' | 'kind' | 'w' | 'h'>>) => void;
  onRotate: () => void;
  onMove: () => void;
  onNudge: (dx: number, dy: number) => void;
  onRemove: () => void;
  onLink: (items: { setCopyIds: number[]; buildIds: number[] }) => Promise<boolean>;
};

/** Photo for a linked set copy or build. */
export function ItemThumb({ kind, setNo, imageUrl, className }: { kind: 'copy' | 'build'; setNo: string; imageUrl: string | null; className?: string }) {
  const src = kind === 'copy' ? cachedImageSrc('set', setNo, imageUrl, true) : imageUrl;
  return (
    <span className={cx('flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-control bg-tile', className)}>
      {src ? <img src={src} alt="" referrerPolicy="no-referrer" onError={imageUrl ? fallBackTo(imageUrl) : undefined} className="max-h-full max-w-full object-contain" />
        : kind === 'copy' ? <Boxes aria-hidden className="size-5 text-tile-ink" /> : <Hammer aria-hidden className="size-5 text-tile-ink" />}
    </span>
  );
}

const itemHref = (i: Pick<LayoutItem, 'kind' | 'setNo'>) => `/sets/${encodeURIComponent(displayNo(i.setNo))}`;

/** The selected module: its name, type and size, turn / move / remove, and the set copies and builds on it. */
export function ModulePanel({ module: m, need, moving, pending, onEdit, onRotate, onMove, onNudge, onRemove, onLink }: Props) {
  const [name, setName] = useState(m?.name ?? '');
  const [linking, setLinking] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [shownFor, setShownFor] = useState(m?.id);
  if (shownFor !== m?.id) { setShownFor(m?.id); setName(m?.name ?? ''); setConfirmRemove(false); setLinking(false); }

  if (!m) {
    return (
      <Callout className="p-4 text-sm text-fg-2">
        <p className="font-semibold text-fg">No module selected</p>
        <p className="mt-1">Tap an empty square to add a module, or a module to select it. With the keyboard: arrow keys move between squares, Enter adds or selects.</p>
      </Callout>
    );
  }

  const f = footprint(m);
  const saveName = () => { if ((name.trim() || null) !== m.name) onEdit({ name: name.trim() || null }); };
  const big = 'size-11'; // 44px touch targets

  return (
    <Callout className="space-y-4 p-4">
      <div>
        <label className="block text-sm text-fg-3">
          Name
          <input value={name} maxLength={60} placeholder={KIND_LABEL[m.kind]} onChange={(e) => setName(e.target.value)} onBlur={saveName} onKeyDown={(e) => { if (e.key === 'Enter') saveName(); }} className={field} />
        </label>
        <p className="mt-1 text-xs text-fg-3">
          Row {f.y + 1}, column {f.x + 1}{m.rotation ? ` · rotated ${m.rotation}°` : ''}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="text-sm text-fg-3">Type
          <Select value={m.kind} onChange={(e) => onEdit({ kind: e.target.value as LayoutModule['kind'] })} options={KINDS} className="mt-1 w-full" />
        </label>
        <label className="text-sm text-fg-3">Size
          <Select value={`${m.w}x${m.h}`} onChange={(e) => { const [w, h] = e.target.value.split('x').map(Number); onEdit({ w, h }); }} options={SIZES} className="mt-1 w-full" />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-1">
        <IconButton icon={RotateCw} label="Rotate 90° (R)" onClick={onRotate} disabled={pending} className={big} />
        <IconButton icon={Move} label={moving ? 'Cancel move' : 'Move: then tap a square'} onClick={onMove} aria-pressed={moving} className={cx(big, moving && 'bg-primary text-on-primary hover:bg-primary-hover hover:text-on-primary')} />
        <span className="mx-1 h-6 w-px bg-line" aria-hidden />
        <IconButton icon={ArrowLeft} label="Move left (Shift ←)" onClick={() => onNudge(-1, 0)} disabled={pending} className={big} />
        <IconButton icon={ArrowUp} label="Move up (Shift ↑)" onClick={() => onNudge(0, -1)} disabled={pending} className={big} />
        <IconButton icon={ArrowDown} label="Move down (Shift ↓)" onClick={() => onNudge(0, 1)} disabled={pending} className={big} />
        <IconButton icon={ArrowRight} label="Move right (Shift →)" onClick={() => onNudge(1, 0)} disabled={pending} className={big} />
        <span className="ml-auto" />
        <IconButton icon={Trash2} tone="danger" label="Remove module" onClick={() => setConfirmRemove(true)} disabled={pending} className={big} />
      </div>
      {moving && <p className="text-sm text-fg-2">Tap the square where its top-left corner should go. Escape cancels.</p>}
      {confirmRemove && (
        <div role="alert" className="flex flex-wrap items-center gap-2 rounded-control bg-danger-soft px-3 py-2 text-sm text-danger">
          <span className="mr-auto">Remove {moduleName(m)}? What stands on it stays in your collection.</span>
          <Button size="sm" onClick={() => setConfirmRemove(false)}>Keep</Button>
          <Button size="sm" variant="danger" onClick={onRemove}>Remove</Button>
        </div>
      )}

      <div className="space-y-2 border-t border-line pt-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">On this module</h3>
          {need > 0 ? <Chip tone="warn">needs {need}x</Chip> : m.items.length > 0 ? <Chip tone="ok">complete</Chip> : null}
        </div>
        {m.items.length === 0 ? (
          <p className="text-sm text-fg-3">Nothing yet. Link the set copies and builds that stand here.</p>
        ) : (
          <ul className="space-y-2">
            {m.items.map((i) => (
              <li key={`${i.kind}-${i.refId}`} className="flex items-center gap-3">
                <ItemThumb {...i} />
                <span className="min-w-0 flex-1 text-sm">
                  <span className="block truncate font-medium">{i.name}</span>
                  <span className="block truncate text-xs text-fg-3">
                    {i.kind === 'copy' ? <><Link href={itemHref(i)} className="font-semibold text-link hover:underline">{displayNo(i.setNo)}</Link>{i.detail ? ` · ${i.detail}` : ''}</>
                      : <>{i.detail === 'your build' ? 'Your build' : `Build ${i.detail}`}{i.url && <> · <a href={i.url} target="_blank" rel="noreferrer" className="text-link hover:underline">Rebrickable<ExternalLink aria-hidden className="ml-0.5 inline size-3" /></a></>}</>}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
        <Button icon={Link2} onClick={() => setLinking(true)} disabled={pending} className="w-full">Link sets and builds…</Button>
      </div>

      {linking && <LinkDialog module={m} onClose={() => setLinking(false)} onSave={async (items) => { if (await onLink(items)) setLinking(false); }} />}
    </Callout>
  );
}

/** Pick the set copies and builds on a module. Ones already on another module say where and can't be picked. */
function LinkDialog({ module: m, onClose, onSave }: { module: LayoutModule; onClose: () => void; onSave: (items: { setCopyIds: number[]; buildIds: number[] }) => Promise<void> }) {
  const [q, setQ] = useState('');
  const [found, setFound] = useState<Linkable[] | null>(null);
  const [copies, setCopies] = useState(() => new Set(m.items.filter((i) => i.kind === 'copy').map((i) => i.refId)));
  const [builds, setBuilds] = useState(() => new Set(m.items.filter((i) => i.kind === 'build').map((i) => i.refId)));
  const [saving, start] = useTransition();

  // Search 300 ms after typing stops (at once when the dialog opens).
  useEffect(() => {
    let live = true;
    const t = setTimeout(() => searchLayoutItems(q).then((r) => { if (live) setFound(r); }), q ? 300 : 0);
    return () => { live = false; clearTimeout(t); };
  }, [q]);

  const toggle = (l: Pick<Linkable, 'kind' | 'id'>) => {
    const [set, put] = l.kind === 'copy' ? [copies, setCopies] : [builds, setBuilds];
    const next = new Set(set);
    if (next.has(l.id)) next.delete(l.id); else next.add(l.id);
    put(next);
  };
  const picked = (l: Pick<Linkable, 'kind' | 'id'>) => (l.kind === 'copy' ? copies : builds).has(l.id);
  // What's on the module now stays listed even when the search hides it.
  const current = m.items.filter((i) => !found?.some((f) => f.kind === i.kind && f.id === i.refId));
  const n = copies.size + builds.size;

  const row = (key: string, l: { kind: 'copy' | 'build'; id: number; name: string; imageUrl: string | null; setNo: string; detail: string }, elsewhere: string | null) => (
    <li key={key}>
      <label className={cx('flex min-h-14 items-center gap-3 px-4 py-2', elsewhere ? 'opacity-60' : 'cursor-pointer hover:bg-subtle')}>
        <input type="checkbox" checked={picked(l)} disabled={!!elsewhere} onChange={() => toggle(l)} className="size-5 shrink-0 accent-primary" />
        <ItemThumb {...l} className="size-10" />
        <span className="min-w-0 flex-1 text-sm">
          <span className="block truncate font-medium">{l.name}</span>
          <span className="block truncate text-xs text-fg-3">{l.kind === 'copy' ? 'Set copy' : 'Build'} · {l.detail}</span>
          {elsewhere && <span className="block truncate text-xs text-fg-2">On {elsewhere}. Remove it there to move it here.</span>}
        </span>
      </label>
    </li>
  );

  return (
    <Dialog
      size="lg"
      tall
      title={`Link to ${moduleName(m)}`}
      subtitle="Set copies and alternate builds. Each stands on one module at a time."
      onClose={onClose}
      footer={<>
        <span className="mr-auto self-center text-sm text-fg-3"><Count n={n} /> picked</span>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={saving} onClick={() => start(() => onSave({ setCopyIds: [...copies], buildIds: [...builds] }))}>Save</Button>
      </>}
    >
      <div className="sticky top-0 z-10 border-b border-line bg-surface p-4">
        <SearchInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search set name or number, or build" aria-label="Search set copies and builds" autoFocus className="min-w-0" />
      </div>
      {found === null ? (
        <div role="status" aria-label="Loading" className="space-y-3 p-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-12" />)}</div>
      ) : (
        <ul className="divide-y divide-line">
          {current.map((i) => row(`now-${i.kind}-${i.refId}`, { kind: i.kind, id: i.refId, name: i.name, imageUrl: i.imageUrl, setNo: i.setNo, detail: i.kind === 'copy' ? `#${displayNo(i.setNo)}${i.detail ? ` · ${i.detail.toLowerCase()}` : ''}` : i.detail }, null))}
          {found.map((l) => row(`${l.kind}-${l.id}`, l, l.placed && l.placed.moduleId !== m.id ? `${l.placed.layoutName}, ${l.placed.label}` : null))}
          {found.length === 0 && current.length === 0 && (
            <li className="p-6 text-center text-sm text-fg-3">{q ? 'Nothing matches.' : 'No set copies or builds yet. Add sets on the Sets page; alternate builds come from Rebrickable.'}</li>
          )}
        </ul>
      )}
    </Dialog>
  );
}
