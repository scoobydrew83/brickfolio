import { after } from 'next/server';
import { api, fromResult, json } from '@/lib/api';
import { runSync, startSync, syncStatus } from '@/lib/service/sets';
import { brickMinifig, brickPartPrice, brickStore, bricklink, brickset, rebrickable } from '@/lib/session';

/** GET /api/v1/sync – status of the latest sync. */
export const GET = api(async (_req, { db }) => json({ sync: await syncStatus(db) }));

/** POST /api/v1/sync – start a full sync (BrickLink prices, plus Rebrickable themes and Brickset retail prices when their keys are set) in the background (409 if one is running). Also used by the scheduler. */
export const POST = api(async (_req, { db }) => {
  const lookup = bricklink();
  if (!lookup) return json({ error: 'BrickLink API keys are not set.' }, 400);
  const r = await startSync(db);
  if (r.ok) after(() => runSync(db, r.runId, lookup, brickStore() ?? undefined, rebrickable() ?? undefined, brickset() ?? undefined, { minifig: brickMinifig() ?? undefined, partPrice: brickPartPrice() ?? undefined }));
  return fromResult(r, 202);
});
