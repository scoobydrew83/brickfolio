import { api, fromResult, json } from '@/lib/api';
import { revokeShareLink, shareLinkCollection } from '@/lib/service/share';
import { shareNeed } from '@/lib/service/permissions';

/** DELETE /api/v1/share-links/:id – revoke a link. It stops working at once. */
export const DELETE = api<{ id: string }>('member', async (_req, { db, params, need }) => {
  if (!/^\d+$/.test(params.id)) return json({ error: 'Share link not found.' }, 404);
  const c = await shareLinkCollection(db, Number(params.id));
  if (c === undefined) return json({ error: 'Share link not found.' }, 404);
  need(shareNeed(c));
  return fromResult(await revokeShareLink(db, Number(params.id)));
});
