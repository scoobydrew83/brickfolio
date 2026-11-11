'use client';
import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useRef, useState, useTransition } from 'react';
import { Boxes, Download, ExternalLink, LayoutGrid, PackageCheck, Plus, Upload } from 'lucide-react';
import { addBuild, autoReserveParts, buildReservations, releaseParts, removeBuild, uploadBuildParts } from '@/app/actions';
import type { Reservation } from '@/lib/service/allocations';
import type { BuildMatch } from '@/lib/service/builds';
import { displayNo } from '@/lib/sets';
import { PageHeader } from './shell/PageHeader';
import { Banner, Button, Count, Dialog, EmptyState, FilterChip, Segmented, Skeleton, buttonClass, field } from './ui';

type Filter = 'all' | 'ready' | 'close';
type Kind = 'all' | 'alternate' | 'mine';
const FILTERS: [Filter, string][] = [['all', 'Any match'], ['ready', 'Ready to build'], ['close', '90% or more']];
const KINDS = [{ value: 'all', label: 'All builds' }, { value: 'alternate', label: 'Alternates' }, { value: 'mine', label: 'My builds' }] as const;

type Message = { kind: 'ok' | 'error'; text: string };
const plural = (n: number) => `${n} ${n === 1 ? 'build' : 'builds'}`;

/** Builds ranked by how much of each you already have: alternates of your sets, Rebrickable MOCs and your own. */
export default function BuildView({ builds, hasKey, hasParts, hasLots }: { builds: BuildMatch[]; hasKey: boolean; hasParts: boolean; hasLots: boolean }) {
  const [filter, setFilter] = useState<Filter>('all');
  const [kind, setKind] = useState<Kind>('all');
  const [message, setMessage] = useState<Message | null>(null);
  const [adding, setAdding] = useState(false);
  const [reserved, setReserved] = useState<BuildMatch | null>(null);
  const mine = (b: BuildMatch) => b.kind !== 'alternate';
  const ofKind = builds.filter((b) => (kind === 'all' ? true : kind === 'mine' ? mine(b) : !mine(b)));
  // Your own builds show before their parts list is in; alternates wait for theirs.
  const known = ofKind.filter((b) => b.partsKnown || mine(b));
  const shown = known.filter((b) => (filter === 'ready' ? b.partsKnown && b.pct === 100 : filter === 'close' ? b.partsKnown && b.pct >= 90 : true));
  const unavailable = ofKind.filter((b) => b.partsUnavailable && !mine(b));
  const waiting = ofKind.filter((b) => !mine(b)).length - known.filter((b) => !mine(b)).length - unavailable.length;
  const nothing = !builds.length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="What can I build?"
        badge={builds.some((b) => b.partsKnown) ? <span className="text-sm text-fg-3 tabular-nums">{plural(builds.filter((b) => b.partsKnown).length)}</span> : undefined}
        actions={<>
          <Link href="/parts/lots" className={buttonClass('secondary')}><Boxes aria-hidden className="size-4" />Loose parts</Link>
          <Link href="/layouts" className={buttonClass('secondary')}><LayoutGrid aria-hidden className="size-4" />Layouts</Link>
          <Button variant="primary" icon={Plus} onClick={() => setAdding(true)}>Add a build</Button>
        </>}
      >
        <p>Alternate builds of your sets, Rebrickable MOCs and your own builds, matched against your sets&apos; parts and your loose parts.</p>
      </PageHeader>

      {message && <Banner kind={message.kind} onDismiss={() => setMessage(null)}>{message.text}</Banner>}

      {nothing && !hasKey ? (
        <EmptyState title="Add a build, or a Rebrickable key">
          <b>Add a build</b> for your own MOC with a parts list file. Or set <code className="rounded-chip bg-muted px-1">REBRICKABLE_API_KEY</code> (free from your Rebrickable account) and the daily sync finds alternate builds for your sets.
        </EmptyState>
      ) : nothing && !hasParts && !hasLots ? (
        <EmptyState title="No parts lists yet">
          Matching needs your sets’ parts lists or loose parts. Parts lists come from BrickLink with each sync, or import the Parts tab in Settings.
        </EmptyState>
      ) : nothing ? (
        <EmptyState title="Nothing found yet">Each sync looks up a few of your sets on Rebrickable. Builds appear here as they’re found, or add your own.</EmptyState>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Segmented label="Which builds" value={kind} onChange={setKind} options={KINDS} />
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
              {shown.map((b) => <BuildRow key={b.mocNo} b={b} hasLots={hasLots} onMessage={setMessage} onReserved={() => setReserved(b)} />)}
            </ul>
          )}
          <p className="text-xs text-fg-3">Builds and part lists from Rebrickable. Spare parts and alternates in your sets aren’t counted. Loose parts reserved for one build don’t count for the others.</p>
        </>
      )}

      {adding && <AddBuildDialog hasKey={hasKey} onClose={() => setAdding(false)} onDone={(text) => { setAdding(false); setMessage({ kind: 'ok', text }); }} />}
      {reserved && <ReservationsDialog build={reserved} onClose={() => setReserved(null)} onMessage={setMessage} />}
    </div>
  );
}

