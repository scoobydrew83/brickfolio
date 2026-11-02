import { api, body, fromResult, json } from '@/lib/api';
import { parseSetInput, setNo } from '@/lib/sets';
import * as svc from '@/lib/service/sets';
import { bricklink } from '@/lib/session';

type P = { setNo: string };

/** GET /api/v1/sets/:setNo – one set. 10280 and 10280-1 both work. */
export const GET = api<P>(async (_req, { db, params }) => {
  const s = await svc.getSet(db, setNo(params.setNo));
  return s ? json({ set: s }) : json({ error: 'Not found' }, 404);
});

/** PATCH /api/v1/sets/:setNo – change the given fields. */
export const PATCH = api<P>(async (req, { db, params }) => {
  const b = await body(req);
  if (!b) return json({ error: 'Send a JSON object.' }, 400);
  const p = parseSetInput({ ...b, setNo: params.setNo }, true, await svc.listLocations(db));
  if (!p.ok) return json({ error: p.error }, 400);
  return fromResult(await svc.editSet(db, p.value, bricklink()));
});

/** DELETE /api/v1/sets/:setNo – remove one copy (deletes the set on the last one). Returns { remaining }. */
export const DELETE = api<P>(async (_req, { db, params }) => fromResult(await svc.removeOne(db, setNo(params.setNo))));
