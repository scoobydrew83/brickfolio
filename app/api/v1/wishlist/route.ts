import { api, body, fromResult, json } from '@/lib/api';
import { addWish, listWishlist, parseWishInput } from '@/lib/service/wishlist';
import { bricklink } from '@/lib/session';

/** GET /api/v1/wishlist – every wish with its target and BrickLink sold prices. */
export const GET = api(async (_req, { db }) => json({ wishlist: await listWishlist(db) }));

/** POST /api/v1/wishlist – { setNo, target?, condition?, name?, notes? } adds a wish and prices it. */
export const POST = api(async (req, { db }) => {
  const p = parseWishInput(await body(req));
  if (!p.ok) return json({ error: p.error }, 400);
  return fromResult(await addWish(db, p.value, bricklink()), 201);
});
