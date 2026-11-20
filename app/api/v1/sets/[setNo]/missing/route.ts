import { api, body, fromResult, json } from '@/lib/api';
import { readable } from '@/lib/service/permissions';
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
export const GET = api<P>('member', async (req, { db, access, params }) => {
  const s = await getSet(db, setNo(params.setNo), { collectionId: readable(access) }); // only copies you can see (#50)
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
export const PUT = api<P>('member', async (req, { db, access, params, need }) => {
  const b = await body(req);
  const items = Array.isArray(b?.items) ? (b.items as MissingItem[]) : null;
  if (!items) return json({ error: 'Send { "items": [{ "partNo", "colorId", "type", "qty" }] }.' }, 400);
  const id = copyParam(req);
  if (id === 'bad') return json({ error: 'copy must be a copy id.' }, 400);
  // Marks are per copy: write access to the copy's collection, picked among the copies you can see (#50).
  const s = await getSet(db, setNo(params.setNo), { collectionId: readable(access) });
  if (!s) return json({ error: 'Set not found.' }, 404);
  const copy = pickCopy(s, id, true);
  if (!copy) return json({ error: id == null && s.copies.length > 1 ? `#${s.setNo} has ${s.copies.length} copies. Say which one (copy).` : 'Copy not found.' }, id == null ? 400 : 404);
  need({ action: 'write', collectionId: copy.collectionId ?? 1 });
  return fromResult(await saveMissing(db, s.setNo, copy.id, items, bricklink()));
});
