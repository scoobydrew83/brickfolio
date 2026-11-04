import { api, fromResult, json } from '@/lib/api';
import { revokeShareLink } from '@/lib/service/share';

/** DELETE /api/v1/share-links/:id – revoke a link. It stops working at once. */
export const DELETE = api<{ id: string }>(async (_req, { db, params }) => {
  if (!/^\d+$/.test(params.id)) return json({ error: 'Share link not found.' }, 404);
  return fromResult(await revokeShareLink(db, Number(params.id)));
});
