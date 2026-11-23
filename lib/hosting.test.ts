import { describe, expect, it } from 'vitest';
import { defaultAuthUrl, hasDisk, hostProblem, migrateAtRuntime, syncDeadline, usesLibsql } from './hosting';

describe('hosting defaults (#90 phase 4)', () => {
  it('needs a libSQL DATABASE_URL on Vercel, and nothing elsewhere', () => {
    expect(hostProblem({})).toBeNull();
    expect(hostProblem({ DATABASE_PATH: '/data/app.db' })).toBeNull();
    expect(hostProblem({ VERCEL: '1' })).toMatch(/On Vercel, set DATABASE_URL/);
    expect(hostProblem({ VERCEL: '1', DATABASE_URL: '/tmp/app.db' })).toMatch(/DATABASE_URL/);
    for (const url of ['libsql://db.turso.io', 'https://db.turso.io', 'file:/tmp/app.db']) {
      expect(usesLibsql({ DATABASE_URL: url })).toBe(true);
      expect(hostProblem({ VERCEL: '1', DATABASE_URL: url })).toBeNull();
    }
    expect(hostProblem({ VERCEL: '1', DB_DRIVER: 'libsql' })).toBeNull();
  });

  it('migrates at build time on Vercel, at open elsewhere, and DB_MIGRATE decides when set', () => {
    expect(migrateAtRuntime({})).toBe(true);
    expect(migrateAtRuntime({ DB_MIGRATE: 'off' })).toBe(false);
    expect(migrateAtRuntime({ VERCEL: '1' })).toBe(false);
    expect(migrateAtRuntime({ VERCEL: '1', DB_MIGRATE: 'on' })).toBe(true);
  });

  it('keeps no image cache on Vercel unless IMAGE_CACHE_DIR is set', () => {
    expect(hasDisk({})).toBe(true);
    expect(hasDisk({ VERCEL: '1' })).toBe(false);
    expect(hasDisk({ VERCEL: '1', IMAGE_CACHE_DIR: '/tmp/images' })).toBe(true);
  });

  it('defaults BETTER_AUTH_URL to the production address on Vercel production only', () => {
    const prod = { VERCEL: '1', VERCEL_ENV: 'production', VERCEL_PROJECT_PRODUCTION_URL: 'bricks.example.com' };
    expect(defaultAuthUrl(prod)).toBe('https://bricks.example.com');
    expect(defaultAuthUrl({ ...prod, BETTER_AUTH_URL: 'https://mine.example' })).toBeNull(); // never overrides
    expect(defaultAuthUrl({ ...prod, VERCEL_ENV: 'preview' })).toBeNull();
    expect(defaultAuthUrl({ ...prod, VERCEL: undefined })).toBeNull();
    expect(defaultAuthUrl({ ...prod, VERCEL_PROJECT_PRODUCTION_URL: 'evil.example/path?x' })).toBeNull();
    expect(defaultAuthUrl({ ...prod, VERCEL_PROJECT_PRODUCTION_URL: '' })).toBeNull();
  });

  it('gives the sync a time limit on Vercel or with SYNC_TIME_LIMIT', () => {
    const now = 1_000_000;
    expect(syncDeadline({}, now)).toBeUndefined();
    expect(syncDeadline({ VERCEL: '1' }, now)).toBe(now + 180_000); // 300 s function limit minus 2 minutes
    expect(syncDeadline({ SYNC_TIME_LIMIT: '600' }, now)).toBe(now + 600_000);
    expect(syncDeadline({ VERCEL: '1', SYNC_TIME_LIMIT: '600' }, now)).toBe(now + 600_000);
    expect(syncDeadline({ VERCEL: '1', SYNC_TIME_LIMIT: 'off' }, now)).toBeUndefined();
    expect(syncDeadline({ VERCEL: '1', SYNC_TIME_LIMIT: '0' }, now)).toBeUndefined();
    expect(syncDeadline({ VERCEL: '1', SYNC_TIME_LIMIT: 'soon' }, now)).toBe(now + 180_000); // unreadable: the default
  });
});
