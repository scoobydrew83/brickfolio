// Background jobs for self-hosted (Node) installs: a daily BrickLink sync and a daily SQLite backup.
// Started from instrumentation.ts. On Cloudflare, a Cron Trigger calls POST /api/v1/sync instead.
import { readdirSync, rmSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { brickLinkFromEnv } from './bricklink/client';
import { rebrickableFromEnv } from './rebrickable/client';
import { bricksetFromEnv } from './brickset/client';
import { syncRetail } from './service/retail';
import { dbPath, nodeDb } from './db/node';
import { runSync, startSync, syncStatus, today } from './service/sets';
import { imageStore } from './images/cache';
import { startRebrickableSync } from './rebrickable/run';

const CHECK_MS = 10 * 60_000;
const hourNow = () => Number(new Date().toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: process.env.TZ || undefined })) % 24;

/** SYNC_HOUR (0–23, local time; default 4). Set SYNC_HOUR=off to only sync by hand. */
let rbOnlyDay = '';

async function maybeSync() {
  const setting = process.env.SYNC_HOUR ?? '4';
  const bl = brickLinkFromEnv();
  if (setting === 'off' || hourNow() !== Number(setting)) return;
  if (!bl) {
    // No BrickLink keys: still fill in Rebrickable and Brickset data once a day.
    if (rbOnlyDay === today()) return;
    rbOnlyDay = today();
    const rb = rebrickableFromEnv();
    if (rb) await startRebrickableSync(nodeDb().db, rb);
    const bs = bricksetFromEnv();
    if (bs) await syncRetail(nodeDb().db, bs);
    return;
  }
  const { db } = nodeDb();
  const last = await syncStatus(db);
  if (last && new Date(last.startedAt).toLocaleDateString('en-CA', { timeZone: process.env.TZ || undefined }) === today()) return;
  const s = await startSync(db);
  if (s.ok) await runSync(db, s.runId, bl.lookup, bl.store, rebrickableFromEnv() ?? undefined, bricksetFromEnv() ?? undefined, { minifig: bl.minifig, partPrice: bl.partPrice, images: (await imageStore()) ?? undefined });
}

/** Copies the database to BACKUP_DIR (default: backups/ next to the database) once a day and keeps BACKUP_KEEP (default 7). */
async function maybeBackup() {
  const dir = process.env.BACKUP_DIR || join(dirname(dbPath()), 'backups');
  const keep = Number(process.env.BACKUP_KEEP || 7);
  if (keep <= 0) return;
  mkdirSync(/*turbopackIgnore: true*/ dir, { recursive: true });
  const name = `app-${today()}.db`;
  const existing = readdirSync(/*turbopackIgnore: true*/ dir).filter((f) => /^app-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort();
  if (existing.includes(name)) return;
  await nodeDb().sqlite.backup(join(/*turbopackIgnore: true*/ dir, name)); // consistent copy while the app keeps running
  for (const old of [...existing, name].slice(0, -keep)) rmSync(join(/*turbopackIgnore: true*/ dir, old), { force: true });
}

export function startScheduler() {
  const tick = () => {
    maybeBackup().catch((e) => console.error('backup failed:', e));
    maybeSync().catch((e) => console.error('scheduled sync failed:', e));
  };
  setTimeout(tick, 30_000); // after startup settles
  setInterval(tick, CHECK_MS).unref();
}
