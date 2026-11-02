import { api, json } from '@/lib/api';
import { listOrders, orderTotals } from '@/lib/service/store';

/** GET /api/v1/orders?direction=in|out – BrickLink orders (in = sold, out = bought), newest first. */
export const GET = api(async (req, { db }) => {
  const d = new URL(req.url).searchParams.get('direction');
  if (d && d !== 'in' && d !== 'out') return json({ error: 'direction must be in or out' }, 400);
  const orders = (await listOrders(db, (d as 'in' | 'out' | null) ?? undefined)).map(({ syncedAt: _, ...o }) => o);
  return json({ orders, totals: orderTotals(orders) });
});
