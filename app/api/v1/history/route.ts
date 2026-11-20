import { api, json, scopeOf } from '@/lib/api';
import { listHistory } from '@/lib/service/sets';

/** GET /api/v1/history[?collection=<id>] – totals per day, for everything or one collection. */
export const GET = api('member', async (req, { db, access }) => json({ history: await listHistory(db, { collectionId: await scopeOf(req, db, access) }) }));
