// Which version is running, and whether a newer release is out on GitHub. At most one request a day to the public
// releases API, with nothing about the collection in it. UPDATE_CHECK=off turns it off; demo mode never checks.
import { eq } from 'drizzle-orm';
import pkg from '@/package.json';
import { settings } from '../db/schema';
import type { DB } from '../db/types';
import { isDemo } from '../demo';

export const APP_VERSION: string = pkg.version;
export const RELEASES_URL = 'https://github.com/scoobydrew83/brickfolio/releases';
const LATEST_API = 'https://api.github.com/repos/scoobydrew83/brickfolio/releases/latest';
const KEY = 'update_check';
const MAX_AGE_MS = 24 * 3_600_000;

type Cache = { latest: string | null; url: string | null; checkedAt: string | null; error: string | null };
export type UpdateStatus = { current: string; enabled: boolean; latest: string | null; updateAvailable: boolean; url: string | null; checkedAt: string | null; error: string | null };

/** -1, 0 or 1, comparing dotted version numbers (a leading v and anything after - or + are ignored). */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string) => v.trim().replace(/^v/i, '').split(/[-+]/)[0].split('.').map((n) => Number.parseInt(n, 10) || 0);
  const x = parts(a), y = parts(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

export const updateCheckEnabled = () => process.env.UPDATE_CHECK !== 'off' && !isDemo();

async function readCache(db: DB): Promise<Cache> {
  const r = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, KEY)).get();
  try { return r ? { latest: null, url: null, checkedAt: null, error: null, ...(JSON.parse(r.value) as Partial<Cache>) } : { latest: null, url: null, checkedAt: null, error: null }; } catch { return { latest: null, url: null, checkedAt: null, error: null }; }
}

const status = (c: Cache, enabled = updateCheckEnabled()): UpdateStatus => ({
  current: APP_VERSION, enabled, latest: enabled ? c.latest : null, url: enabled ? c.url : null, checkedAt: enabled ? c.checkedAt : null, error: enabled ? c.error : null,
  updateAvailable: enabled && !!c.latest && compareVersions(c.latest, APP_VERSION) > 0,
});

/** The last stored answer, without asking GitHub (for the nav and pages that must not wait). */
export async function cachedUpdateStatus(db: DB): Promise<UpdateStatus> {
  return status(updateCheckEnabled() ? await readCache(db) : { latest: null, url: null, checkedAt: null, error: null });
}

/**
 * Asks GitHub for the latest release when the stored answer is over a day old (or `force`), and stores it. A failed
 * request keeps the last answer and records the error. Never throws.
 */
export async function checkForUpdate(db: DB, opts: { fetchImpl?: typeof fetch; now?: Date; force?: boolean } = {}): Promise<UpdateStatus> {
  if (!updateCheckEnabled()) return status({ latest: null, url: null, checkedAt: null, error: null }, false);
  const now = opts.now ?? new Date();
  const cache = await readCache(db);
  if (!opts.force && cache.checkedAt && now.getTime() - Date.parse(cache.checkedAt) < MAX_AGE_MS) return status(cache);
  let next: Cache;
  try {
    const res = await (opts.fetchImpl ?? fetch)(LATEST_API, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': `Brickfolio/${APP_VERSION}` }, signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
    const body = (await res.json()) as { tag_name?: unknown; html_url?: unknown };
    const tag = typeof body.tag_name === 'string' ? body.tag_name.replace(/^v/i, '') : '';
    if (!/^\d+(\.\d+)*/.test(tag)) throw new Error('GitHub sent no release version');
    const url = typeof body.html_url === 'string' && body.html_url.startsWith('https://github.com/') ? body.html_url : RELEASES_URL;
    next = { latest: tag, url, checkedAt: now.toISOString(), error: null };
  } catch (e) {
    next = { ...cache, checkedAt: now.toISOString(), error: `Couldn't check for updates: ${e instanceof Error ? e.message : String(e)}`.slice(0, 200) };
  }
  const value = JSON.stringify(next);
  await db.insert(settings).values({ key: KEY, value }).onConflictDoUpdate({ target: settings.key, set: { value } });
  return status(next);
}
