import { api, body, fromResult, json } from '@/lib/api';
import { addModule, getLayout, parseModuleInput } from '@/lib/service/layouts';
import { idOf } from '../params';

/** POST /api/v1/layouts/:id/modules – { x, y, w?, h?, rotation?, kind?, name?, notes? }. 409 when it overlaps or doesn't fit. */
export const POST = api<{ id: string }>(async (req, { db, params }) => {
  const id = idOf(params.id);
  if (id === null) return json({ error: 'Layout not found.' }, 404);
  const b = await body(req);
  if (!b) return json({ error: 'Send a JSON object.' }, 400);
  const p = parseModuleInput(b);
  if (!p.ok) return json({ error: p.error }, 400);
  const r = await addModule(db, id, p.value);
  if (!r.ok) return fromResult(r);
  return json({ module: (await getLayout(db, id))!.modules.find((m) => m.id === r.id) }, 201);
});
