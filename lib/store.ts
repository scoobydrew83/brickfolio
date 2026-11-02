// Framework-free totals for store inventory and orders, shared by the server and the browser.
import type { InventoryItem, Order } from './bricklink/client';

/** Lots, items and asking value (qty × unit price) for inventory. */
export function inventoryTotals(items: InventoryItem[]) {
  return {
    lots: items.length,
    qty: items.reduce((t, i) => t + i.qty, 0),
    value: items.reduce((t, i) => t + i.qty * (i.unitPrice ?? 0), 0),
  };
}

/** Count and grand total per direction. */
export function orderTotals(list: Order[]) {
  const sum = (d: 'in' | 'out') => {
    const o = list.filter((x) => x.direction === d);
    return { count: o.length, items: o.reduce((t, x) => t + (x.items ?? 0), 0), total: o.reduce((t, x) => t + (x.grandTotal ?? 0), 0) };
  };
  return { in: sum('in'), out: sum('out') };
}
