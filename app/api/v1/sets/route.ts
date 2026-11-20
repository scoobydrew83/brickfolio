import { api, body, setResult, json, scopeOf } from '@/lib/api';
import { parseSetWithCopy } from '@/lib/sets';
import * as svc from '@/lib/service/sets';
import { readable } from '@/lib/service/permissions';
import { bricklink, rebrickable } from '@/lib/session';

/** GET /api/v1/sets[?collection=<id>] – every set, or the sets in one collection with only its copies. */
export const GET = api('member', async (req, { db, access }) => json({ sets: await svc.listSets(db, { collectionId: await scopeOf(req, db, access) }), currency: await svc.getCurrency(db) }));

/** POST /api/v1/sets – add a set with `qty` copies (copy fields: status, acquiredDate, buildDate, pricePaid, tax, shipping, gwp, copyNotes). `another: true` adds a copy of a set already in stock (otherwise 409). */
export const POST = api('member', async (req, { db, access, target }) => {
  const b = await body(req);
  if (!b) return json({ error: 'Send a JSON object.' }, 400);
  const p = parseSetWithCopy(b, false, await svc.listLocations(db));
  if (!p.ok) return json({ error: p.error }, 400);
  p.value.copy = { ...p.value.copy, collectionId: await target(req, p.value.copy?.collectionId) };
  return setResult(db, access, await svc.addSet(db, p.value, { another: b.another === true, lookup: bricklink(), rb: rebrickable(), seen: readable(access) }), 201);
});
