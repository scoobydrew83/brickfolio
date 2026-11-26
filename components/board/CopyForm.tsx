import { useState } from 'react';
import { CONDITIONS, STATUSES, STATUS_LABEL, STICKERS, STICKERS_LABEL, type CopyRow } from '@/lib/sets';
import { Button, Combobox, DatePicker, Dialog, field } from '../ui';
import { FX_CURRENCIES } from '@/lib/currencies';
import { LocationPicker } from '../LocationPicker';

/** `collections` (#49): shown as a Collection field when there are two or more; `collection` is a new copy's default. */
type Collections = { collections?: { id: number; name: string }[]; collection?: number; /** The collection currency: prices paid in another one are converted on save. */ currency?: string };
type Props = { copy: CopyRow | null; title: string; locations: string[]; pending: boolean; onClose: () => void; onSubmit: (form: Record<string, unknown>) => void } & Collections;

/** Add or edit one copy of a set: status, condition, location, dates, what it cost, and notes. */
export function CopyForm({ copy, title, locations, pending, onClose, onSubmit, collections, collection, currency }: Props) {
  const footer = (
    <>
      <Button variant="ghost" onClick={onClose}>Cancel</Button>
      <Button variant="primary" type="submit" form="copy-form" loading={pending}>{pending ? 'Saving…' : 'Save'}</Button>
    </>
  );
  return (
    <Dialog title={title} onClose={onClose} footer={footer}>
      <form
        id="copy-form"
        className="space-y-4 px-5 py-4"
        onSubmit={(e) => {
          e.preventDefault();
          const f = Object.fromEntries(new FormData(e.currentTarget));
          onSubmit({ ...f, gwp: f.gwp === 'on' });
        }}
      >
        <CopyFields copy={copy} locations={locations} collections={collections} collection={collection} currency={currency} />
        <label className="block text-sm">Notes about this copy
          <textarea name="notes" defaultValue={copy?.notes ?? ''} maxLength={2000} rows={2} className={field} />
        </label>
      </form>
    </Dialog>
  );
}

/**
 * The copy fields, shared by the copy form and the add-a-set form. `withPlace` shows condition, location and
 * Missing % (the add-a-set form has its own).
 */
