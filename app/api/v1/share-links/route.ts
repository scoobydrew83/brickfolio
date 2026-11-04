import { api, body, json } from '@/lib/api';
import { createShareLink, listShareLinks, parseShareInput } from '@/lib/service/share';

/** GET /api/v1/share-links – every share link (never the link itself or its hash). */
export const GET = api(async (_req, { db }) => json({ shareLinks: await listShareLinks(db) }));

/**
 * POST /api/v1/share-links – create a read-only link. Body: { name, showValues?, showLocations?, showNotes?,
 * showMinifigs? (default true), expires?: 'never' | days | date }. Returns { id, url } once.
 */
export const POST = api(async (req, { db }) => {
  const b = await body(req);
  if (!b) return json({ error: 'Send a JSON object.' }, 400);
  const p = parseShareInput(b);
  if (!p.ok) return json({ error: p.error }, 400);
  const r = await createShareLink(db, p.value);
  if (!r.ok) return json({ error: r.error }, r.status ?? 400);
  const base = (process.env.SHARE_BASE_URL || process.env.APP_URL || new URL(req.url).origin).replace(/\/$/, '');
  return json({ id: r.id, url: `${base}/share/${r.token}` }, 201);
});
