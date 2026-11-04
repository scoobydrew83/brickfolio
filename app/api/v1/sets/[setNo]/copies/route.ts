import { api, body, fromResult, json } from '@/lib/api';
import { addCopy } from '@/lib/service/copies';
import { getSet, listLocations } from '@/lib/service/sets';
import { parseCopyInput, setNo } from '@/lib/sets';
import { bricklink } from '@/lib/session';

type P = { setNo: string };

/** GET /api/v1/sets/:setNo/copies – the set's copies, oldest first. */
export const GET = api<P>(async (_req, { db, params }) => {
  const s = await getSet(db, setNo(params.setNo));
  return s ? json({ copies: s.copies }) : json({ error: 'Not found' }, 404);
});

/** POST /api/v1/sets/:setNo/copies – add a copy to a set you have. Body: CopyInput. Returns { set, copyId }. */
export const POST = api<P>(async (req, { db, params }) => {
  const b = await body(req);
  if (!b) return json({ error: 'Send a JSON object.' }, 400);
  const p = parseCopyInput(b, false, await listLocations(db));
  if (!p.ok) return json({ error: p.error }, 400);
  return fromResult(await addCopy(db, setNo(params.setNo), p.value, bricklink()), 201);
});
