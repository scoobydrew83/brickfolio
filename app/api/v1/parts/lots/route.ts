import { api, body, fromResult, json } from '@/lib/api';
import { addLot, listLots, parseLotInput } from '@/lib/service/lots';
import { ensureColors } from '@/lib/service/parts';
import { listLocations } from '@/lib/service/sets';
import { brickColors } from '@/lib/session';

/** GET /api/v1/parts/lots?q=&location=&limit=&offset= – loose-part lots (location "-" = none), with what's reserved on each. */
export const GET = api(async (req, { db }) => {
  const p = new URL(req.url).searchParams;
  await ensureColors(db, brickColors());
  return json(await listLots(db, { q: p.get('q') ?? undefined, location: p.get('location') ?? undefined, limit: Number(p.get('limit')) || 200, offset: Number(p.get('offset')) || 0 }));
});

/** POST /api/v1/parts/lots – { partNo, colorId?, qty, type?, condition?, location?, approximate?, name?, notes? }. */
export const POST = api(async (req, { db }) => {
  const b = await body(req);
  if (!b) return json({ error: 'Send a JSON object.' }, 400);
  const p = parseLotInput(b, await listLocations(db));
  if (!p.ok) return json({ error: p.error }, 400);
  return fromResult(await addLot(db, p.value), 201);
});
