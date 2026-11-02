// Your BrickLink store: inventory lots and orders, refreshed by each sync (the sheet's Inventory and Orders tabs).
import { asc, desc, eq } from 'drizzle-orm';
import type { InventoryItem, Order, Store } from '../bricklink/client';
import { insertChunked } from '../db/chunk';
import { orders, storeInventory } from '../db/schema';
import type { DB } from '../db/types';

export type { InventoryItem, Order } from '../bricklink/client';
export { inventoryTotals, orderTotals } from '../store';

/**
 * Fetches inventory and both order directions and replaces the stored copies. Each part is replaced only if
 * its fetch worked, so a BrickLink error keeps the last good data. Returns the errors, if any.
 */
export async function syncStore(db: DB, store: Store): Promise<string[]> {
  const errors: string[] = [];
  const syncedAt = new Date().toISOString();
  const attempt = async <T>(label: string, fetch: () => Promise<T>, save: (data: T) => Promise<void>) => {
    let data: T;
    try { data = await fetch(); } catch (e) { errors.push(`${label}: ${e instanceof Error ? e.message : String(e)}`); return; }
    await save(data);
  };
  await attempt('Store inventory', store.inventory, async (items) => {
    await db.delete(storeInventory);
    await insertChunked(items.map((i) => ({ ...i, syncedAt })), (c) => db.insert(storeInventory).values(c).onConflictDoNothing());
  });
  for (const direction of ['in', 'out'] as const) {
    await attempt(`Orders ${direction === 'in' ? 'received' : 'placed'}`, () => store.orders(direction), async (list) => {
      await db.delete(orders).where(eq(orders.direction, direction));
      await insertChunked(list.map((o) => ({ ...o, syncedAt })), (c) => db.insert(orders).values(c).onConflictDoNothing());
    });
  }
  return errors;
}

export async function listInventory(db: DB): Promise<(InventoryItem & { syncedAt: string })[]> {
  return db.select().from(storeInventory).orderBy(asc(storeInventory.type), asc(storeInventory.itemNo)).all();
}

export async function listOrders(db: DB, direction?: 'in' | 'out'): Promise<(Order & { syncedAt: string })[]> {
  const q = db.select().from(orders);
  return (direction ? q.where(eq(orders.direction, direction)) : q).orderBy(desc(orders.dateOrdered), desc(orders.orderId)).all();
}
