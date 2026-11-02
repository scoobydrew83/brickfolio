import { api, json } from '@/lib/api';
import { buildMatches } from '@/lib/service/builds';

/** GET /api/v1/builds[?set=31120] – alternate builds of your sets and how much of each you can make. */
export const GET = api(async (req, { db }) => {
  const set = new URL(req.url).searchParams.get('set') ?? undefined;
  return json({ builds: await buildMatches(db, { sourceSetNo: set }) });
});
