import { api, json } from '@/lib/api';
import { listHistory } from '@/lib/service/sets';

/** GET /api/v1/history – collection totals per day. */
export const GET = api(async (_req, { db }) => json({ history: await listHistory(db) }));
