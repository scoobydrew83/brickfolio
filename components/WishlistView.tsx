'use client';
import Image from 'next/image';
import { useMemo, useState, useTransition } from 'react';
import { Check, ExternalLink, Pencil, Plus, Trash2 } from 'lucide-react';
import { acquireWish, addWish, editWish, removeWish, type Result } from '@/app/actions';
import type { WishRow } from '@/lib/service/wishlist';
import { displayNo } from '@/lib/sets';
import { blLink, moneyIn, type Money } from './board/ui';
import { RetireChip } from './board/SetCard';
import { retirement } from '@/lib/retail';
import { PageHeader } from './shell/PageHeader';
import { Banner, Button, Chip, Dialog, EmptyState, IconButton, buttonClass, cx, field, type Tone } from './ui';

type Status = { tone: Tone; label: string; rank: number };

/** Where a wish stands against its target. Lower rank sorts first. */
function status(w: WishRow): Status {
  if (w.blError) return { tone: 'danger', label: 'Lookup failed', rank: 4 };
  if (w.avgSold === null) return { tone: 'neutral', label: 'No recent sales', rank: 3 };
  if (w.target === null) return { tone: 'neutral', label: 'No target', rank: 2 };
  if (w.avgSold <= w.target) return { tone: 'ok', label: 'Under target', rank: 0 };
  return { tone: 'neutral', label: `${Math.round(((w.avgSold - w.target) / w.target) * 100)}% above`, rank: 1 };
}

