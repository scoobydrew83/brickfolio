'use client';
import Image from 'next/image';
import { useMemo, useState } from 'react';
import { itemImage, itemPage } from '@/lib/bricklink/links';
import type { InventoryItem } from '@/lib/bricklink/client';
import { inventoryTotals } from '@/lib/store';
import { moneyIn } from './board/ui';
import { Button, Callout, EmptyState, SearchInput, Select } from './ui';

const PAGE = 200;
type Sort = 'item' | 'value' | 'qty' | 'name';

/** Your BrickLink store's lots: search, filter by type and condition, totals. */
export default function StoreView({ items, currency, syncedAt }: { items: InventoryItem[]; currency: string; syncedAt: string | null }) {
  const money = useMemo(() => moneyIn(currency), [currency]);
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const [cond, setCond] = useState('');
  const [sort, setSort] = useState<Sort>('item');
  const [limit, setLimit] = useState(PAGE);

  const types = useMemo(() => [...new Set(items.map((i) => i.type))].sort(), [items]);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const by: Record<Sort, (a: InventoryItem, b: InventoryItem) => number> = {
      item: (a, b) => a.itemNo.localeCompare(b.itemNo, undefined, { numeric: true }),
      name: (a, b) => a.name.localeCompare(b.name),
      qty: (a, b) => b.qty - a.qty,
      value: (a, b) => b.qty * (b.unitPrice ?? 0) - a.qty * (a.unitPrice ?? 0),
    };
    return items
      .filter((i) => (!type || i.type === type) && (!cond || i.condition === cond) &&
        (!needle || [i.itemNo, i.name, i.colorName, i.remarks, i.description].some((v) => String(v ?? '').toLowerCase().includes(needle))))
      .sort(by[sort]);
  }, [items, q, type, cond, sort]);
  const all = inventoryTotals(items), view = inventoryTotals(shown);

  return (
    <div className="space-y-6">
      {items.length > 0 && (
        <p className="text-sm text-fg-3 tabular-nums">
          Asking <b className="text-lg font-extrabold text-fg [font-stretch:112%]">{money(all.value)}</b> for {all.lots.toLocaleString()} lots, {all.qty.toLocaleString()} items (quantity × your unit price)
        </p>
      )}

      {items.length === 0 ? (
        <EmptyState title="No store inventory yet">
          Run <b>Sync BrickLink</b> on the Sets page to load it.
        </EmptyState>
      ) : (
        <>
          <div className="space-y-2">
            <div className="flex flex-wrap gap-3">
              <SearchInput value={q} onChange={(e) => { setQ(e.target.value); setLimit(PAGE); }} placeholder="Search item #, name, color, remarks…" aria-label="Search store" />
              <Select aria-label="Type" value={type} onChange={(e) => setType(e.target.value)} options={[['', 'All types'], ...types.map((t) => [t, t.replace('_', ' ').toLowerCase()])]} />
              <Select aria-label="Condition" value={cond} onChange={(e) => setCond(e.target.value)} options={[['', 'New and used'], ['N', 'New'], ['U', 'Used']]} />
              <Select aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value as Sort)} options={[['item', 'Item #'], ['name', 'Name'], ['qty', 'Most items'], ['value', 'Highest value']]} />
            </div>
            <p className="text-sm text-fg-3">
              Showing <b>{shown.length.toLocaleString()}</b> of {all.lots.toLocaleString()} lots · {view.qty.toLocaleString()} items · <b className="text-ok">{money(view.value)}</b>
              {syncedAt && <> · Synced {syncedAt.slice(0, 10)}</>}
            </p>
          </div>

          <Callout className="overflow-hidden"><ul className="divide-y divide-line">
            {shown.slice(0, limit).map((i) => (
              <li key={i.inventoryId} className="flex items-center gap-3 p-3">
                <a href={itemPage(i.type, i.itemNo)} target="_blank" rel="noreferrer" className="flex size-14 shrink-0 items-center justify-center rounded-control bg-tile">
                  <Image src={itemImage(i.type, i.itemNo, i.colorId)} alt="" width={56} height={56} className="max-h-14 w-auto object-contain" />
                </a>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{i.colorName && i.type === 'PART' ? `${i.colorName} ` : ''}{i.name}</p>
                  <p className="text-xs text-fg-3">
                    <span className="font-mono">{i.itemNo}</span> · {i.type.toLowerCase()} · {i.condition === 'N' ? 'New' : 'Used'}
                    {i.remarks && <> · {i.remarks}</>}
                  </p>
                </div>
                <div className="shrink-0 text-right text-sm tabular-nums">
                  <p><b>{i.qty.toLocaleString()}</b> × {money(i.unitPrice)}</p>
                  <p className="text-xs text-fg-3">{money(i.qty * (i.unitPrice ?? 0))}</p>
                </div>
              </li>
            ))}
          </ul></Callout>
          {shown.length > limit && (
            <Button onClick={() => setLimit(limit + PAGE)} className="w-full">
              Show {Math.min(PAGE, shown.length - limit)} more
            </Button>
          )}
        </>
      )}
    </div>
  );
}
