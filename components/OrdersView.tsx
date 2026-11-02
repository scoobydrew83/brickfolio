'use client';
import { useMemo, useState } from 'react';
import { orderPage } from '@/lib/bricklink/links';
import { money } from '@/lib/sets';
import type { Order } from '@/lib/bricklink/client';
import { orderTotals } from '@/lib/store';
import { Card, Chip, EmptyState, Segmented, Select } from './ui';

const orders_ = (n: number) => `${n} order${n === 1 ? '' : 's'}`;

/** BrickLink orders: what you sold (in) and what you bought (out). */
export default function OrdersView({ orders, currency }: { orders: Order[]; currency: string }) {
  const [direction, setDirection] = useState<'in' | 'out'>('in');
  const [status, setStatus] = useState('');
  const t = orderTotals(orders);
  const statuses = useMemo(() => [...new Set(orders.filter((o) => o.direction === direction).map((o) => o.status))].sort(), [orders, direction]);
  const shown = orders.filter((o) => o.direction === direction && (!status || o.status === status));
  const m = (v: unknown, c?: string | null) => money(v, c || currency);

  return (
    <div className="space-y-6">
      <section className="flex flex-wrap items-center gap-3">
        <Segmented label="Direction" value={direction} onChange={(d) => { setDirection(d); setStatus(''); }} options={[{ value: 'in', label: `Sold (${t.in.count})` }, { value: 'out', label: `Bought (${t.out.count})` }]} />
        <Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} options={[['', 'All statuses'], ...statuses.map((s) => [s, s.toLowerCase()])]} />
        {t[direction].count > 0 && (
          <p className="ml-auto text-sm text-fg-3 tabular-nums">
            {direction === 'in' ? 'Sold' : 'Bought'} <b className="text-lg font-extrabold text-fg [font-stretch:112%]">{m(t[direction].total)}</b> · {orders_(t[direction].count)} · {t[direction].items.toLocaleString()} items
          </p>
        )}
      </section>

      {shown.length === 0 ? (
        <EmptyState title={orders.length ? 'No orders match' : 'No orders yet'}>
          {orders.length ? 'Try another status.' : <>Run <b>Sync BrickLink</b> on the Sets page to load them.</>}
        </EmptyState>
      ) : (
        <Card as="ul" className="divide-y divide-line">
          {shown.map((o) => (
            <li key={`${o.direction}-${o.orderId}`} className="flex items-center gap-3 p-3 text-sm">
              <div className="min-w-0 flex-1">
                <p className="truncate">
                  <a href={orderPage(o.orderId)} target="_blank" rel="noreferrer" className="font-mono text-link hover:underline">#{o.orderId}</a>
                  {' · '}{o.counterparty ?? '—'}
                </p>
                <p className="text-xs text-fg-3">
                  {o.dateOrdered?.slice(0, 10) ?? '—'} · {o.items ?? 0} items in {o.lots ?? 0} lots ·{' '}
                  <Chip>{o.status.toLowerCase()}</Chip>
                </p>
              </div>
              <div className="shrink-0 text-right tabular-nums">
                <p className="font-semibold">{m(o.grandTotal, o.currency)}</p>
                <p className="text-xs text-fg-3">subtotal {m(o.subtotal, o.currency)}</p>
              </div>
            </li>
          ))}
        </Card>
      )}
    </div>
  );
}
