import { api, body, fromResult, json, scopeOf } from '@/lib/api';
import { addMinifig, listMinifigs, minifigTotals, parseFigInput } from '@/lib/service/minifigs';
import { listLocations } from '@/lib/service/sets';
import { brickMinifig } from '@/lib/session';

/** GET /api/v1/minifigs[?collection=<id>] – every minifigure you own (or one collection's), with BrickLink sold prices and totals. */
export const GET = api('member', async (req, { db, access }) => {
  const minifigs = await listMinifigs(db, { collectionId: await scopeOf(req, db, access) });
  return json({ minifigs, totals: minifigTotals(minifigs) });
});

/** POST /api/v1/minifigs – { figNo, condition?, qty?, location?, notes?, merge? } adds a figure and prices it. */
export const POST = api('member', async (req, { db, target }) => {
  const b = await body(req);
  const p = parseFigInput(b, await listLocations(db));
  if (!p.ok) return json({ error: p.error }, 400);
  p.value.collectionId = await target(req, p.value.collectionId);
  return fromResult(await addMinifig(db, p.value, { lookup: brickMinifig(), merge: b?.merge === true }), 201);
});
