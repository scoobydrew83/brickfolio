'use client';
import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useState, useTransition } from 'react';
import { Hammer, LayoutGrid, Pencil, Plus, Puzzle, Upload } from 'lucide-react';
import { addLot, editLot, importLotsFile, removeLot, searchLots, undoLotImport } from '@/app/actions';
import { itemImage, itemPage } from '@/lib/bricklink/links';
import type { LotRow } from '@/lib/service/lots';
import { PageHeader } from './shell/PageHeader';
import { Banner, Button, Callout, Chip, Count, Dialog, EmptyState, IconButton, SearchInput, Segmented, Select, buttonClass, field } from './ui';

type Import = { id: string; fileName: string | null; location: string | null; mode: 'add' | 'replace'; lots: number; pieces: number; createdAt: string };
type Props = { first: { lots: LotRow[]; total: number; pieces: number }; locations: string[]; imports: Import[] };

/** Loose parts in bins and drawers, and parted-out sets: search, add, edit, import and undo. */
export default function LotsView({ first, locations, imports }: Props) {
  const [q, setQ] = useState('');
  const [location, setLocation] = useState('');
  const [data, setData] = useState(first);
  const [touched, setTouched] = useState(false);
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState<LotRow | 'new' | null>(null);
  const [importing, setImporting] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string; batch?: string } | null>(null);

  // Server data changes after every action (refresh): take it, or search again with the current filters.
  const [shown, setShown] = useState(first);
  if (shown !== first) { setShown(first); if (!touched) setData(first); }
  useEffect(() => {
    if (!touched) return;
    const t = setTimeout(() => start(async () => setData(await searchLots({ q, location }))), 300);
    return () => clearTimeout(t);
  }, [q, location, touched, first]);
  const more = () => start(async () => {
    const next = await searchLots({ q, location, offset: data.lots.length });
    setData({ ...next, lots: [...data.lots, ...next.lots] });
  });

  const undo = (batch: string) => start(async () => {
    const r = await undoLotImport(batch);
    setMessage(r.ok ? { kind: 'ok', text: r.message ?? 'Import undone.' } : { kind: 'error', text: r.error });
  });

  const empty = first.total === 0 && !touched;
  const importButton = <Button variant="primary" icon={Upload} onClick={() => setImporting(true)}>Import</Button>;
  const addButton = <Button icon={Plus} onClick={() => setEditing('new')}>Add lot</Button>;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Loose parts"
        actions={<>
          <Link href="/parts" className={buttonClass('secondary')}><Puzzle aria-hidden className="size-4" />In sets</Link>
          <Link href="/layouts" className={buttonClass('secondary')}><LayoutGrid aria-hidden className="size-4" />Layouts</Link>
          <Link href="/build" className={buttonClass('secondary')}><Hammer aria-hidden className="size-4" />What can I build?</Link>
        </>}
      >
        <p>Parts outside your sets: bins, drawers, bags and parted-out sets. They count in What can I build?, and builds can reserve them.</p>
      </PageHeader>

      {message && (
        <Banner kind={message.kind} onDismiss={() => setMessage(null)}>
          {message.text}
          {message.batch && <> <button type="button" onClick={() => { undo(message.batch!); }} className="font-semibold underline">Undo</button></>}
        </Banner>
      )}

      {empty ? (
        <EmptyState title="No loose parts yet" action={<div className="flex flex-wrap justify-center gap-2">{importButton}{addButton}</div>}>
          Import a BrickLink XML (a Wanted List or inventory export) or a Rebrickable parts CSV, or add a lot by hand. Marking a set copy parted out also puts its parts here.
        </EmptyState>
      ) : (
        <>
          <div className="space-y-2">
            <div className="flex flex-wrap gap-3">
              <SearchInput value={q} onChange={(e) => { setQ(e.target.value); setTouched(true); }} placeholder="Search part #, name, colour or location…" aria-label="Search loose parts" />
              <Select aria-label="Location" value={location} onChange={(e) => { setLocation(e.target.value); setTouched(true); }} options={[['', 'All locations'], ['-', 'No location'], ...locations.map((l) => [l, l])]} />
              {addButton}
              {importButton}
            </div>
            <p className="text-sm text-fg-3">
              {pending ? 'Searching…' : <><b className="text-fg tabular-nums">{data.pieces.toLocaleString()}</b> pieces in {data.total.toLocaleString()} {data.total === 1 ? 'lot' : 'lots'}{data.lots.length < data.total ? ` (showing ${data.lots.length})` : ''}</>}
            </p>
          </div>

          {data.total === 0 ? <EmptyState title="Nothing matches">Try another search or location.</EmptyState> : (
            <Callout className="overflow-hidden">
              <ul className="divide-y divide-line">
                {data.lots.map((l) => (
                  <li key={l.id} className="flex items-center gap-3 px-4 py-2">
                    <p className="w-11 shrink-0 text-right text-lg leading-none sm:w-14"><Count n={l.qty} /></p>
                    <a href={itemPage(l.type, l.partNo)} target="_blank" rel="noreferrer" className="hidden size-12 shrink-0 items-center justify-center rounded-control bg-tile min-[400px]:flex">
                      <Image src={itemImage(l.type, l.partNo, l.colorId)} alt="" width={48} height={48} className="max-h-12 w-auto object-contain" />
                    </a>
                    <div className="min-w-0 flex-1">
                      <p className="line-clamp-2 text-sm">
                        {l.rgb && <span className="mr-1.5 inline-block size-2.5 rounded-full ring-1 ring-line-strong" style={{ background: `#${l.rgb}` }} />}
                        {l.colorName && l.type === 'PART' ? `${l.colorName} ` : ''}{l.name ?? l.partNo}
                      </p>
                      <p className="text-xs text-fg-3">
                        <span className="font-mono">{l.partNo}</span>{l.type !== 'PART' ? ` · ${l.type.toLowerCase()}` : ''} · {l.location ?? 'no location'} · {l.from ? `from ${l.from}` : 'bin'}
                      </p>
                      {l.reserved > 0 && <p className="text-xs text-fg-2"><b className="tabular-nums">{l.reserved}x</b> reserved for {l.reservedFor.map((b) => b.name).join(', ')}</p>}
                    </div>
                    <span className="hidden shrink-0 gap-1 sm:flex">
                      {l.approximate && <Chip>≈ approximate</Chip>}
                      {!l.mapped && <Chip tone="warn">no BrickLink match</Chip>}
                    </span>
                    {(l.approximate || !l.mapped) && <span className="shrink-0 sm:hidden">{l.approximate ? <Chip>≈</Chip> : <Chip tone="warn">no match</Chip>}</span>}
                    <IconButton icon={Pencil} label={`Edit ${l.name ?? l.partNo}`} onClick={() => setEditing(l)} className="size-11" />
                  </li>
                ))}
              </ul>
            </Callout>
          )}
          {data.lots.length < data.total && <Button onClick={more} loading={pending} className="w-full">Show {Math.min(200, data.total - data.lots.length)} more</Button>}
        </>
      )}

      {imports.length > 0 && (
        <section aria-labelledby="imports" className="space-y-2">
          <h2 id="imports" className="text-sm font-semibold text-fg-2">Recent imports</h2>
          <ul className="divide-y divide-line border-y border-line text-sm">
            {imports.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                <span className="min-w-0 flex-1 truncate">{i.fileName ?? 'Import'} · {i.pieces.toLocaleString()} pieces · {i.mode === 'add' ? 'added' : 'replaced'}{i.location ? ` in ${i.location}` : ''}</span>
                <span className="text-xs text-fg-3">{i.createdAt.slice(0, 16).replace('T', ' ')}</span>
                <Button variant="danger-link" disabled={pending} onClick={() => undo(i.id)}>Undo</Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {editing && <LotDialog lot={editing === 'new' ? null : editing} locations={locations} onClose={() => setEditing(null)} onDone={(text) => { setEditing(null); setMessage({ kind: 'ok', text }); }} />}
      {importing && <ImportDialog locations={locations} onClose={() => setImporting(false)} onDone={(text, batch) => { setImporting(false); setMessage({ kind: 'ok', text, batch }); }} />}
    </div>
  );
}

/** Add or edit one lot; removing a reserved lot asks first. */
function LotDialog({ lot, locations, onClose, onDone }: { lot: LotRow | null; locations: string[]; onClose: () => void; onDone: (message: string) => void }) {
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [pending, start] = useTransition();
  const save = (form: FormData) => start(async () => {
    const values = { ...Object.fromEntries(form), approximate: form.get('approximate') === 'on' };
    const r = lot ? await editLot(lot.id, values) : await addLot(values);
    if (r.ok) onDone(lot ? 'Lot saved.' : 'Lot added.'); else setError(r.error);
  });
  const remove = () => start(async () => {
    const r = await removeLot(lot!.id, confirm);
    if (r.ok) onDone('Lot removed.');
    else if (lot!.reserved && !confirm) setConfirm(true);
    else setError(r.error);
  });
  return (
    <Dialog
      title={lot ? `Edit ${lot.name ?? lot.partNo}` : 'Add a lot'}
      subtitle={lot?.from ? `From ${lot.from}` : undefined}
      onClose={onClose}
      footer={confirm ? (
        <>
          <span className="mr-auto self-center text-sm text-danger">Its {lot!.reserved}x reserved for {lot!.reservedFor.map((b) => b.name).join(', ')} will be released.</span>
          <Button onClick={() => setConfirm(false)}>Keep</Button>
          <Button variant="danger" loading={pending} onClick={remove}>Remove anyway</Button>
        </>
      ) : (
        <>
          {lot && <Button variant="danger-link" className="mr-auto" disabled={pending} onClick={remove}>Remove lot</Button>}
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="lot-form" loading={pending}>Save</Button>
        </>
      )}
    >
      <form id="lot-form" action={save} className="space-y-4 p-5">
        {error && <p role="alert" className="rounded-control bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm text-fg-2">BrickLink part #
            <input name="partNo" required defaultValue={lot?.partNo} placeholder="3001" autoCapitalize="none" className={field} />
          </label>
          <label className="block text-sm text-fg-2">Colour #
            <input name="colorId" inputMode="numeric" defaultValue={lot?.colorId ?? ''} placeholder="5 (red)" className={field} />
          </label>
          <label className="block text-sm text-fg-2">Quantity
            <input name="qty" type="number" inputMode="numeric" required min={Math.max(1, lot?.reserved ?? 1)} defaultValue={lot?.qty ?? 1} className={field} />
          </label>
          <label className="block text-sm text-fg-2">Type
            <select name="type" defaultValue={lot?.type ?? 'PART'} className={field}>
              {['PART', 'MINIFIG', 'GEAR'].map((t) => <option key={t} value={t}>{t.toLowerCase()}</option>)}
            </select>
          </label>
        </div>
        <label className="block text-sm text-fg-2">Location
          <select name="location" defaultValue={lot?.location ?? ''} className={field}>
            <option value="">No location</option>
            {locations.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </label>
        {lot?.reserved ? <p className="text-xs text-fg-3">{lot.reserved}x reserved for {lot.reservedFor.map((b) => `${b.name} (${b.qty}x)`).join(', ')}: the quantity can&apos;t go below that.</p> : null}
        <label className="flex items-center gap-2 text-sm text-fg-2">
          <input type="checkbox" name="approximate" defaultChecked={lot?.approximate} className="size-4 accent-primary" />
          The count is a guess (reserved last)
        </label>
        <label className="block text-sm text-fg-2">Notes
          <textarea name="notes" rows={2} maxLength={2000} defaultValue={lot?.notes ?? ''} className={field} />
        </label>
      </form>
    </Dialog>
  );
}

/** Import a BrickLink XML or Rebrickable CSV into one location, adding to or replacing matching lots. */
function ImportDialog({ locations, onClose, onDone }: { locations: string[]; onClose: () => void; onDone: (message: string, batch?: string) => void }) {
  const [mode, setMode] = useState<'add' | 'replace'>('add');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const submit = (form: FormData) => start(async () => {
    form.set('mode', mode);
    const r = await importLotsFile(form);
    if (r.ok) onDone(r.message ?? 'Imported.', r.batch); else setError(r.error);
  });
  return (
    <Dialog
      title="Import loose parts"
      subtitle="BrickLink XML (Wanted List, inventory or Studio export) or a Rebrickable parts CSV, up to 5 MB."
      onClose={onClose}
      footer={<>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" type="submit" form="import-lots" loading={pending}>Import</Button>
      </>}
    >
      <form id="import-lots" action={submit} className="space-y-4 p-5">
        {error && <p role="alert" className="rounded-control bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
        <label className="block text-sm text-fg-2">File
          <input type="file" name="file" required accept=".xml,.csv,application/xml,text/xml,text/csv" className={`${field} file:mr-3 file:rounded-control file:border-0 file:bg-muted file:px-3 file:py-1 file:text-sm file:text-fg`} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm text-fg-2">Kind
            <select name="kind" defaultValue="" className={field}>
              <option value="">Tell from the file</option>
              <option value="bricklink_xml">BrickLink XML</option>
              <option value="rebrickable_csv">Rebrickable CSV</option>
            </select>
          </label>
          <label className="block text-sm text-fg-2">Into
            <select name="location" defaultValue="" className={field}>
              <option value="">No location</option>
              {locations.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </label>
        </div>
        <div className="space-y-1">
          <Segmented label="Matching lots" value={mode} onChange={setMode} options={[{ value: 'add', label: 'Add to them' }, { value: 'replace', label: 'Replace their count' }]} />
          <p className="text-xs text-fg-3">A matching lot is the same part and colour in the same location.</p>
        </div>
        <label className="flex items-center gap-2 text-sm text-fg-2">
          <input type="checkbox" name="approximate" className="size-4 accent-primary" />
          The counts are guesses (e.g. a bulk lot)
        </label>
        <p className="text-xs text-fg-3">Rebrickable part and colour numbers are matched to BrickLink ones. You can undo an import afterwards.</p>
      </form>
    </Dialog>
  );
}
