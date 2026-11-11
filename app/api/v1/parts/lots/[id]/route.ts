import { api, body, fromResult, json } from '@/lib/api';
import { editLot, parseLotInput, removeLot } from '@/lib/service/lots';
import { listLocations } from '@/lib/service/sets';

type P = { id: string };
const idOf = (s: string) => (/^\d+$/.test(s) ? Number(s) : null);

/** PATCH /api/v1/parts/lots/:id – change the given fields. A qty below what's reserved on the lot is refused (409). */
export const PATCH = api<P>(async (req, { db, params }) => {
  const id = idOf(params.id);
  if (id === null) return json({ error: 'Lot not found.' }, 404);
  const b = await body(req);
  if (!b) return json({ error: 'Send a JSON object.' }, 400);
  const p = parseLotInput(b, await listLocations(db), true);
  if (!p.ok) return json({ error: p.error }, 400);
  return fromResult(await editLot(db, id, p.value));
});

/** DELETE /api/v1/parts/lots/:id[?force=1] – a reserved lot needs force, which drops its reservations. */
export const DELETE = api<P>(async (req, { db, params }) => {
  const id = idOf(params.id);
  if (id === null) return json({ error: 'Lot not found.' }, 404);
  return fromResult(await removeLot(db, id, new URL(req.url).searchParams.get('force') === '1'));
});
