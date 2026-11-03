'use client';
import { useState, useTransition } from 'react';
import { BellOff, BellRing, ExternalLink, Heart, Pencil, Plus, Trash2 } from 'lucide-react';
import { addDesignerProject, addWish, editDesignerProject, removeDesignerProject, type Result } from '@/app/actions';
import type { ProjectRow } from '@/lib/service/designer';
import { STAGES, STAGE_LABEL } from '@/lib/designer';
import { displayNo } from '@/lib/sets';
import type { Money } from './board/ui';
import { Banner, Button, Chip, Dialog, IconButton, buttonClass, cx, field, type Tone } from './ui';

const WINDOW: Record<ProjectRow['window']['state'], Tone> = { open: 'ok', upcoming: 'warn', none: 'neutral', closed: 'neutral' };

function windowText(p: ProjectRow): string {
  const w = p.window;
  const d = (n: number) => (n === 0 ? 'today' : `in ${n} day${n === 1 ? '' : 's'}`);
  if (w.state === 'open') return w.days !== null ? `Pre-order open · closes ${d(w.days)}` : 'Pre-order open';
  if (w.state === 'upcoming') return `Pre-order opens ${d(w.days!)}`;
  if (w.state === 'closed') return `Pre-order closed ${p.preorderEnd}`;
  return 'No pre-order dates yet';
}

