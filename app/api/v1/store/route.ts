import { api, json } from '@/lib/api';
import { inventoryTotals, listInventory } from '@/lib/service/store';

/** GET /api/v1/store – your BrickLink store's inventory lots (as of the last sync) with totals. */
export const GET = api(async (_req, { db }) => {
  const items = (await listInventory(db)).map(({ syncedAt: _, ...i }) => i);
  return json({ items, totals: inventoryTotals(items) });
});
