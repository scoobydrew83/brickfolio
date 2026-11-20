import { api, body, fromResult, json } from '@/lib/api';
import { addCollection, collectionCounts, listCollections } from '@/lib/service/collections';

/** GET /api/v1/collections – collections in display order, with how many copies and minifigures each holds. */
export const GET = api('member', async (_req, { db, access }) => {
  const counts = await collectionCounts(db);
  // Only the collections you can see (#50), with your role in each.
  return json({ collections: (await listCollections(db)).filter((c) => access.admin || access.roles.has(c.id)).map((c) => ({ ...c, role: access.admin ? 'admin' : access.roles.get(c.id) })).map((c) => ({ ...c, ...(counts.get(c.id) ?? { copies: 0, minifigs: 0 }) })) });
});

/** POST /api/v1/collections – { name } adds a collection. */
export const POST = api('admin', async (req, { db }) => fromResult(await addCollection(db, (await body(req))?.name), 201));