function BuildRow({ b, hasLots, onMessage, onReserved }: { b: BuildMatch; hasLots: boolean; onMessage: (m: Message) => void; onReserved: () => void }) {
  const [pending, start] = useTransition();
  const [confirm, setConfirm] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const run = (fn: () => Promise<{ ok: true; message?: string } | { ok: false; error: string }>, ok: string) => start(async () => {
    const r = await fn();
    onMessage(r.ok ? { kind: 'ok', text: r.message || ok } : { kind: 'error', text: r.error });
  });
  const upload = (f: File) => { const form = new FormData(); form.set('file', f); run(() => uploadBuildParts(b.mocNo, form), 'Parts list saved.'); };
  const mine = b.kind !== 'alternate';

  return (
    <li className="grid grid-cols-[5.5rem_minmax(0,1fr)] items-center gap-x-4 gap-y-2 py-4 sm:grid-cols-[6rem_4rem_minmax(0,1fr)_auto]">
      <span className="text-2xl font-extrabold tracking-tight tabular-nums [font-stretch:115%] sm:text-3xl">{b.partsKnown ? `${b.pct}%` : '–'}</span>
      <span className="relative hidden size-16 overflow-hidden rounded-chip bg-tile sm:block">
        {b.imageUrl && <Image src={b.imageUrl} alt="" fill sizes="64px" className="object-cover" />}
      </span>
      <span className="min-w-0">
        <span className="block truncate font-semibold">{b.name}</span>
        <span className="block text-xs text-fg-3">
          {b.kind === 'alternate' ? <>Alternate build of <Link href={`/sets/${encodeURIComponent(displayNo(b.sourceSetNo))}`} className="font-semibold text-link hover:underline">{displayNo(b.sourceSetNo)}</Link></>
            : b.kind === 'moc' ? <>Rebrickable {b.mocNo}</> : 'Your build'}
          {b.designer ? ` · by ${b.designer}` : ''}{b.partsKnown ? ` · ${b.need.toLocaleString()} pcs` : ''}
        </span>
        {b.partsKnown ? (
          <span className={`mt-0.5 block text-xs ${b.missingPieces ? 'text-fg-2' : 'font-semibold text-ok'}`}>
            {b.missingPieces ? `${b.missingPieces.toLocaleString()} ${b.missingPieces === 1 ? 'piece' : 'pieces'} missing in ${b.missingLots} ${b.missingLots === 1 ? 'lot' : 'lots'}` : 'You have every part'}
            {b.fromLots ? ` · ${b.fromLots.toLocaleString()}x from loose parts${b.reserved ? `, ${b.reserved.toLocaleString()}x reserved` : ''}` : ''}
            {b.unmapped ? ` · ${b.unmapped} ${b.unmapped === 1 ? 'lot' : 'lots'} without a BrickLink match` : ''}
          </span>
        ) : (
          <span className="mt-0.5 block text-xs text-fg-2">{b.kind === 'custom' ? 'Upload its parts list: BrickLink XML or a Rebrickable CSV.' : 'Its parts list comes from Rebrickable with the next sync.'}</span>
        )}
        {confirm && (
          <span role="alert" className="mt-2 flex flex-wrap items-center gap-2 rounded-control bg-danger-soft px-3 py-2 text-sm text-danger">
            <span className="mr-auto">Remove {b.name}{b.reserved ? ` and release its ${b.reserved}x reserved` : ''}?</span>
            <Button size="sm" onClick={() => setConfirm(false)}>Keep</Button>
            <Button size="sm" variant="danger" loading={pending} onClick={() => run(() => removeBuild(b.mocNo), `Removed ${b.name}.`)}>Remove</Button>
          </span>
        )}
      </span>
      <span className="col-span-2 flex flex-wrap items-center justify-end gap-1 sm:col-span-1">
        {b.partsKnown && hasLots && b.need - b.reserved > 0 && (
          <Button size="sm" icon={PackageCheck} loading={pending} onClick={() => run(() => autoReserveParts(b.mocNo), 'Reserved.')} title="Set aside the loose parts this build still needs">Reserve from loose parts</Button>
        )}
        {b.reserved > 0 && <Button size="sm" variant="ghost" onClick={onReserved}><Count n={b.reserved} /> reserved</Button>}
        {b.partsKnown && b.missingPieces > 0 && (
          <a href={`/api/v1/builds/${encodeURIComponent(b.mocNo)}/wanted.xml`} className={buttonClass('secondary', 'sm')} title="Upload this in BrickLink under Wanted → Upload">
            <Download aria-hidden className="size-4" />Wanted List
          </a>
        )}
        {b.kind === 'custom' && (
          <>
            <input ref={file} type="file" accept=".xml,.csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ''; }} />
            <Button size="sm" icon={Upload} disabled={pending} onClick={() => file.current?.click()}>{b.partsKnown ? 'Replace parts list' : 'Upload parts list'}</Button>
          </>
        )}
        {b.url && (
          <a href={b.url} target="_blank" rel="noreferrer" className={buttonClass('ghost', 'sm')}>
            <ExternalLink aria-hidden className="size-4" />Rebrickable
          </a>
        )}
        {mine && !confirm && <Button variant="danger-link" className="px-2" onClick={() => setConfirm(true)}>Remove</Button>}
      </span>
    </li>
  );
}

