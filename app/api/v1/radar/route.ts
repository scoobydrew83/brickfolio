import { api, json } from '@/lib/api';
import { getRadar } from '@/lib/service/radar';

/** GET /api/v1/radar – upcoming retirements by month, retired sets with growth since retiring, and totals. */
export const GET = api(async (_req, { db }) => json(await getRadar(db)));
