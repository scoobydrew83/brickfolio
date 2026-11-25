import { api, HttpError, json } from '@/lib/api';
import { authMode } from '@/lib/auth';
import { parseQuery } from '@/lib/search';
import { searchEverything } from '@/lib/service/search';

/**
 * GET /api/v1/search?q=[&collection=] – the command palette's search (#107): pages, sets, minifigures, wishlist items,
 * parts and loose parts matching `q`, at most 8 per group, only from what you may read. Under 2 characters: nothing.
 */
export const GET = api('signed-in', async (req, { db, access, scope }) => {
  const p = parseQuery(new URL(req.url).searchParams.get('q'));
  if (!p.ok) throw new HttpError(400, p.error);
  if (p.q === null) return json({ results: [] });
  return json({ results: await searchEverything(db, access, p.q, { scope: await scope(req), account: authMode() === 'better-auth' }) });
});
