// GET /api/v1/sync/cron – starts the daily sync for cron services that only send GET (Vercel Cron), or a
// `curl` from any scheduler. Only "Authorization: Bearer <CRON_SECRET>" is accepted: no API tokens or browser
// sessions, so a link or an <img> can't start it. Does nothing when a sync already started today.
import { connection } from 'next/server';
import { json } from '@/lib/api';
import { getDb } from '@/lib/db';
import { startFullSync } from '@/lib/sync-trigger';
import { isCronRequest } from '@/lib/cron-auth';

// See ../route.ts: Vercel's function limit for the sync that runs after the response.
export const maxDuration = 300;

export async function GET(req: Request) {
  await connection(); // never prerendered or cached
  if (!(await isCronRequest(req.headers, process.env.CRON_SECRET))) {
    return json({ error: 'Unauthorized. Send Authorization: Bearer <CRON_SECRET>.' }, 401);
  }
  const r = await startFullSync(await getDb(), { oncePerDay: true });
  if (!r.ok) return json({ error: r.error }, r.status ?? 400);
  if ('skipped' in r) return json({ skipped: r.skipped }, 200);
  return 'started' in r ? json({ started: r.started }, 202) : json({ runId: r.runId }, 202);
}
