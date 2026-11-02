import { api, json } from '@/lib/api';
import { ensureColors, searchParts } from '@/lib/service/parts';
import { brickColors } from '@/lib/session';

/** GET /api/v1/parts?q=&type=&limit=&offset= – parts across every set (max 1000 per page). */
export const GET = api(async (req, { db }) => {
  const p = new URL(req.url).searchParams;
  await ensureColors(db, brickColors());
  return json(await searchParts(db, {
    q: p.get('q') ?? undefined, type: p.get('type') ?? undefined,
    limit: Number(p.get('limit')) || 200, offset: Number(p.get('offset')) || 0,
  }));
});
