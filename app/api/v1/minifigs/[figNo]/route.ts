import { api, body, fromResult, json } from '@/lib/api';
import { editMinifig, getMinifig, parseFigInput, removeMinifig } from '@/lib/service/minifigs';
import { listLocations } from '@/lib/service/sets';
import { brickMinifig } from '@/lib/session';

type P = { figNo: string };

/** GET /api/v1/minifigs/:figNo – one figure, by BrickLink (sw0001) or Rebrickable (fig-000123) number. */
export const GET = api<P>(async (_req, { db, params }) => {
  const m = await getMinifig(db, params.figNo);
  return m ? json({ minifig: m }) : json({ error: 'Not found' }, 404);
});

/** PATCH /api/v1/minifigs/:figNo – change the given fields. */
export const PATCH = api<P>(async (req, { db, params }) => {
  const b = await body(req);
  if (!b) return json({ error: 'Send a JSON object.' }, 400);
  const p = parseFigInput(b, await listLocations(db), true);
  if (!p.ok) return json({ error: p.error }, 400);
  return fromResult(await editMinifig(db, params.figNo, p.value, brickMinifig()));
});

/** DELETE /api/v1/minifigs/:figNo – remove one copy (deletes the figure on the last one). Returns { remaining }. */
export const DELETE = api<P>(async (_req, { db, params }) => fromResult(await removeMinifig(db, params.figNo)));
