import { api, fromResult } from '@/lib/api';
import { autoReserve } from '@/lib/service/allocations';

/** POST /api/v1/builds/:mocNo/reservations/auto – reserve what the build still needs from free loose parts. */
export const POST = api<{ mocNo: string }>(async (_req, { db, params }) => fromResult(await autoReserve(db, params.mocNo)));
