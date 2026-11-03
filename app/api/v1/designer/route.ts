import { api, body, fromResult, json } from '@/lib/api';
import { addProject, listProjects, parseProjectInput } from '@/lib/service/designer';

/** GET /api/v1/designer – BrickLink Designer Program projects you follow, with their pre-order window. */
export const GET = api(async (_req, { db }) => json({ projects: await listProjects(db) }));

/** POST /api/v1/designer – { name, setNo?, series?, designer?, stage?, preorderStart?, preorderEnd?, price?, pieces?, url?, notes?, watching? }. */
export const POST = api(async (req, { db }) => {
  const p = parseProjectInput(await body(req));
  if (!p.ok) return json({ error: p.error }, 400);
  return fromResult(await addProject(db, p.value), 201);
});
