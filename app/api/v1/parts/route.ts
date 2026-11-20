import { api, json } from '@/lib/api';
import { ensureColors, searchParts } from '@/lib/service/parts';
import { brickColors } from '@/lib/session';

/** GET /api/v1/parts?q=&type=&limit=&offset=[&collection=] – parts across every set you can see (max 1000 per page). */
export const GET = api('member', async (req, { db, scope }) => {
  const p = new URL(req.url).searchParams;
  await ensureColors(db, brickColors());
  return json(await searchParts(db, {
    q: p.get('q') ?? undefined, type: p.get('type') ?? undefined,
    limit: Number(p.get('limit')) || 200, offset: Number(p.get('offset')) || 0, collectionId: await scope(req),
  }));
});
