import { api, fromResult, json } from '@/lib/api';
import { syncStatus } from '@/lib/service/sets';
import { catalogOnlyRun, startFullSync } from '@/lib/sync-trigger';

// Vercel: the sync runs after the response (after()), inside this function's time limit. 300 s is Hobby's maximum;
// the sync stops starting new work 2 minutes before it (lib/hosting.ts). Ignored by Docker and Cloudflare.
export const maxDuration = 300;

/**
 * GET /api/v1/sync – status of the latest sync, and (`catalogOnly`) of the latest Rebrickable/Brickset-only run the
 * cron route started in this process without BrickLink keys (null when there hasn't been one).
 */
export const GET = api('member', async (_req, { db }) => json({ sync: await syncStatus(db), catalogOnly: catalogOnlyRun() }));

/** POST /api/v1/sync – start a full sync (BrickLink prices, plus Rebrickable themes and Brickset retail prices when their keys are set) in the background (409 if one is running). Also used by the scheduler. */
export const POST = api('admin', async (_req, { db }) => {
  const r = await startFullSync(db);
  return fromResult(r, 202);
});