export default function WishlistView({ items, currency, priced }: { items: WishRow[]; currency: string; priced: boolean }) {
  const money = useMemo(() => moneyIn(currency), [currency]);
  const [editing, setEditing] = useState<WishRow | 'new' | null>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [pending, start] = useTransition();
  const act = (fn: () => Promise<Result>, ok: string, after?: () => void) =>
    start(async () => {
      const r = await fn();
      setMessage(r.ok ? { kind: 'ok', text: ok } : { kind: 'error', text: r.error });
      if (r.ok) after?.();
    });

  const rows = useMemo(() => items.map((w) => ({ w, s: status(w) })).sort((a, b) => a.s.rank - b.s.rank || (a.w.avgSold ?? 0) / (a.w.target || 1) - (b.w.avgSold ?? 0) / (b.w.target || 1)), [items]);
  const under = rows.filter((r) => r.s.rank === 0).map((r) => r.w);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Wishlist"
        badge={<span className="text-sm text-fg-3 tabular-nums">{items.length} {items.length === 1 ? 'set' : 'sets'}</span>}
        actions={<Button variant="primary" icon={Plus} onClick={() => setEditing('new')}>Add to wishlist</Button>}
      >
        <p>{priced ? 'Prices are BrickLink average sold prices for the condition you want, refreshed in the daily sync.' : 'Add BrickLink API keys to price your wishlist.'}</p>
      </PageHeader>

      {message && <Banner kind={message.kind} onDismiss={() => setMessage(null)}>{message.text}</Banner>}
      {under.length === 1 && (
        <Banner kind="ok">{under[0].name ?? displayNo(under[0].setNo)} is under your target: average sold {money(under[0].avgSold)}, target {money(under[0].target)}.</Banner>
      )}
      {under.length > 1 && <Banner kind="ok">{under.length} sets are under your target. They’re at the top of the list.</Banner>}

      {items.length === 0 ? (
        <EmptyState title="Nothing on your wishlist yet" action={<Button variant="primary" icon={Plus} onClick={() => setEditing('new')}>Add a set</Button>}>
          Add a set and the price you’d pay. Brickfolio tells you when it sells for less.
        </EmptyState>
      ) : (
        <ul className="divide-y divide-line border-y border-line">
          {rows.map(({ w, s }) => (
            <li key={w.id} className="grid grid-cols-[3.5rem_minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 py-4 sm:grid-cols-[4rem_7rem_minmax(0,1fr)_auto_auto]">
              <span className="relative size-14 overflow-hidden rounded-chip bg-tile sm:size-16">
                {w.imageUrl && <Image src={w.imageUrl} alt="" fill sizes="64px" className="object-contain p-1 mix-blend-multiply" />}
              </span>
              <span className="hidden text-2xl font-extrabold tracking-tight tabular-nums [font-stretch:115%] sm:block">{displayNo(w.setNo)}</span>
              <span className="min-w-0">
                <span className="block truncate font-semibold">{w.name ?? `Set ${displayNo(w.setNo)}`}</span>
                <span className="block text-xs text-fg-3">
                  <span className="font-semibold tabular-nums sm:hidden">{displayNo(w.setNo)} · </span>
                  Target {w.target === null ? 'not set' : money(w.target)} · {w.condition}{w.year ? ` · ${w.year}` : ''}
                  {w.retailPrice ? ` · Retail ${moneyIn(w.retailCurrency ?? 'USD')(w.retailPrice)}` : ''}
                </span>
                {(() => { const ret = retirement(w); return ret && <span className="mt-1 block"><RetireChip ret={ret} /></span>; })()}
                {w.blError && <span className="block text-xs text-danger">{w.blError}</span>}
              </span>
              <span className="flex flex-col items-end gap-1 text-right">
                <span className="text-lg font-extrabold tabular-nums [font-stretch:112%]">{money(w.avgSold)}</span>
                <Chip tone={s.tone}>{s.label}</Chip>
              </span>
              <span className="col-span-3 flex items-center justify-end gap-0.5 sm:col-span-1">
                <Button size="sm" icon={Check} disabled={pending} onClick={() => act(() => acquireWish(w.setNo), `Added ${w.name ?? displayNo(w.setNo)} to your sets.`)}>Got it</Button>
                <a href={blLink(w.setNo)} target="_blank" rel="noreferrer" aria-label="Open on BrickLink" title="Open on BrickLink" className={cx(buttonClass('ghost', 'sm'), 'size-8 px-0')}><ExternalLink aria-hidden className="size-4" /></a>
                <IconButton icon={Pencil} label="Edit" onClick={() => setEditing(w)} />
                <IconButton icon={Trash2} label="Remove from wishlist" tone="danger" disabled={pending} onClick={() => act(() => removeWish(w.setNo), `Removed ${w.name ?? displayNo(w.setNo)} from your wishlist.`)} />
              </span>
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <WishForm
          wish={editing === 'new' ? null : editing}
          pending={pending}
          money={money}
          onClose={() => setEditing(null)}
          onSubmit={(form) => act(() => (editing === 'new' ? addWish(form) : editWish(form)), editing === 'new' ? 'Added to your wishlist.' : 'Saved.', () => setEditing(null))}
        />
      )}
    </div>
  );
}

function WishForm({ wish, pending, money, onClose, onSubmit }: { wish: WishRow | null; pending: boolean; money: Money; onClose: () => void; onSubmit: (form: Record<string, unknown>) => void }) {
  return (
    <Dialog
      title={wish ? `Edit ${displayNo(wish.setNo)}` : 'Add to wishlist'}
      subtitle={wish?.name ?? undefined}
      onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" type="submit" form="wish-form" loading={pending}>{pending ? 'Saving…' : 'Save'}</Button></>}
    >
      <form id="wish-form" className="space-y-4 px-5 py-4" onSubmit={(e) => { e.preventDefault(); onSubmit(Object.fromEntries(new FormData(e.currentTarget))); }}>
        <label className="block text-sm">Set #
          <input name="setNo" defaultValue={wish ? displayNo(wish.setNo) : ''} readOnly={!!wish} required pattern="\d{3,7}(-\d{1,2})?" placeholder="10316" inputMode="numeric" className={`${field} ${wish ? 'bg-muted' : ''}`} />
        </label>
        {!wish && (
          <label className="block text-sm">Name <span className="text-fg-3">(optional, filled in from BrickLink)</span>
            <input name="name" maxLength={120} className={field} />
          </label>
        )}
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm">Condition
            <select name="condition" defaultValue={wish?.condition ?? 'New'} className={field}>
              <option>New</option><option>Used</option>
            </select>
          </label>
          <label className="block text-sm">Target price
            <input name="target" type="number" min={0} step="0.01" defaultValue={wish?.target ?? ''} placeholder="430" className={field} />
          </label>
        </div>
        {wish?.avgSold != null && <p className="text-xs text-fg-3">Average sold now: {money(wish.avgSold)}.</p>}
        <label className="block text-sm">Notes
          <textarea name="notes" defaultValue={wish?.notes ?? ''} maxLength={2000} rows={2} className={field} />
        </label>
      </form>
    </Dialog>
  );
}