export function CopyFields({ copy, locations, withPlace = true, collections = [], collection, currency = 'USD' }: { copy: CopyRow | null; locations: string[]; withPlace?: boolean } & Collections) {
  const foreign = copy?.paidCurrency && copy.paidAmount != null ? { amount: copy.paidAmount, currency: copy.paidCurrency } : null;
  const fmt = (v: number, c: string) => new Intl.NumberFormat(undefined, { style: 'currency', currency: c }).format(v);
  const [status, setStatus] = useState<string>(copy?.status ?? '');
  const yesNo = (v: boolean | null | undefined) => (v == null ? '' : v ? 'yes' : 'no');
  const currencies = [currency, ...FX_CURRENCIES.filter((c) => c !== currency)].map((c) => ({ value: c, label: c === currency ? `${c} (collection)` : c }));
  return (
    <div className="grid grid-cols-2 gap-3">
      {collections.length > 1 && (
        <label className="col-span-2 block text-sm">Collection
          <select name="collectionId" defaultValue={String(copy?.collectionId ?? collection ?? collections[0].id)} className={field}>
            {collections.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
      )}
      <label className="block text-sm">Status
        <select name="status" value={status} onChange={(e) => setStatus(e.target.value)} className={field}>
          {!copy && <option value="">From condition</option>}
          {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
      </label>
      {withPlace && (
        <>
          <label className="block text-sm">Condition
            <select name="condition" defaultValue={copy?.condition ?? 'Used'} className={field}>
              {CONDITIONS.map((c) => <option key={c}>{c}</option>)}
            </select>
          </label>
          <label className="block text-sm">Location
            <LocationPicker name="location" defaultValue={copy?.location ?? ''} locations={locations} />
          </label>
          <label className="block text-sm">Missing %
            {copy?.missingMarked ? (
              <>
                <input type="number" value={copy.missingPct ?? 0} readOnly aria-describedby="copy-missing-computed" className={`${field} bg-muted`} />
                <span id="copy-missing-computed" className="mt-1 block text-xs text-fg-3">From {copy.missingMarked} marked missing piece{copy.missingMarked === 1 ? '' : 's'}.</span>
              </>
            ) : (
              <input name="missingPct" type="number" min={0} max={100} step="any" defaultValue={copy?.missingPct ?? ''} placeholder="0" className={field} />
            )}
          </label>
        </>
      )}
      <label className="block text-sm">Acquired
        <DatePicker name="acquiredDate" label="Acquired" defaultValue={copy?.acquiredDate ?? ''} />
      </label>
      <label className="block text-sm">Built
        <DatePicker name="buildDate" label="Built" defaultValue={copy?.buildDate ?? ''} />
      </label>
      <label className="block text-sm">Price paid
        <input name="pricePaid" type="number" min={0} max={1000000} step="0.01" defaultValue={foreign?.amount ?? copy?.pricePaid ?? ''} className={field} />
      </label>
      <label className="block text-sm">Paid in
        <Combobox name="paidCurrency" label="Paid in" defaultValue={foreign?.currency ?? currency} options={currencies} />
      </label>
      {foreign && copy?.pricePaid != null && (
        <p className="col-span-2 -mt-1 text-xs text-fg-3">{fmt(foreign.amount, foreign.currency)} is {fmt(copy.pricePaid, currency)} at the ECB rate for the acquired date. Tax and shipping are in {currency}.</p>
      )}
      <label className="block text-sm">Tax
        <input name="tax" type="number" min={0} max={1000000} step="0.01" defaultValue={copy?.tax ?? ''} className={field} />
      </label>
      <label className="block text-sm">Shipping
        <input name="shipping" type="number" min={0} max={1000000} step="0.01" defaultValue={copy?.shipping ?? ''} className={field} />
      </label>
      <label className="flex items-center gap-2 self-end pb-2 text-sm">
        <input name="gwp" type="checkbox" defaultChecked={copy?.gwp ?? false} className="size-4" />
        Gift with purchase (cost 0)
      </label>
      <label className="block text-sm">Box
        <select name="hasBox" defaultValue={yesNo(copy?.hasBox)} className={field}>
          <option value="">Not recorded</option><option value="yes">Has the box</option><option value="no">No box</option>
        </select>
      </label>
      <label className="block text-sm">Instructions
        <select name="hasInstructions" defaultValue={yesNo(copy?.hasInstructions)} className={field}>
          <option value="">Not recorded</option><option value="yes">Has them</option><option value="no">Missing</option>
        </select>
      </label>
      <label className="block text-sm">Stickers
        <select name="stickers" defaultValue={copy?.stickers ?? ''} className={field}>
          <option value="">Not recorded</option>
          {STICKERS.map((k) => <option key={k} value={k}>{STICKERS_LABEL[k]}</option>)}
        </select>
      </label>
      <label className="block text-sm">Bought from
        <input name="boughtFrom" maxLength={120} defaultValue={copy?.boughtFrom ?? ''} placeholder="Shop or seller" className={field} />
      </label>
      {status === 'sold' && (
        <fieldset className="col-span-2 grid grid-cols-2 gap-3 rounded-control border border-line p-3">
          <legend className="px-1 text-sm font-semibold">Sale</legend>
          <label className="block text-sm">Sold on
            <DatePicker name="soldDate" label="Sold on" defaultValue={copy?.soldDate ?? ''} />
          </label>
          <label className="block text-sm">Sold via
            <input name="soldVia" maxLength={120} defaultValue={copy?.soldVia ?? ''} placeholder="BrickLink, eBay…" className={field} />
          </label>
          <label className="block text-sm">Sale price ({currency})
            <input name="salePrice" type="number" min={0} max={1000000} step="0.01" defaultValue={copy?.salePrice ?? ''} className={field} />
          </label>
          <label className="block text-sm">Fees and postage
            <input name="saleFees" type="number" min={0} max={1000000} step="0.01" defaultValue={copy?.saleFees ?? ''} className={field} />
          </label>
          <p className="col-span-2 text-xs text-fg-3">Sold copies leave the collection’s count and value. Realised gain is the sale price less fees, less what the copy cost. Without a date, today is used.</p>
        </fieldset>
      )}
      <p className="col-span-2 text-xs text-fg-3">Sealed copies are priced at the new sold price; built and Partial copies at the used price.</p>
    </div>
  );
}
