import { api, fromResult } from '@/lib/api';
import { setNo } from '@/lib/sets';
import { refreshParts } from '@/lib/service/sets';
import { bricklink } from '@/lib/session';

/** POST /api/v1/sets/:setNo/parts/refresh – fetch the parts list from BrickLink again. */
export const POST = api<{ setNo: string }>(async (_req, { db, params }) => fromResult(await refreshParts(db, setNo(params.setNo), bricklink())));
