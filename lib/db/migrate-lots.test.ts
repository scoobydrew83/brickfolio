// The loose-parts migration (0028) on a database from before it: builds keep their parts lists (no table rebuild,
// which on D1 would cascade and delete them) and become alternates.
import { afterEach, expect, it, vi } from 'vitest';
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { openNodeDb } from './node';
import * as schema from './schema';

vi.mock('server-only', () => ({}));

const BEFORE = '0027_layouts';
let dir = '';
afterEach(() => { vi.unstubAllEnvs(); if (dir) rmSync(dir, { recursive: true, force: true }); });

function oldMigrations(last: string): string {
  dir = mkdtempSync(join(tmpdir(), 'brickfolio-mig-lots-'));
  const journal = JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8'));
  const keep = journal.entries.slice(0, journal.entries.findIndex((e: { tag: string }) => e.tag === last) + 1);
  for (const f of readdirSync('drizzle')) if (keep.some((e: { tag: string }) => f === `${e.tag}.sql`)) cpSync(join('drizzle', f), join(dir, f));
  cpSync('drizzle/meta', join(dir, 'meta'), { recursive: true });
  writeFileSync(join(dir, 'meta/_journal.json'), JSON.stringify({ ...journal, entries: keep }));
  return dir;
}

it('adds lots, reservations and builds.kind without rebuilding builds', () => {
  const sql = readFileSync('drizzle/0028_loose_parts.sql', 'utf8');
  expect(sql).not.toMatch(/__new_|DROP TABLE/i);

  vi.stubEnv('MIGRATIONS_DIR', oldMigrations(BEFORE));
  const { sqlite } = openNodeDb(':memory:');
  const b = sqlite.prepare("INSERT INTO builds (moc_no, name, source_set_no) VALUES ('MOC-1', 'Cart', '31120-1')").run().lastInsertRowid;
  sqlite.prepare("INSERT INTO build_parts (build_id, part_no, color_id, qty) VALUES (?, '3001', 5, 4)").run(b);
  migrate(drizzle(sqlite, { schema }), { migrationsFolder: './drizzle' });
  expect(sqlite.prepare('SELECT moc_no, kind FROM builds').all()).toEqual([{ moc_no: 'MOC-1', kind: 'alternate' }]);
  expect(sqlite.prepare('SELECT count(*) AS n FROM build_parts').get()).toEqual({ n: 1 });
  expect(sqlite.prepare('SELECT count(*) AS n FROM part_lots').get()).toEqual({ n: 0 });
});
