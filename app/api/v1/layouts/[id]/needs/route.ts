import { api, json } from '@/lib/api';
import { layoutNeeds } from '@/lib/service/layouts';
import { readable } from '@/lib/service/permissions';
import { idOf } from '../params';

/** GET /api/v1/layouts/:id/needs – every part the layout still needs, totalled across its builds and set copies. */
export const GET = api<{ id: string }>('member', async (_req, { db, params, access }) => {
  const id = idOf(params.id);
  const n = id === null ? undefined : await layoutNeeds(db, id, readable(access));
  return n ? json(n) : json({ error: 'Layout not found.' }, 404);
});
