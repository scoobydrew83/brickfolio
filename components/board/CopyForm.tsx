import { CONDITIONS, STATUSES, STATUS_LABEL, type CopyRow } from '@/lib/sets';
import { Button, DatePicker, Dialog, field } from '../ui';
import { LocationPicker } from '../LocationPicker';

/** `collections` (#49): shown as a Collection field when there are two or more; `collection` is a new copy's default. */
type Collections = { collections?: { id: number; name: string }[]; collection?: number };
type Props = { copy: CopyRow | null; title: string; locations: string[]; pending: boolean; onClose: () => void; onSubmit: (form: Record<string, unknown>) => void } & Collections;

/** Add or edit one copy of a set: status, condition, location, dates, what it cost, and notes. */
export function CopyForm({ copy, title, locations, pending, onClose, onSubmit, collections, collection }: Props) {
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
        <CopyFields copy={copy} locations={locations} collections={collections} collection={collection} />
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
export function CopyFields({ copy, locations, withPlace = true, collections = [], collection }: { copy: CopyRow | null; locations: string[]; withPlace?: boolean } & Collections) {
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
        <select name="status" defaultValue={copy?.status ?? ''} className={field}>
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
        <input name="pricePaid" type="number" min={0} max={1000000} step="0.01" defaultValue={copy?.pricePaid ?? ''} className={field} />
      </label>
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
      <p className="col-span-2 text-xs text-fg-3">Sealed copies are priced at the new sold price; built and Partial copies at the used price.</p>
    </div>
  );
}