/** BrickLink Designer Program projects you follow, on the Retirement Radar page. */
export function DesignerSection({ projects, money }: { projects: ProjectRow[]; money: Money }) {
  const [editing, setEditing] = useState<ProjectRow | 'new' | null>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [pending, start] = useTransition();
  const act = (fn: () => Promise<Result>, ok: string, after?: () => void) => start(async () => {
    const r = await fn();
    setMessage(r.ok ? { kind: 'ok', text: ok } : { kind: 'error', text: r.error });
    if (r.ok) after?.();
  });
  const toggle = (p: ProjectRow) => act(() => editDesignerProject(p.id, { watching: p.watching ? 'false' : 'true' }), p.watching ? `Alerts off for ${p.name}.` : `Alerts on for ${p.name}.`);

  return (
    <section id="designer" aria-labelledby="r-designer" className="scroll-mt-20 space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="r-designer" className="text-xl font-extrabold tracking-tight">BrickLink Designer Program</h2>
          <p className="max-w-prose text-sm text-fg-3">Projects you follow from crowdfunding to pre-order. These sets are made once and retire when the window closes. Watched projects send an alert a week before the pre-order opens and 3 days before it closes. BrickLink has no API for the program, so add projects and dates yourself or through the API.</p>
        </div>
        <Button icon={Plus} onClick={() => setEditing('new')}>Follow a project</Button>
      </div>
      {message && <Banner kind={message.kind} onDismiss={() => setMessage(null)}>{message.text}</Banner>}
      {projects.length === 0 ? (
        <p className="text-sm text-fg-3">Nothing followed yet.</p>
      ) : (
        <ul className="divide-y divide-line border-y border-line">
          {projects.map((p) => (
            <li key={p.id} className={cx('grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 py-3', p.window.state === 'closed' && 'opacity-70')}>
              <span className="min-w-0">
                <span className="block truncate font-semibold">
                  {p.setNo && <span className="tabular-nums text-fg-3">{displayNo(p.setNo)} </span>}{p.name}
                </span>
                <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-fg-3">
                  <Chip tone={WINDOW[p.window.state]}>{windowText(p)}</Chip>
                  <Chip>{STAGE_LABEL[p.stage]}</Chip>
                  {p.owned > 0 && <Chip tone="ok">You own {p.owned}</Chip>}
                  {p.wished && <Chip tone="primary">Wishlist</Chip>}
                  {[p.series, p.designer && `by ${p.designer}`, p.pieces && `${p.pieces.toLocaleString()} pieces`].filter(Boolean).join(' · ')}
                </span>
                {p.notes && <span className="mt-0.5 block truncate text-xs text-fg-3">{p.notes}</span>}
              </span>
              <span className="flex flex-col items-end gap-1">
                <span className="font-extrabold tabular-nums [font-stretch:112%]">{p.price != null ? money(p.price) : '—'}</span>
                <span className="flex items-center gap-0.5">
                  {p.setNo && !p.owned && !p.wished && p.window.state !== 'closed' && (
                    <IconButton icon={Heart} label="Add to wishlist" disabled={pending} onClick={() => act(() => addWish({ setNo: p.setNo, name: p.name, condition: 'New', target: p.price ?? '' }), `Added ${p.name} to your wishlist.`)} />
                  )}
                  <IconButton icon={p.watching ? BellRing : BellOff} label={p.watching ? 'Alerts on: turn off' : 'Alerts off: turn on'} disabled={pending} onClick={() => toggle(p)} />
                  {p.url && <a href={p.url} target="_blank" rel="noreferrer" aria-label="Open project page" title="Open project page" className={cx(buttonClass('ghost', 'sm'), 'size-8 px-0')}><ExternalLink aria-hidden className="size-4" /></a>}
                  <IconButton icon={Pencil} label="Edit" onClick={() => setEditing(p)} />
                  <IconButton icon={Trash2} label="Stop following" tone="danger" disabled={pending} onClick={() => act(() => removeDesignerProject(p.id), `Stopped following ${p.name}.`)} />
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {editing && (
        <ProjectForm
          p={editing === 'new' ? null : editing}
          pending={pending}
          onClose={() => setEditing(null)}
          onSubmit={(form) => act(() => (editing === 'new' ? addDesignerProject(form) : editDesignerProject(editing.id, form)), editing === 'new' ? 'Following.' : 'Saved.', () => setEditing(null))}
        />
      )}
    </section>
  );
}

function ProjectForm({ p, pending, onClose, onSubmit }: { p: ProjectRow | null; pending: boolean; onClose: () => void; onSubmit: (f: Record<string, unknown>) => void }) {
  return (
    <Dialog
      title={p ? `Edit ${p.name}` : 'Follow a Designer Program project'}
      onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" type="submit" form="bdp-form" loading={pending}>{pending ? 'Saving…' : 'Save'}</Button></>}
    >
      <form id="bdp-form" className="space-y-4 px-5 py-4" onSubmit={(e) => { e.preventDefault(); onSubmit(Object.fromEntries(new FormData(e.currentTarget))); }}>
        <label className="block text-sm">Name
          <input name="name" defaultValue={p?.name ?? ''} required maxLength={120} className={field} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm">Set # <span className="text-fg-3">(once it has one)</span>
            <input name="setNo" defaultValue={p?.setNo ? displayNo(p.setNo) : ''} pattern="\d{3,7}(-\d{1,2})?" inputMode="numeric" placeholder="910038" className={field} />
          </label>
          <label className="block text-sm">Stage
            <select name="stage" defaultValue={p?.stage ?? ''} className={field}>
              {!p && <option value="">(from the dates)</option>}
              {STAGES.map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
            </select>
          </label>
          <label className="block text-sm">Series
            <input name="series" defaultValue={p?.series ?? ''} maxLength={60} placeholder="Series 9" className={field} />
          </label>
          <label className="block text-sm">Designer
            <input name="designer" defaultValue={p?.designer ?? ''} maxLength={80} className={field} />
          </label>
          <label className="block text-sm">Pre-order opens
            <input name="preorderStart" type="date" defaultValue={p?.preorderStart ?? ''} className={field} />
          </label>
          <label className="block text-sm">Pre-order closes
            <input name="preorderEnd" type="date" defaultValue={p?.preorderEnd ?? ''} className={field} />
          </label>
          <label className="block text-sm">Price
            <input name="price" type="number" min={0} step="0.01" defaultValue={p?.price ?? ''} className={field} />
          </label>
          <label className="block text-sm">Pieces
            <input name="pieces" type="number" min={0} step={1} defaultValue={p?.pieces ?? ''} className={field} />
          </label>
        </div>
        <label className="block text-sm">Link
          <input name="url" type="url" defaultValue={p?.url ?? ''} placeholder="https://www.bricklink.com/…" pattern="https://.*" className={field} />
        </label>
        <label className="block text-sm">Notes
          <textarea name="notes" defaultValue={p?.notes ?? ''} maxLength={2000} rows={2} className={field} />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input name="watching" type="checkbox" value="true" defaultChecked={p ? p.watching : true} className="size-4 accent-[var(--primary)]" />
          Alert me before the pre-order opens and closes
        </label>
      </form>
    </Dialog>
  );
}
