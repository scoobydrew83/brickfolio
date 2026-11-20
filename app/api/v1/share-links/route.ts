import { api, body, json } from '@/lib/api';
import { createShareLink, listShareLinks, parseShareInput } from '@/lib/service/share';
import { can, shareNeed } from '@/lib/service/permissions';

/** GET /api/v1/share-links – every share link (never the link itself or its hash). */
/** Admins see every link; others the links of collections they own (#50). */
export const GET = api('member', async (_req, { db, access }) => json({ shareLinks: (await listShareLinks(db)).filter((l) => can(access, shareNeed(l.collectionId))) }));

/**
 * POST /api/v1/share-links – create a read-only link. Body: { name, showValues?, showLocations?, showNotes?,
 * showMinifigs? (default true), expires?: 'never' | days | date }. Returns { id, url } once.
 */
export const POST = api('member', async (req, { db, access, need }) => {
  const b = await body(req);
  if (!b) return json({ error: 'Send a JSON object.' }, 400);
  const p = parseShareInput(b);
  if (!p.ok) return json({ error: p.error }, 400);
  need(shareNeed(p.value.collectionId)); // one collection: its owners; every collection: admins
  const r = await createShareLink(db, { ...p.value, createdBy: access.login });
  if (!r.ok) return json({ error: r.error }, r.status ?? 400);
  const base = (process.env.SHARE_BASE_URL || process.env.APP_URL || new URL(req.url).origin).replace(/\/$/, '');
  return json({ id: r.id, url: `${base}/share/${r.token}` }, 201);
});
