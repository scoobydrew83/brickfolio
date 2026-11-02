import { api, body, fromResult, json } from '@/lib/api';
import { editWish, getWish, parseWishInput, removeWish } from '@/lib/service/wishlist';
import { bricklink } from '@/lib/session';

type P = { setNo: string };

/** GET /api/v1/wishlist/:setNo – one wish. */
export const GET = api<P>(async (_req, { db, params }) => {
  const w = await getWish(db, params.setNo);
  return w ? json({ wish: w }) : json({ error: 'Not found' }, 404);
});

/** PATCH /api/v1/wishlist/:setNo – change target, condition, name or notes. */
export const PATCH = api<P>(async (req, { db, params }) => {
  const b = await body(req);
  if (!b) return json({ error: 'Send a JSON object.' }, 400);
  const p = parseWishInput({ ...b, setNo: params.setNo }, true);
  if (!p.ok) return json({ error: p.error }, 400);
  return fromResult(await editWish(db, p.value, bricklink()));
});

/** DELETE /api/v1/wishlist/:setNo – take it off the wishlist. */
export const DELETE = api<P>(async (_req, { db, params }) => fromResult(await removeWish(db, params.setNo)));
