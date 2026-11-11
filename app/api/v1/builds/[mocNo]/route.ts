import { api, fromResult } from '@/lib/api';
import { removeBuild } from '@/lib/service/builds';

/** DELETE /api/v1/builds/:mocNo – a MOC or your own build, with its reservations. Alternates can't be removed (409). */
export const DELETE = api<{ mocNo: string }>(async (_req, { db, params }) => fromResult(await removeBuild(db, params.mocNo)));
