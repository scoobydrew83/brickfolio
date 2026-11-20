import { api, body, fromResult, json, setResult } from '@/lib/api';
import { conditionGap, parseSetWithCopy, setNo } from '@/lib/sets';
import { brickLinkGuides } from '@/lib/service/prices';
import * as svc from '@/lib/service/sets';
import { bricklink } from '@/lib/session';
import { readable, setCollections, setRefusal } from '@/lib/service/permissions';

type P = { setNo: string };

/** GET /api/v1/sets/:setNo – one set, with BrickLink's new vs. used gap. 10280 and 10280-1 both work. */
export const GET = api<P>('member', async (_req, { db, access, params }) => {
  // Only the copies in collections you can see (#50); a set with none there is "not found".
  const s = await svc.getSet(db, setNo(params.setNo), { collectionId: readable(access) });
  if (!s) return json({ error: 'Not found' }, 404);
  const g = await brickLinkGuides(db, 'set', s.setNo, await svc.getCurrency(db));
  return json({ set: s, gap: conditionGap(g.N, g.U) });
});

/**
 * PATCH /api/v1/sets/:setNo – change the given fields. Condition, location and Missing % change the copy when there's one;
 * with several copies they answer 409 (use /copies). `qty` adds or removes copies.
 */
/** Set-wide fields and copy counts: needs write access to every collection the set has copies in. */
export const PATCH = api<P>('member', async (req, { db, access, params }) => {
  const no = setNo(params.setNo);
  const refused = setRefusal(access, await setCollections(db, no), true);
  if (refused) return fromResult(refused);
  const b = await body(req);
  if (!b) return json({ error: 'Send a JSON object.' }, 400);
  const p = parseSetWithCopy({ ...b, setNo: params.setNo }, true, await svc.listLocations(db));
  if (!p.ok) return json({ error: p.error }, 400);
  return setResult(db, access, await svc.editSet(db, p.value, bricklink()));
});

/** DELETE /api/v1/sets/:setNo – remove the newest copy (deletes the set on the last one). Returns { remaining }. */
export const DELETE = api<P>('member', async (_req, { db, access, params }) => {
  const no = setNo(params.setNo);
  const refused = setRefusal(access, await setCollections(db, no), true);
  return fromResult(refused ?? await svc.removeOne(db, no));
});
