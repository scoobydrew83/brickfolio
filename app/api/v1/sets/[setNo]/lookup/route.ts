import { api, fromResult, setResult } from '@/lib/api';
import { setCollections, setRefusal } from '@/lib/service/permissions';
import { setNo } from '@/lib/sets';
import { relookup } from '@/lib/service/sets';
import { bricklink, rebrickable } from '@/lib/session';

/** POST /api/v1/sets/:setNo/lookup – re-run the BrickLink lookup for one set. */
/** Needs write access to at least one collection with a copy of the set. */
export const POST = api<{ setNo: string }>('member', async (_req, { db, access, params }) => {
  const no = setNo(params.setNo);
  const refused = setRefusal(access, await setCollections(db, no), false);
  return refused ? fromResult(refused) : setResult(db, access, await relookup(db, no, bricklink(), rebrickable()));
});
