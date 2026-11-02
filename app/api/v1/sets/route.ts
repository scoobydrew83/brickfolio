import { api, body, fromResult, json } from '@/lib/api';
import { parseSetInput } from '@/lib/sets';
import * as svc from '@/lib/service/sets';
import { bricklink } from '@/lib/session';

/** GET /api/v1/sets – every set in the collection. */
export const GET = api(async (_req, { db }) => json({ sets: await svc.listSets(db), currency: await svc.getCurrency(db) }));

/** POST /api/v1/sets – add a set. `another: true` adds a copy of a set already in stock (otherwise 409). */
export const POST = api(async (req, { db }) => {
  const b = await body(req);
  if (!b) return json({ error: 'Send a JSON object.' }, 400);
  const p = parseSetInput(b, false, await svc.listLocations(db));
  if (!p.ok) return json({ error: p.error }, 400);
  return fromResult(await svc.addSet(db, p.value, { another: b.another === true, lookup: bricklink() }), 201);
});
