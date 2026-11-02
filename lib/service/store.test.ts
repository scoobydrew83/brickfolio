import { expect, it } from 'vitest';
import type { InventoryItem, Order, Store } from '../bricklink/client';
import { openNodeDb } from '../db/node';
import { inventoryTotals, listInventory, listOrders, orderTotals, syncStore } from './store';

const item = (i: number): InventoryItem => ({
  inventoryId: i, itemNo: `3001-${i}`, name: 'Brick 2 x 4', type: 'PART', colorId: 5, colorName: 'Red', qty: 2,
  condition: 'U', unitPrice: 0.5, description: null, remarks: null,
});
const order = (id: number, direction: 'in' | 'out', grandTotal: number): Order => ({
  orderId: id, direction, dateOrdered: `2026-10-${10 + id}T00:00:00.000Z`, status: 'COMPLETED', counterparty: 'someone',
  items: 3, lots: 1, currency: 'USD', subtotal: grandTotal - 1, grandTotal,
});

it('replaces inventory and orders on each sync, in chunks, and keeps old data when a fetch fails', async () => {
  const { db } = openNodeDb(':memory:');
  let fail = false;
  const store: Store = {
    inventory: async () => { if (fail) throw new Error('inventories: Invalid IP'); return Array.from({ length: 30 }, (_, i) => item(i + 1)); },
    orders: async (d) => (d === 'in' ? [order(1, 'in', 20), order(2, 'in', 10)] : [order(3, 'out', 7)]),
  };
  expect(await syncStore(db, store)).toEqual([]);
  const inv = await listInventory(db);
  expect(inv).toHaveLength(30); // more than one 8-row chunk
  expect(inventoryTotals(inv)).toEqual({ lots: 30, qty: 60, value: 30 });
  const all = await listOrders(db);
  expect(all.map((o) => o.orderId)).toEqual([3, 2, 1]); // newest first
  expect(orderTotals(all)).toEqual({ in: { count: 2, items: 6, total: 30 }, out: { count: 1, items: 3, total: 7 } });
  expect(await listOrders(db, 'out')).toHaveLength(1);

  fail = true;
  expect(await syncStore(db, store)).toEqual(['Store inventory: inventories: Invalid IP']);
  expect(await listInventory(db)).toHaveLength(30); // kept
});
