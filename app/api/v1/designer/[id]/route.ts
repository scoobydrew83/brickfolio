import { api, body, fromResult, json } from '@/lib/api';
import { editProject, parseProjectInput, removeProject } from '@/lib/service/designer';

type P = { id: string };
const idOf = (s: string) => (/^\d+$/.test(s) ? Number(s) : null);

/** PATCH /api/v1/designer/:id – change the given fields. New dates re-arm that window's alert. */
export const PATCH = api<P>(async (req, { db, params }) => {
  const id = idOf(params.id);
  if (id === null) return json({ error: 'Not found' }, 404);
  const p = parseProjectInput(await body(req), true);
  if (!p.ok) return json({ error: p.error }, 400);
  return fromResult(await editProject(db, id, p.value));
});

/** DELETE /api/v1/designer/:id */
export const DELETE = api<P>(async (_req, { db, params }) => {
  const id = idOf(params.id);
  return id === null ? json({ error: 'Not found' }, 404) : fromResult(await removeProject(db, id));
});
