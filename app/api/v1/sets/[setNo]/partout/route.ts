import { api, json } from '@/lib/api';
import { setNo } from '@/lib/sets';
import { getCurrency, getSet } from '@/lib/service/sets';
import { partout, unpricedLots } from '@/lib/service/partout';

/**
 * GET /api/v1/sets/:setNo/partout – what the set is worth sold as parts, from cached BrickLink part prices,
 * next to its complete value. `coverage` is the share of pieces with a price.
 */
export const GET = api<{ setNo: string }>(async (_req, { db, params }) => {
  const s = await getSet(db, setNo(params.setNo));
  if (!s) return json({ error: 'Not found' }, 404);
  const currency = await getCurrency(db);
  const p = await partout(db, s.id, s.condition, currency);
  return json({ partout: { ...p, currency, complete: s.avgSold, unpriced: await unpricedLots(db, s.id, s.condition, currency) } });
});
