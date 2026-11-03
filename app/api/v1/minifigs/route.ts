import { api, body, fromResult, json } from '@/lib/api';
import { addMinifig, listMinifigs, minifigTotals, parseFigInput } from '@/lib/service/minifigs';
import { listLocations } from '@/lib/service/sets';
import { brickMinifig } from '@/lib/session';

/** GET /api/v1/minifigs – every minifigure you own, with BrickLink sold prices and totals. */
export const GET = api(async (_req, { db }) => {
  const minifigs = await listMinifigs(db);
  return json({ minifigs, totals: minifigTotals(minifigs) });
});

/** POST /api/v1/minifigs – { figNo, condition?, qty?, location?, notes?, merge? } adds a figure and prices it. */
export const POST = api(async (req, { db }) => {
  const b = await body(req);
  const p = parseFigInput(b, await listLocations(db));
  if (!p.ok) return json({ error: p.error }, 400);
  return fromResult(await addMinifig(db, p.value, { lookup: brickMinifig(), merge: b?.merge === true }), 201);
});
