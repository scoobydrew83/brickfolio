import { api, body, fromResult, json } from '@/lib/api';
import { listReservations, release, reserve } from '@/lib/service/allocations';
import { builds } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import type { DB } from '@/lib/db';

type P = { mocNo: string };
const known = async (db: DB, mocNo: string) => !!(await db.select({ id: builds.id }).from(builds).where(eq(builds.mocNo, mocNo)).get());

/** GET /api/v1/builds/:mocNo/reservations – loose parts reserved for the build, by lot. */
export const GET = api<P>(async (_req, { db, params }) => {
  if (!(await known(db, params.mocNo))) return json({ error: 'Build not found.' }, 404);
  return json({ reservations: await listReservations(db, { mocNo: params.mocNo }) });
});

/** POST /api/v1/builds/:mocNo/reservations – { lotId, qty }: how many of a lot are reserved for it (0 releases). */
export const POST = api<P>(async (req, { db, params }) => {
  const b = await body(req);
  const lotId = Number(b?.lotId), qty = Number(b?.qty);
  if (!Number.isInteger(lotId) || lotId < 1) return json({ error: 'lotId must be a lot id.' }, 400);
  return fromResult(await reserve(db, params.mocNo, lotId, qty));
});

/** DELETE /api/v1/builds/:mocNo/reservations[?lot=] – release one lot, or everything reserved for the build. */
export const DELETE = api<P>(async (req, { db, params }) => {
  const lot = new URL(req.url).searchParams.get('lot');
  if (lot !== null && !/^\d+$/.test(lot)) return json({ error: 'lot must be a lot id.' }, 400);
  return fromResult(await release(db, params.mocNo, lot === null ? undefined : Number(lot)));
});
