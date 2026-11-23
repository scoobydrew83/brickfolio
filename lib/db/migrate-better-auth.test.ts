// The Better Auth migrations (0034, 0035, #90) on a database from #50: people, admins and roles move into Better
// Auth's tables, nothing is rebuilt, and access comes out the same.
import { afterEach, expect, it, vi } from 'vitest';
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { openNodeDb } from './node';
import * as schema from './schema';
import type { DB } from './types';
import { resolveAccess, stillShares } from '../service/permissions';

vi.mock('server-only', () => ({}));

const BEFORE = '0033_users';
let dir = '';
afterEach(() => { vi.unstubAllEnvs(); if (dir) rmSync(dir, { recursive: true, force: true }); });

function oldMigrations(last: string): string {
  dir = mkdtempSync(join(tmpdir(), 'brickfolio-mig-ba-'));
  const journal = JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8'));
  const keep = journal.entries.slice(0, journal.entries.findIndex((e: { tag: string }) => e.tag === last) + 1);
  for (const f of readdirSync('drizzle')) if (keep.some((e: { tag: string }) => f === `${e.tag}.sql`)) cpSync(join('drizzle', f), join(dir, f));
  cpSync('drizzle/meta', join(dir, 'meta'), { recursive: true });
  writeFileSync(join(dir, 'meta/_journal.json'), JSON.stringify({ ...journal, entries: keep }));
  return dir;
}

it('only creates tables and inserts rows', () => {
  for (const f of ['0034_better_auth.sql', '0035_better_auth_backfill.sql']) {
    const sql = readFileSync(`drizzle/${f}`, 'utf8');
    expect(sql).not.toMatch(/__new_|DROP TABLE|ALTER TABLE|PRAGMA/i);
  }
});

it('moves users, admins and roles over, keeping what everyone may do', async () => {
  vi.stubEnv('MIGRATIONS_DIR', oldMigrations(BEFORE));
  const { sqlite } = openNodeDb(':memory:');
  sqlite.prepare("INSERT INTO collections (id, name, sort) VALUES (2, 'Kids', 1)").run();
  sqlite.prepare("INSERT INTO users (login, name, admin, last_seen_at) VALUES ('a@x', 'Ann', 1, '2026-01-01T00:00:00.000Z'), ('v@x', NULL, 0, NULL), ('o@x', NULL, 0, NULL)").run();
  sqlite.prepare("INSERT INTO collection_members (collection_id, login, role) VALUES (2, 'v@x', 'viewer'), (2, 'o@x', 'owner'), (1, 'o@x', 'editor'), (2, 'ghost@x', 'editor')").run();
  migrate(drizzle(sqlite, { schema }), { migrationsFolder: './drizzle' });

  expect(sqlite.prepare('SELECT email, name, role, last_seen_at FROM user ORDER BY email').all()).toEqual([
    { email: 'a@x', name: 'Ann', role: 'admin', last_seen_at: '2026-01-01T00:00:00.000Z' },
    { email: 'ghost@x', name: 'ghost@x', role: 'user', last_seen_at: null },
    { email: 'o@x', name: 'o@x', role: 'user', last_seen_at: null },
    { email: 'v@x', name: 'v@x', role: 'user', last_seen_at: null },
  ]);
  expect(sqlite.prepare('SELECT id, collection_id FROM organization ORDER BY collection_id').all()).toEqual([{ id: 'col_1', collection_id: 1 }, { id: 'col_2', collection_id: 2 }]);
  expect(sqlite.prepare('SELECT count(*) n FROM member').get()).toEqual({ n: 4 });

  const db = drizzle(sqlite, { schema }) as unknown as DB;
  const env = { ADMIN_USERS: 'nobody@x' };
  const as = (user: string) => resolveAccess(db, { user, via: 'tailscale' }, env);
  expect((await as('a@x')).admin).toBe(true);
  expect([...(await as('o@x')).roles].sort()).toEqual([[1, 'editor'], [2, 'owner']]);
  expect([...(await as('v@x')).roles]).toEqual([[2, 'viewer']]);
  expect(await stillShares(db, 'o@x', 2, env)).toBe(true);
  expect(await stillShares(db, 'o@x', 1, env)).toBe(false);
});
