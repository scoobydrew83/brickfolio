import { api, body, fromResult, json } from '@/lib/api';
import { createLayout, getLayout, listLayouts, parseLayoutInput } from '@/lib/service/layouts';

/** GET /api/v1/layouts – your MILS layouts with how many modules each has. */
export const GET = api(async (_req, { db }) => json({ layouts: await listLayouts(db) }));

/** POST /api/v1/layouts – { name, cols, rows, notes? }: grid size in 32 × 32-stud modules, 1–24 each. */
export const POST = api(async (req, { db }) => {
  const p = parseLayoutInput(await body(req));
  if (!p.ok) return json({ error: p.error }, 400);
  const r = await createLayout(db, p.value);
  return r.ok ? json({ layout: await getLayout(db, r.id) }, 201) : fromResult(r);
});
