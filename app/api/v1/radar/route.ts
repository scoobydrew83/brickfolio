import { api, json, scopeOf } from '@/lib/api';
import { getRadar } from '@/lib/service/radar';

/** GET /api/v1/radar – upcoming retirements by month, retired sets with growth since retiring, and totals. */
export const GET = api('member', async (req, { db, access }) => json(await getRadar(db, undefined, { collectionId: await scopeOf(req, db, access) })));
