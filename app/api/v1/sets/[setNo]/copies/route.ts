import { api, body, json, setResult } from '@/lib/api';
import { addCopy } from '@/lib/service/copies';
import { getSet, listLocations } from '@/lib/service/sets';
import { parseCopyInput, setNo } from '@/lib/sets';
import { bricklink } from '@/lib/session';
import { readable } from '@/lib/service/permissions';

type P = { setNo: string };

/** GET /api/v1/sets/:setNo/copies – the set's copies, oldest first. */
export const GET = api<P>('member', async (_req, { db, access, params }) => {
  const s = await getSet(db, setNo(params.setNo), { collectionId: readable(access) });
  return s ? json({ copies: s.copies }) : json({ error: 'Not found' }, 404);
});

/** POST /api/v1/sets/:setNo/copies – add a copy to a set you have. Body: CopyInput. Returns { set, copyId }. */
/** Adds a copy to `collectionId` (or `?collection=`, or your default collection): you need to be able to add to it. */
export const POST = api<P>('member', async (req, { db, access, params, target }) => {
  const b = await body(req);
  if (!b) return json({ error: 'Send a JSON object.' }, 400);
  const p = parseCopyInput(b, false, await listLocations(db));
  if (!p.ok) return json({ error: p.error }, 400);
  p.value.collectionId = await target(req, p.value.collectionId);
  return setResult(db, access, await addCopy(db, setNo(params.setNo), p.value, bricklink()), 201);
});
