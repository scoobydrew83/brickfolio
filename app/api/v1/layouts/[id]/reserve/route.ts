import { api, fromResult, json } from '@/lib/api';
import { reserveForLayout } from '@/lib/service/layouts';
import { idOf } from '../params';

/** POST /api/v1/layouts/:id/reserve – reserve loose parts for every build on the layout. */
export const POST = api<{ id: string }>(async (_req, { db, params }) => {
  const id = idOf(params.id);
  return id === null ? json({ error: 'Layout not found.' }, 404) : fromResult(await reserveForLayout(db, id));
});
