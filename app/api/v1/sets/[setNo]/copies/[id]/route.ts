import { api, body, fromResult, json } from '@/lib/api';
import { editCopy, getCopy, removeCopy } from '@/lib/service/copies';
import { listLocations } from '@/lib/service/sets';
import { parseCopyInput, setNo } from '@/lib/sets';
import { bricklink } from '@/lib/session';

type P = { setNo: string; id: string };

/** The copy id from the path, when it's a copy of this set. */
async function owned(db: Parameters<typeof getCopy>[0], p: P): Promise<number | null> {
  if (!/^\d+$/.test(p.id)) return null;
  const c = await getCopy(db, Number(p.id));
  return c && c.setNo === setNo(p.setNo) ? c.id : null;
}

/** PATCH /api/v1/sets/:setNo/copies/:id – change the given copy fields. */
export const PATCH = api<P>(async (req, { db, params }) => {
  const id = await owned(db, params);
  if (id === null) return json({ error: 'Copy not found.' }, 404);
  const b = await body(req);
  if (!b) return json({ error: 'Send a JSON object.' }, 400);
  const p = parseCopyInput(b, true, await listLocations(db));
  if (!p.ok) return json({ error: p.error }, 400);
  return fromResult(await editCopy(db, id, p.value, bricklink()));
});

/** DELETE /api/v1/sets/:setNo/copies/:id – remove a copy (the set goes with its last one). Returns { remaining }. */
export const DELETE = api<P>(async (_req, { db, params }) => {
  const id = await owned(db, params);
  if (id === null) return json({ error: 'Copy not found.' }, 404);
  const r = await removeCopy(db, id);
  return r.ok ? json({ remaining: r.remaining }) : fromResult(r);
});
