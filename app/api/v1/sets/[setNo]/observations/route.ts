import { api, json } from '@/lib/api';
import { setNo } from '@/lib/sets';
import { getSet } from '@/lib/service/sets';
import { listObservations, observationFilters } from '@/lib/service/prices';

/** GET /api/v1/sets/:setNo/observations – every stored price for a set, newest first (?source=, ?type=). */
export const GET = api<{ setNo: string }>(async (req, { db, params }) => {
  const f = observationFilters(req.url);
  if (!f.ok) return json({ error: f.error }, 400);
  const s = await getSet(db, setNo(params.setNo));
  return s ? json({ observations: await listObservations(db, 'set', s.setNo, f.value) }) : json({ error: 'Not found' }, 404);
});
