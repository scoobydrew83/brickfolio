'use client';
import Image from 'next/image';
import { useMemo, useState, useTransition } from 'react';
import { Check, ExternalLink, Pencil, Plus, Trash2 } from 'lucide-react';
import { addMinifig, cmfChecklistFor, editMinifig, removeMinifig, tickCmfFig, type Result } from '@/app/actions';
import type { CmfFig, CmfSeries, MinifigRow } from '@/lib/service/minifigs';
import { minifigTotals } from '@/lib/minifigs';
import { moneyIn, type Money } from './board/ui';
import { CollectionTabs } from './shell/CollectionTabs';
import { PageHeader } from './shell/PageHeader';
import { Banner, Button, CONDITION_TONE, Chip, Dialog, EmptyState, IconButton, buttonClass, cx, field } from './ui';

const key = (m: Pick<MinifigRow, 'figNo' | 'rbFigNo'>) => (m.figNo ?? m.rbFigNo)!;
const blFigLink = (no: string) => `https://www.bricklink.com/v2/catalog/catalogitem.page?M=${encodeURIComponent(no)}`;
const rbFigLink = (no: string) => `https://rebrickable.com/minifigs/${encodeURIComponent(no)}/`;

type Props = { figs: MinifigRow[]; series: CmfSeries[]; locations: string[]; currency: string; priced: boolean; hasRebrickable: boolean };

