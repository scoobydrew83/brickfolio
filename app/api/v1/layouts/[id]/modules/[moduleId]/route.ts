import { api, body, fromResult, json } from '@/lib/api';
import { editModule, getLayout, parseModuleInput, removeModule } from '@/lib/service/layouts';
import { idOf, moduleOn } from '../../params';

type P = { id: string; moduleId: string };

/** PATCH /api/v1/layouts/:id/modules/:moduleId – { x?, y?, w?, h?, rotation?, kind?, name?, notes? }. 409 when it overlaps or doesn't fit. */
export const PATCH = api<P>(async (req, { db, params }) => {
  const id = await moduleOn(db, params.id, params.moduleId);
  if (id === null) return json({ error: 'Module not found.' }, 404);
  const b = await body(req);
  if (!b) return json({ error: 'Send a JSON object.' }, 400);
  const p = parseModuleInput(b, true);
  if (!p.ok) return json({ error: p.error }, 400);
  const r = await editModule(db, id, p.value);
  if (!r.ok) return fromResult(r);
  return json({ module: (await getLayout(db, idOf(params.id)!))!.modules.find((m) => m.id === id) });
});

/** DELETE /api/v1/layouts/:id/modules/:moduleId – removes the module and its links. */
export const DELETE = api<P>(async (_req, { db, params }) => {
  const id = await moduleOn(db, params.id, params.moduleId);
  return id === null ? json({ error: 'Module not found.' }, 404) : fromResult(await removeModule(db, id));
});
