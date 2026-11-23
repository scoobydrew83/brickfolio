// Host-specific defaults (#90 phase 4): Vercel has no disk and no long-running process, so the database must be
// libSQL/Turso, migrations run at build time (scripts/migrate.mjs), there is no in-process scheduler, and the daily
// sync (Vercel Cron → GET /api/v1/sync/cron) gets a time limit so it stops cleanly before the function is killed.
// Pure functions over an env object, so they're testable; callers pass process.env.

type Env = Record<string, string | undefined>;

/** A DATABASE_URL that selects libSQL (Turso or a local libSQL file), as lib/db/index.ts reads it. */
export const LIBSQL_URL = /^(libsql|https?|wss?|file):/i;
export const usesLibsql = (env: Env) => env.DB_DRIVER === 'libsql' || LIBSQL_URL.test(env.DATABASE_URL ?? '');

export const onVercel = (env: Env) => !!env.VERCEL;

/** Why the app can't run on this host as configured, or null. Vercel's file system is read-only and not kept. */
export function hostProblem(env: Env): string | null {
  if (onVercel(env) && env.DB_DRIVER !== 'd1' && !usesLibsql(env)) {
    return 'On Vercel, set DATABASE_URL to a libSQL/Turso database (libsql://… plus DATABASE_AUTH_TOKEN): Vercel has no persistent disk for the SQLite file. See docs/hosting.md#vercel.';
  }
  return null;
}

/** Whether libsql.ts applies migrations when it opens the database. DB_MIGRATE=off/on wins; on Vercel they run at build time instead (the drizzle/ folder isn't shipped with the functions). */
export function migrateAtRuntime(env: Env): boolean {
  if (env.DB_MIGRATE) return env.DB_MIGRATE !== 'off';
  return !onVercel(env);
}

/** Whether there is a writable, kept disk for the image cache. On Vercel only with IMAGE_CACHE_DIR set (e.g. /tmp, lost between instances). */
export const hasDisk = (env: Env) => !onVercel(env) || !!env.IMAGE_CACHE_DIR;

/**
 * BETTER_AUTH_URL when it isn't set: on Vercel production deployments, the project's production address
 * (VERCEL_PROJECT_PRODUCTION_URL, a host name Vercel sets, e.g. brickfolio.vercel.app or your custom domain).
 * Previews get none, so Better Auth uses the request's host as it does without BETTER_AUTH_URL. Elsewhere: none.
 */
export function defaultAuthUrl(env: Env): string | null {
  if (env.BETTER_AUTH_URL || !onVercel(env) || env.VERCEL_ENV !== 'production') return null;
  const host = env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  return host && /^[a-z0-9.-]+(:\d+)?$/i.test(host) ? `https://${host}` : null;
}

/** Vercel's function limit for the sync routes (seconds). Hobby allows at most 300; Pro raises it in vercel.json. */
export const SYNC_MAX_DURATION = 300;
/** Kept free at the end of a time-limited sync for the steps after the set lookups (history, alerts, catalog). */
const TAIL_RESERVE_S = 120;

/**
 * When a sync started now must stop starting new work (epoch ms), or undefined for no limit.
 * SYNC_TIME_LIMIT (seconds; 0 or off = none) wins. On Vercel the default is the function limit minus 2 minutes.
 */
export function syncDeadline(env: Env, now = Date.now()): number | undefined {
  const raw = env.SYNC_TIME_LIMIT?.trim();
  if (raw) {
    if (raw === 'off' || raw === '0') return undefined;
    const s = Number(raw);
    if (Number.isFinite(s) && s > 0) return now + s * 1000;
  }
  return onVercel(env) ? now + (SYNC_MAX_DURATION - TAIL_RESERVE_S) * 1000 : undefined;
}
