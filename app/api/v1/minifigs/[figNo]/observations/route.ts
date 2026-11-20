import { api, json } from '@/lib/api';
import { figRows } from '@/lib/service/minifigs';
import { can } from '@/lib/service/permissions';
import { listObservations, observationFilters } from '@/lib/service/prices';

/** GET /api/v1/minifigs/:figNo/observations – every stored price for a figure you can see, newest first (?source=, ?type=). */
export const GET = api<{ figNo: string }>('member', async (req, { db, access, params }) => {
  const f = observationFilters(req.url);
  if (!f.ok) return json({ error: f.error }, 400);
  const m = (await figRows(db, params.figNo)).find((r) => can(access, { action: 'read', collectionId: r.collectionId })); // #50
  if (!m) return json({ error: 'Not found' }, 404);
  return json({ observations: m.figNo ? await listObservations(db, 'minifig', m.figNo, f.value) : [] }); // Rebrickable-only figures aren't priced
});
