import { api, body, fromResult, json } from '@/lib/api';
import { getLayout, parseItemsInput, setModuleItems } from '@/lib/service/layouts';
import { idOf, moduleOn } from '../../../params';

/**
 * PUT /api/v1/layouts/:id/modules/:moduleId/items – { setCopyIds, buildIds }: replaces what stands on the module.
 * A copy or build already on another module is refused (409) with where it is.
 */
export const PUT = api<{ id: string; moduleId: string }>(async (req, { db, params }) => {
  const id = await moduleOn(db, params.id, params.moduleId);
  if (id === null) return json({ error: 'Module not found.' }, 404);
  const b = await body(req);
  if (!b) return json({ error: 'Send a JSON object.' }, 400);
  const p = parseItemsInput(b);
  if (!p.ok) return json({ error: p.error }, 400);
  const r = await setModuleItems(db, id, p.value);
  if (!r.ok) return fromResult(r);
  return json({ module: (await getLayout(db, idOf(params.id)!))!.modules.find((m) => m.id === id) });
});
