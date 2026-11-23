// Starting the full sync from a request: POST /api/v1/sync (an admin or the CRON_SECRET) and GET /api/v1/sync/cron
// (cron services that only send GET, such as Vercel Cron). The sync runs after the response, with after().
import 'server-only';
import { sql } from 'drizzle-orm';
import { after } from 'next/server';
import type { DB } from './db';
import { imageStore } from './images/cache';
import { syncDeadline } from './hosting';
import { runSync, startSync, syncStatus, today, type Result } from './service/sets';
import { settings } from './db/schema';
import { startRebrickableSync } from './rebrickable/run';
import { syncRetail } from './service/retail';
import { brickMinifig, brickPartPrice, brickPrice, brickStore, bricklink, brickset, rebrickable } from './session';

export type SyncStart = Result<{ runId: number }> | { ok: true; skipped: string } | { ok: true; started: string };

/**
 * Claims the sync lock and runs the sync in the background (409 while one runs). `oncePerDay`: do nothing when a
 * sync already started today (cron services may deliver the same run twice). On hosts with a time limit (Vercel,
 * or SYNC_TIME_LIMIT) the sync stops starting new work before the function is stopped; see lib/hosting.ts.
 */
export async function startFullSync(db: DB, opts: { oncePerDay?: boolean } = {}): Promise<SyncStart> {
  const lookup = bricklink();
  if (!lookup) return opts.oncePerDay ? withoutBrickLink(db) : { ok: false, status: 400, error: 'BrickLink API keys are not set.' };
  if (opts.oncePerDay) {
    const last = await syncStatus(db);
    if (last && !last.running && localDate(last.startedAt) === today()) return { ok: true, skipped: `Already synced today (started ${last.startedAt}).` };
  }
  const r = await startSync(db);
  if (!r.ok) return r;
  const deadline = syncDeadline(process.env);
  const images = (await imageStore()) ?? undefined;
  after(() => runSync(db, r.runId, lookup, brickStore() ?? undefined, rebrickable() ?? undefined, brickset() ?? undefined, { minifig: brickMinifig() ?? undefined, partPrice: brickPartPrice() ?? undefined, price: brickPrice() ?? undefined, images, deadline }));
  return r;
}

/** The latest Rebrickable/Brickset-only cron run in this process (GET /api/v1/sync reports it as `catalogOnly`). */
export type CatalogOnlyRun = { running: boolean; startedAt: string; finishedAt: string | null; errors: string[] };
let catalogOnly: CatalogOnlyRun | null = null;
export const catalogOnlyRun = (): CatalogOnlyRun | null => (catalogOnly ? { ...catalogOnly, errors: [...catalogOnly.errors] } : null);

/**
 * The daily cron run without BrickLink keys: what the always-on scheduler does then (lib/scheduler.ts), once a day:
 * Rebrickable's downloads, themes, IDs and alternate builds, and Brickset's retail data. Nothing to do: 400 as before.
 */
async function withoutBrickLink(db: DB): Promise<SyncStart> {
  const rb = rebrickable(), bs = brickset();
  if (!rb && !bs) return { ok: false, status: 400, error: 'No BrickLink, Rebrickable or Brickset keys are set: nothing to sync.' };
  const key = 'cron_catalog_day', day = today();
  const claimed = await db.insert(settings).values({ key, value: day }).onConflictDoUpdate({ target: settings.key, set: { value: day }, setWhere: sql`${settings.value} <> ${day}` }).returning().all();
  if (!claimed.length) return { ok: true, skipped: `Already ran today (Rebrickable and Brickset only: BrickLink keys aren't set).` };
  const run: CatalogOnlyRun = { running: true, startedAt: new Date().toISOString(), finishedAt: null, errors: [] };
  catalogOnly = run;
  after(async () => {
    try {
      if (rb) await startRebrickableSync(db, rb);
      if (bs) run.errors.push(...(await syncRetail(db, bs)));
    } catch (e) {
      run.errors.push(e instanceof Error ? e.message : String(e));
    } finally {
      for (const e of run.errors) console.error(e);
      Object.assign(run, { running: false, finishedAt: new Date().toISOString() });
    }
  });
  return { ok: true, started: [rb && 'Rebrickable', bs && 'Brickset'].filter(Boolean).join(' and ') + ' (BrickLink keys aren\'t set)' };
}

const localDate = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: process.env.TZ || undefined });
