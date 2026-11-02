import { api, json } from '@/lib/api';
import { setNo } from '@/lib/sets';
import { getSet, priceHistory } from '@/lib/service/sets';

/** GET /api/v1/sets/:setNo/prices – sold prices per day for one set. */
export const GET = api<{ setNo: string }>(async (_req, { db, params }) => {
  const s = await getSet(db, setNo(params.setNo));
  return s ? json({ prices: (await priceHistory(db, s.id)).map(({ setId: _, ...p }) => p) }) : json({ error: 'Not found' }, 404);
});