export default function MinifigsView({ figs, series, locations, currency, priced, hasRebrickable }: Props) {
  const money = useMemo(() => moneyIn(currency), [currency]);
  const t = useMemo(() => minifigTotals(figs), [figs]);
  const [editing, setEditing] = useState<MinifigRow | 'new' | null>(null);
  const [dupe, setDupe] = useState<{ form: Record<string, unknown>; name: string; qty: number } | null>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [pending, start] = useTransition();
  const act = (fn: () => Promise<Result>, ok: string, after?: () => void, form?: Record<string, unknown>) =>
    start(async () => {
      const r = await fn();
      if (!r.ok && r.existing && form) return setDupe({ form, ...r.existing });
      setMessage(r.ok ? { kind: 'ok', text: ok } : { kind: 'error', text: r.error });
      if (r.ok) after?.();
    });
  const close = () => { setEditing(null); setDupe(null); };

  return (
    <div className="space-y-6">
      <CollectionTabs />
      <PageHeader
        title="Minifigures"
        badge={<span className="text-sm text-fg-3 tabular-nums">{t.count} figures · {t.copies} copies</span>}
        actions={<Button variant="primary" icon={Plus} onClick={() => setEditing('new')}>Add minifig</Button>}
      >
        <p>Loose figures you own, not the ones inside your sets. {priced ? 'Prices are BrickLink average sold prices, refreshed in the daily sync.' : 'Add BrickLink API keys to price them.'}</p>
      </PageHeader>

      {message && <Banner kind={message.kind} onDismiss={() => setMessage(null)}>{message.text}</Banner>}

      {figs.length > 0 && (
        <p className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-sm text-fg-3">Est. Value</span>
          <span className="text-3xl font-extrabold tracking-tight tabular-nums [font-stretch:112%]">{money(t.estValue)}</span>
          {t.unpriced > 0 && <span className="text-sm text-fg-3">· {t.unpriced} without a BrickLink price</span>}
        </p>
      )}

      {figs.length === 0 ? (
        <EmptyState title="No minifigures yet" action={<Button variant="primary" icon={Plus} onClick={() => setEditing('new')}>Add a minifig</Button>}>
          Add a figure by its BrickLink number, like sw0001, or tick figures off a Collectible Minifigures series below.
        </EmptyState>
      ) : (
        <ul className="divide-y divide-line border-y border-line">
          {figs.map((m) => (
            <li key={m.id} className="grid grid-cols-[3.5rem_minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 py-3">
              <span className="relative size-14 overflow-hidden rounded-chip bg-tile">
                {m.imageUrl && <Image src={m.imageUrl} alt="" fill sizes="56px" className="object-contain p-1 mix-blend-multiply" />}
              </span>
              <span className="min-w-0">
                <span className="block truncate font-semibold">{m.name}</span>
                <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-fg-3">
                  <span className="font-semibold tabular-nums">{m.figNo ?? m.rbFigNo}</span>
                  <Chip tone={CONDITION_TONE[m.condition] ?? 'neutral'}>{m.condition}</Chip>
                  {m.qty > 1 && <span>{m.qty} copies</span>}
                  {m.location && <span>· {m.location}</span>}
                  {m.year && <span>· {m.year}</span>}
                  {!m.figNo && <span>· No BrickLink number, so no price</span>}
                </span>
                {m.blError && <span className="block text-xs text-danger">{m.blError}</span>}
              </span>
              <span className="flex flex-col items-end gap-1">
                <span className="text-lg font-extrabold tabular-nums [font-stretch:112%]">{money(m.estValue)}</span>
                <span className="flex items-center gap-0.5">
                  <a href={m.figNo ? blFigLink(m.figNo) : rbFigLink(m.rbFigNo!)} target="_blank" rel="noreferrer" aria-label={m.figNo ? 'Open on BrickLink' : 'Open on Rebrickable'} title={m.figNo ? 'Open on BrickLink' : 'Open on Rebrickable'} className={cx(buttonClass('ghost', 'sm'), 'size-8 px-0')}><ExternalLink aria-hidden className="size-4" /></a>
                  <IconButton icon={Pencil} label="Edit" onClick={() => setEditing(m)} />
                  <IconButton icon={Trash2} label={m.qty > 1 ? 'Remove one copy' : 'Remove'} tone="danger" disabled={pending} onClick={() => act(() => removeMinifig(key(m)), m.qty > 1 ? `Removed one ${m.name}.` : `Removed ${m.name}.`)} />
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}

      <CmfChecklist series={series} hasRebrickable={hasRebrickable} onTicked={(name) => setMessage({ kind: 'ok', text: `Added ${name}.` })} />

      {editing && (
        <FigForm
          fig={editing === 'new' ? null : editing}
          locations={locations}
          pending={pending}
          dupe={dupe}
          money={money}
          onClose={close}
          onAddAnother={() => dupe && act(() => addMinifig(dupe.form, true), `Added another ${dupe.name}.`, close)}
          onSubmit={(form) => editing === 'new'
            ? act(() => addMinifig(form), 'Added.', close, form)
            : act(() => editMinifig(key(editing), form), 'Saved.', close)}
        />
      )}
    </div>
  );
}

/** One Collectible Minifigures series at a time: which figures you have, and a button to tick the rest off. */
function CmfChecklist({ series, hasRebrickable, onTicked }: { series: CmfSeries[]; hasRebrickable: boolean; onTicked: (name: string) => void }) {
  const [themeId, setThemeId] = useState<number | null>(null);
  const [list, setList] = useState<{ figs: CmfFig[]; owned: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const load = (id: number) => start(async () => {
    setThemeId(id); setError(null);
    const r = await cmfChecklistFor(id);
    if (r.ok) setList({ figs: r.figs, owned: r.owned, total: r.total }); else { setList(null); setError(r.error); }
  });
  const tick = (f: CmfFig) => start(async () => {
    const r = await tickCmfFig(f);
    if (!r.ok) return setError(r.error);
    onTicked(f.name);
    const again = themeId !== null ? await cmfChecklistFor(themeId) : null;
    if (again?.ok) setList({ figs: again.figs, owned: again.owned, total: again.total });
  });

  return (
    <section aria-labelledby="cmf" className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="cmf" className="text-xl font-extrabold tracking-tight">Collectible Minifigures checklist</h2>
          <p className="text-sm text-fg-3">Series and figures from Rebrickable. Ticked-off figures have no BrickLink number until you add one, so they aren’t priced.</p>
        </div>
        {series.length > 0 && (
          <label className="text-sm">
            <span className="sr-only">Series</span>
            <select value={themeId ?? ''} onChange={(e) => e.target.value && load(Number(e.target.value))} className={cx(field, 'mt-0 w-56')}>
              <option value="">Pick a series…</option>
              {series.map((s) => <option key={s.themeId} value={s.themeId}>{s.name}</option>)}
            </select>
          </label>
        )}
      </div>
      {series.length === 0 ? (
        <p className="text-sm text-fg-3">{hasRebrickable ? 'The series list fills in with the next Rebrickable sync (Settings → Rebrickable → Sync now).' : 'Set REBRICKABLE_API_KEY to load the Collectible Minifigures series.'}</p>
      ) : error ? (
        <p role="alert" className="text-sm text-danger">{error}</p>
      ) : pending && !list ? (
        <p className="text-sm text-fg-3">Loading…</p>
      ) : list && (
        <>
          <p className="text-sm"><b className="tabular-nums">{list.owned}</b> of {list.total} figures</p>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {list.figs.map((f) => (
              <li key={f.rbFigNo} className={cx('flex flex-col rounded-card border p-2 text-sm', f.owned ? 'border-ok-ring bg-ok-soft' : 'border-line bg-surface')}>
                <span className="relative aspect-square overflow-hidden rounded-chip bg-tile">
                  {f.imageUrl && <Image src={f.imageUrl} alt="" fill sizes="160px" className="object-contain p-1 mix-blend-multiply" />}
                </span>
                <a href={rbFigLink(f.rbFigNo)} target="_blank" rel="noreferrer" className="mt-2 line-clamp-2 font-semibold leading-tight hover:text-link">{f.name}</a>
                <span className="mt-auto pt-2">
                  {f.owned
                    ? <span className="inline-flex items-center gap-1 text-xs font-semibold text-ok"><Check aria-hidden className="size-4" />Have {f.owned}</span>
                    : <Button size="sm" icon={Plus} disabled={pending} onClick={() => tick(f)}>I have it</Button>}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

type FormProps = {
  fig: MinifigRow | null; locations: string[]; pending: boolean; dupe: { name: string; qty: number } | null; money: Money;
  onClose: () => void; onAddAnother: () => void; onSubmit: (form: Record<string, unknown>) => void;
};

function FigForm({ fig, locations, pending, dupe, money, onClose, onAddAnother, onSubmit }: FormProps) {
  const footer = dupe ? (
    <><Button variant="ghost" onClick={onClose}>Skip</Button><Button variant="primary" loading={pending} onClick={onAddAnother}>Add another (makes {dupe.qty + 1})</Button></>
  ) : (
    <><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" type="submit" form="fig-form" loading={pending}>{pending ? 'Saving…' : 'Save'}</Button></>
  );
  return (
    <Dialog title={fig ? `Edit ${fig.name}` : 'Add a minifig'} onClose={onClose} footer={footer}>
      <form id="fig-form" className="space-y-4 px-5 py-4" onSubmit={(e) => { e.preventDefault(); onSubmit(Object.fromEntries(new FormData(e.currentTarget))); }}>
        <label className="block text-sm">BrickLink number{fig && !fig.figNo && <span className="text-fg-3"> (add one to price it)</span>}
          <input name="figNo" defaultValue={fig?.figNo ?? ''} required={!fig} pattern="[A-Za-z]{1,6}\d{1,5}[A-Za-z]?(-\d{1,2})?" placeholder="sw0001" autoCapitalize="none" className={field} />
        </label>
        <label className="block text-sm">Name <span className="text-fg-3">(optional, filled in from BrickLink)</span>
          <input name="name" defaultValue={fig?.name ?? ''} maxLength={120} className={field} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm">Condition
            <select name="condition" defaultValue={fig?.condition ?? 'Used'} className={field}><option>New</option><option>Used</option></select>
          </label>
          <label className="block text-sm">Location
            <select name="location" defaultValue={fig?.location ?? ''} className={field}>
              <option value="">(none)</option>
              {locations.map((l) => <option key={l}>{l}</option>)}
            </select>
          </label>
          <label className="block text-sm">Qty
            <input name="qty" type="number" min={1} max={999} step={1} defaultValue={fig?.qty ?? 1} className={field} />
          </label>
        </div>
        <label className="block text-sm">Notes
          <textarea name="notes" defaultValue={fig?.notes ?? ''} maxLength={2000} rows={2} className={field} />
        </label>
        {fig?.avgSold != null && <p className="text-xs text-fg-3">Average sold now: {money(fig.avgSold)} ({fig.condition.toLowerCase()}, BrickLink).</p>}
        {dupe && (
          <p role="alert" className="rounded-control bg-warn-soft p-3 text-sm text-warn ring-1 ring-warn-ring">
            Already in stock: you have <b>{dupe.qty}</b> of <b>{dupe.name}</b>. Add more?
          </p>
        )}
      </form>
    </Dialog>
  );
}
