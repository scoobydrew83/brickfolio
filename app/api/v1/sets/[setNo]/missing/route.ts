import { api, body, fromResult, json } from '@/lib/api';
import { listMissing, saveMissing, type MissingItem } from '@/lib/service/missing';
import { getSet } from '@/lib/service/sets';
import { setNo } from '@/lib/sets';
import { bricklink } from '@/lib/session';

type P = { setNo: string };

/** GET /api/v1/sets/:setNo/missing – parts marked missing, with totals and the Missing % they give. */
export const GET = api<P>(async (_req, { db, params }) => {
  const s = await getSet(db, setNo(params.setNo));
  if (!s) return json({ error: 'Set not found.' }, 404);
  return json({ missing: await listMissing(db, s.id) });
});

/**
 * PUT /api/v1/sets/:setNo/missing – replace the missing parts. Body: { items: [{ partNo, colorId, type, qty }] }.
 * An empty list clears them (and Missing %). Marking anything makes the set Partial.
 */
export const PUT = api<P>(async (req, { db, params }) => {
  const b = await body(req);
  const items = Array.isArray(b?.items) ? (b.items as MissingItem[]) : null;
  if (!items) return json({ error: 'Send { "items": [{ "partNo", "colorId", "type", "qty" }] }.' }, 400);
  return fromResult(await saveMissing(db, setNo(params.setNo), items, bricklink()));
});
