import { api, fromResult } from '@/lib/api';
import { setNo } from '@/lib/sets';
import { relookup } from '@/lib/service/sets';
import { bricklink } from '@/lib/session';

/** POST /api/v1/sets/:setNo/lookup – re-run the BrickLink lookup for one set. */
export const POST = api<{ setNo: string }>(async (_req, { db, params }) => fromResult(await relookup(db, setNo(params.setNo), bricklink())));
