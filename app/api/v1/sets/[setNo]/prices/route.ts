import { api, json } from '@/lib/api';
import { readable } from '@/lib/service/permissions';
import { setNo } from '@/lib/sets';
import { getSet, priceHistory } from '@/lib/service/sets';

/** GET /api/v1/sets/:setNo/prices – sold prices per day for one set. */
export const GET = api<{ setNo: string }>('member', async (_req, { db, access, params }) => {
  const s = await getSet(db, setNo(params.setNo), { collectionId: readable(access) }); // only sets you can see (#50)
  return s ? json({ prices: await priceHistory(db, s.setNo) }) : json({ error: 'Not found' }, 404);
});
