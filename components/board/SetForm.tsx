import { useEffect, useState } from 'react';
import { priceHistoryFor } from '@/app/actions';
import { CONDITIONS, REGISTERED, displayNo, type SetRow } from '@/lib/sets';
import type { Money } from './ui';
import { Button, Dialog, field } from '../ui';

type Dupe = { name: string; qty: number } | null;
type Props = { set: SetRow | null; locations: string[]; pending: boolean; dupe: Dupe; money: Money; onClose: () => void; onAddAnother: () => void; onSubmit: (form: Record<string, unknown>) => void };

export function SetForm({ set, locations, pending, dupe, money, onClose, onAddAnother, onSubmit }: Props) {
  const footer = dupe ? (
    <>
      <Button variant="ghost" onClick={onClose}>Skip</Button>
      <Button variant="primary" loading={pending} onClick={onAddAnother}>Add another (makes {dupe.qty + 1})</Button>
    </>
  ) : (
    <>
      <Button variant="ghost" onClick={onClose}>Cancel</Button>
      <Button variant="primary" type="submit" form="set-form" loading={pending}>{pending ? 'Saving…' : 'Save'}</Button>
    </>
  );
  return (
    <Dialog title={set ? `Edit #${displayNo(set.setNo)}` : 'Add a set'} subtitle={set?.name} onClose={onClose} footer={footer}>
      <form
        id="set-form"
        className="space-y-4 px-5 py-4"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(Object.fromEntries(new FormData(e.currentTarget)));
        }}
      >
        <label className="block text-sm">Set #
          <input name="setNo" defaultValue={set ? displayNo(set.setNo) : ''} readOnly={!!set} required pattern="\d{3,7}(-\d{1,2})?" placeholder="10280" inputMode="numeric" className={`${field} ${set ? 'bg-muted' : ''}`} />
        </label>
        <label className="block text-sm">Name
          <input name="name" defaultValue={set?.name ?? ''} required={!set} maxLength={120} className={field} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm">Location
            <select name="location" defaultValue={set?.location ?? ''} className={field}>
              <option value="">(none)</option>
              {locations.map((l) => <option key={l}>{l}</option>)}
            </select>
          </label>
          <label className="block text-sm">Condition
            <select name="condition" defaultValue={set?.condition || 'Used'} className={field}>
              {CONDITIONS.map((c) => <option key={c}>{c}</option>)}
            </select>
          </label>
          <label className="block text-sm">Registered
            <select name="registered" defaultValue={set?.registered ?? ''} className={field}>
              <option value="">(blank)</option>
              {REGISTERED.map((r) => <option key={r}>{r}</option>)}
            </select>
          </label>
          <label className="block text-sm">Missing %
            <input name="missingPct" type="number" min={0} max={100} step="any" defaultValue={set?.missingPct ?? ''} placeholder="0" className={field} />
          </label>
          {set && (
            <label className="block text-sm">Qty
              <input name="qty" type="number" min={1} max={999} step={1} required defaultValue={set.qty} className={field} />
            </label>
          )}
        </div>
        <label className="block text-sm">Notes
          <textarea name="notes" defaultValue={set?.notes ?? ''} maxLength={2000} rows={2} className={field} />
        </label>
        <p className="text-xs text-fg-3">New sets are priced at the new sold price; Used and Partial at the used price. Est. Value subtracts Missing %.</p>
        {set && <PriceTrend setNo={set.setNo} money={money} />}
        {dupe && (
          <p role="alert" className="rounded-control bg-warn-soft p-3 text-sm text-warn ring-1 ring-warn-ring">
            Already in stock: you have <b>{dupe.qty}</b> of <b>{dupe.name}</b>. Add another one?
          </p>
        )}
      </form>
    </Dialog>
  );
}

/** Avg sold price per sync for one set, as a small sparkline. Hidden until there are two points. */
function PriceTrend({ setNo, money }: { setNo: string; money: Money }) {
  const [points, setPoints] = useState<{ date: string; avgSold: number | null }[]>([]);
  useEffect(() => { priceHistoryFor(setNo).then(setPoints, () => {}); }, [setNo]);
  const p = points.filter((x): x is { date: string; avgSold: number } => x.avgSold !== null);
  if (p.length < 2) return null;
  const v = p.map((x) => x.avgSold), lo = Math.min(...v), hi = Math.max(...v);
  const pts = v.map((y, i) => `${(i / (v.length - 1)) * 100},${hi === lo ? 15 : 28 - ((y - lo) / (hi - lo)) * 26}`).join(' ');
  return (
    <div className="rounded-control bg-subtle p-2 text-xs text-fg-2">
      <div className="flex justify-between"><span>Avg sold since {p[0].date}</span><b>{money(v[0])} → {money(v[v.length - 1])}</b></div>
      <svg viewBox="0 0 100 30" preserveAspectRatio="none" className="mt-1 h-8 w-full" aria-hidden>
        <polyline points={pts} fill="none" stroke="var(--primary)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  );
}
