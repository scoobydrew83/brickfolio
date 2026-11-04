import { api, body, fromResult, json } from '@/lib/api';
import { listMissing, pickCopy, saveMissing, type MissingItem } from '@/lib/service/missing';
import { getSet } from '@/lib/service/sets';
import { setNo } from '@/lib/sets';
import { bricklink } from '@/lib/session';

type P = { setNo: string };

/** `?copy=<id>`, or null when not given. */
const copyParam = (req: Request): number | null | 'bad' => {
  const v = new URL(req.url).searchParams.get('copy');
  if (v === null || v === '') return null;
  return /^\d+$/.test(v) ? Number(v) : 'bad';
};

/**
 * GET /api/v1/sets/:setNo/missing?copy=<id> – parts marked missing from a copy, with totals and the Missing % they give.
 * Without `copy`: the only copy, the only Partial one, or the first.
 */
export const GET = api<P>(async (req, { db, params }) => {
  const s = await getSet(db, setNo(params.setNo));
  if (!s) return json({ error: 'Set not found.' }, 404);
  const id = copyParam(req);
  if (id === 'bad') return json({ error: 'copy must be a copy id.' }, 400);
  const copy = pickCopy(s, id, false);
  if (!copy) return json({ error: 'Copy not found.' }, 404);
  return json({ copyId: copy.id, missing: await listMissing(db, s.id, copy.id) });
});

/**
 * PUT /api/v1/sets/:setNo/missing?copy=<id> – replace a copy's missing parts. Body: { items: [{ partNo, colorId, type, qty }] }.
 * An empty list clears them (and Missing %). Marking anything makes the copy Partial. `copy` is required when the
 * set has several copies and it isn't clear which one (400).
 */
export const PUT = api<P>(async (req, { db, params }) => {
  const b = await body(req);
  const items = Array.isArray(b?.items) ? (b.items as MissingItem[]) : null;
  if (!items) return json({ error: 'Send { "items": [{ "partNo", "colorId", "type", "qty" }] }.' }, 400);
  const id = copyParam(req);
  if (id === 'bad') return json({ error: 'copy must be a copy id.' }, 400);
  return fromResult(await saveMissing(db, setNo(params.setNo), id, items, bricklink()));
});
