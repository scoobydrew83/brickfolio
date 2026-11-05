import { api, json } from '@/lib/api';
import { getMinifig } from '@/lib/service/minifigs';
import { listObservations, observationFilters } from '@/lib/service/prices';

/** GET /api/v1/minifigs/:figNo/observations – every stored price for a figure, newest first (?source=, ?type=). */
export const GET = api<{ figNo: string }>(async (req, { db, params }) => {
  const f = observationFilters(req.url);
  if (!f.ok) return json({ error: f.error }, 400);
  const m = await getMinifig(db, params.figNo);
  if (!m) return json({ error: 'Not found' }, 404);
  return json({ observations: m.figNo ? await listObservations(db, 'minifig', m.figNo, f.value) : [] }); // Rebrickable-only figures aren't priced
});