/** Add a Rebrickable MOC by number, or your own build by name with its parts list. */
function AddBuildDialog({ hasKey, onClose, onDone }: { hasKey: boolean; onClose: () => void; onDone: (message: string) => void }) {
  const [kind, setKind] = useState<'moc' | 'custom'>(hasKey ? 'moc' : 'custom');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const submit = (form: FormData) => start(async () => {
    setError(null);
    const r = await addBuild({ kind, mocNo: form.get('mocNo'), name: form.get('name') });
    if (!r.ok) return setError(r.error);
    const f = form.get('file');
    if (kind === 'custom' && f instanceof File && f.size) {
      const up = new FormData();
      up.set('file', f);
      const u = await uploadBuildParts(r.mocNo!, up);
      if (!u.ok) return onDone(`Build added, but its parts list wasn't: ${u.error}`);
      return onDone(`Build added. ${u.message ?? ''}`);
    }
    onDone(kind === 'moc' ? 'MOC added. Its parts list comes from Rebrickable with the next sync.' : 'Build added. Upload its parts list from the list.');
  });
  return (
    <Dialog
      title="Add a build"
      onClose={onClose}
      footer={<>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" type="submit" form="add-build" loading={pending}>Add</Button>
      </>}
    >
      <form id="add-build" action={submit} className="space-y-4 p-5">
        {error && <p role="alert" className="rounded-control bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
        <Segmented label="Kind of build" value={kind} onChange={setKind} options={[{ value: 'moc', label: 'Rebrickable MOC' }, { value: 'custom', label: 'My own build' }]} />
        {kind === 'moc' ? (
          <>
            <label className="block text-sm text-fg-2">MOC number
              <input name="mocNo" required pattern="[Mm][Oo][Cc]-\d+" placeholder="MOC-12345" autoCapitalize="characters" className={field} />
            </label>
            <p className="text-xs text-fg-3">{hasKey ? 'Its name and photo come from Rebrickable now, and its parts list with the next sync (if the designer shares it).' : 'Needs REBRICKABLE_API_KEY for its name and parts list.'}</p>
          </>
        ) : (
          <>
            <label className="block text-sm text-fg-2">Name
              <input name="name" required maxLength={200} placeholder="My tram" className={field} />
            </label>
            <label className="block text-sm text-fg-2">Parts list (optional now)
              <input type="file" name="file" accept=".xml,.csv,application/xml,text/csv" className={`${field} file:mr-3 file:rounded-control file:border-0 file:bg-muted file:px-3 file:py-1 file:text-sm file:text-fg`} />
            </label>
            <p className="text-xs text-fg-3">BrickLink XML (e.g. exported from Studio) or a Rebrickable parts CSV.</p>
          </>
        )}
      </form>
    </Dialog>
  );
}

/** What's reserved for a build, by lot, with Release. */
function ReservationsDialog({ build: b, onClose, onMessage }: { build: BuildMatch; onClose: () => void; onMessage: (m: Message) => void }) {
  const [rows, setRows] = useState<Reservation[] | null>(null);
  const [pending, start] = useTransition();
  useEffect(() => { buildReservations(b.mocNo).then(setRows); }, [b.mocNo]);
  const free = (lotId?: number) => start(async () => {
    const r = await releaseParts(b.mocNo, lotId);
    if (!r.ok) return onMessage({ kind: 'error', text: r.error });
    const next = await buildReservations(b.mocNo);
    setRows(next);
    if (!next.length) { onMessage({ kind: 'ok', text: `Released everything reserved for ${b.name}.` }); onClose(); }
  });
  const total = rows?.reduce((t, r) => t + r.qty, 0) ?? b.reserved;
  return (
    <Dialog
      size="lg"
      tall
      title={`Reserved for ${b.name}`}
      subtitle={<><Count n={total} /> from loose parts. Reserved parts count for this build only.</>}
      onClose={onClose}
      footer={<>
        <Button variant="danger-link" className="mr-auto" disabled={pending || !rows?.length} onClick={() => free()}>Release all</Button>
        <Button onClick={onClose}>Done</Button>
      </>}
    >
      {rows === null ? (
        <div role="status" aria-label="Loading" className="space-y-3 p-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-12" />)}</div>
      ) : rows.length === 0 ? (
        <p className="p-6 text-center text-sm text-fg-3">Nothing reserved.</p>
      ) : (
        <ul className="divide-y divide-line">
          {rows.map((r) => (
            <li key={r.lotId} className="flex items-center gap-3 px-4 py-2">
              <p className="w-12 shrink-0 text-right text-lg leading-none"><Count n={r.qty} /></p>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">
                  {r.rgb && <span className="mr-1.5 inline-block size-2.5 rounded-full ring-1 ring-line-strong" style={{ background: `#${r.rgb}` }} />}
                  {r.colorName ? `${r.colorName} ` : ''}{r.name ?? r.partNo}
                </p>
                <p className="truncate text-xs text-fg-3"><span className="font-mono">{r.partNo}</span> · {r.location ?? 'no location'}{r.approximate ? ' · approximate count' : ''}</p>
              </div>
              <Button variant="danger-link" disabled={pending} onClick={() => free(r.lotId)}>Release</Button>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}
