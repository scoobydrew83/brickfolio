import { api, body, fromResult, json } from '@/lib/api';
import { CONDITIONS, parseQuickList, type Condition } from '@/lib/sets';
import { quickAdd } from '@/lib/service/sets';
import { brickMinifig, bricklink, rebrickable } from '@/lib/session';

/**
 * POST /api/v1/sets/bulk – { text, location?, condition?, collectionId? } adds a pasted list of set numbers (10497, "10497 x2")
 * and BrickLink minifig numbers (sw0001). Up to 10 new items are looked up now; more wait for the next sync.
 */
export const POST = api('member', async (req, { db, target }) => {
  const b = await body(req);
  if (!b || typeof b.text !== 'string') return json({ error: 'Send { "text": "10497\\n21325 x2" }.' }, 400);
  const list = parseQuickList(b.text.slice(0, 50_000));
  if (!list.sets.length && !list.minifigs.length) return json({ error: 'No set or minifig numbers found.', invalid: list.invalid }, 400);
  const condition = (CONDITIONS as readonly string[]).includes(String(b.condition)) ? (b.condition as Condition) : undefined;
  const location = typeof b.location === 'string' && b.location ? b.location : null;
  const col = await target(req, b.collectionId); // 400 for a bad id, 403 when you can't add to it
  return fromResult(await quickAdd(db, list, { location, condition, lookup: bricklink(), minifig: brickMinifig(), rb: rebrickable(), collectionId: col }), 201);
});
