import { api, fromResult, setResult } from '@/lib/api';
import { setCollections, setRefusal } from '@/lib/service/permissions';
import { setNo } from '@/lib/sets';
import { refreshParts } from '@/lib/service/sets';
import { bricklink, rebrickable } from '@/lib/session';

/** POST /api/v1/sets/:setNo/parts/refresh – fetch the parts list from BrickLink again. */
/** Needs write access to at least one collection with a copy of the set. */
export const POST = api<{ setNo: string }>('member', async (_req, { db, access, params }) => {
  const no = setNo(params.setNo);
  const refused = setRefusal(access, await setCollections(db, no), false);
  return refused ? fromResult(refused) : setResult(db, access, await refreshParts(db, no, bricklink(), rebrickable()));
});
