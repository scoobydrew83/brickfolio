import { api, body, fromResult, json } from '@/lib/api';
import { deleteLayout, editLayout, getLayout, parseLayoutInput } from '@/lib/service/layouts';
import { idOf } from './params';

type P = { id: string };

/** GET /api/v1/layouts/:id – the layout with its modules and the set copies and builds on each. */
export const GET = api<P>(async (_req, { db, params }) => {
  const id = idOf(params.id);
  const l = id === null ? undefined : await getLayout(db, id);
  return l ? json({ layout: l }) : json({ error: 'Layout not found.' }, 404);
});

/** PATCH /api/v1/layouts/:id – { name?, cols?, rows?, notes? }. A size that would cut off a module is refused (409). */
export const PATCH = api<P>(async (req, { db, params }) => {
  const id = idOf(params.id);
  if (id === null) return json({ error: 'Layout not found.' }, 404);
  const b = await body(req);
  if (!b) return json({ error: 'Send a JSON object.' }, 400);
  const p = parseLayoutInput(b, true);
  if (!p.ok) return json({ error: p.error }, 400);
  const r = await editLayout(db, id, p.value);
  return r.ok ? json({ layout: await getLayout(db, id) }) : fromResult(r);
});

/** DELETE /api/v1/layouts/:id – removes the layout, its modules and links. Set copies and builds stay. */
export const DELETE = api<P>(async (_req, { db, params }) => {
  const id = idOf(params.id);
  return id === null ? json({ error: 'Layout not found.' }, 404) : fromResult(await deleteLayout(db, id));
});
