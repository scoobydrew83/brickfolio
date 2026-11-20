// The collections migration (0032) on a database from before it: every copy and minifigure lands in "My collection"
// (id 1), and nothing is rebuilt.
import { afterEach, expect, it, vi } from 'vitest';
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { openNodeDb } from './node';
import * as schema from './schema';

vi.mock('server-only', () => ({}));

const BEFORE = '0031_rebrickable_parts_lists';
let dir = '';
afterEach(() => { vi.unstubAllEnvs(); if (dir) rmSync(dir, { recursive: true, force: true }); });

function oldMigrations(last: string): string {
  dir = mkdtempSync(join(tmpdir(), 'brickfolio-mig-collections-'));
  const journal = JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8'));
  const keep = journal.entries.slice(0, journal.entries.findIndex((e: { tag: string }) => e.tag === last) + 1);
  for (const f of readdirSync('drizzle')) if (keep.some((e: { tag: string }) => f === `${e.tag}.sql`)) cpSync(join('drizzle', f), join(dir, f));
  cpSync('drizzle/meta', join(dir, 'meta'), { recursive: true });
  writeFileSync(join(dir, 'meta/_journal.json'), JSON.stringify({ ...journal, entries: keep }));
  return dir;
}

it('puts every copy and minifigure in My collection without rebuilding a table', () => {
  const sql = readFileSync('drizzle/0032_collections.sql', 'utf8');
  expect(sql).not.toMatch(/__new_|DROP TABLE/i);

  vi.stubEnv('MIGRATIONS_DIR', oldMigrations(BEFORE));
  const { sqlite } = openNodeDb(':memory:');
  const set = sqlite.prepare("INSERT INTO sets (set_no, name) VALUES ('10497-1', 'Galaxy Explorer')").run().lastInsertRowid;
  sqlite.prepare("INSERT INTO set_copies (set_id, status, condition) VALUES (?, 'sealed', 'New'), (?, 'built', 'Used')").run(set, set);
  sqlite.prepare("INSERT INTO minifigs (fig_no, name, qty) VALUES ('sw0001', 'Luke', 2)").run();
  migrate(drizzle(sqlite, { schema }), { migrationsFolder: './drizzle' });
  expect(sqlite.prepare('SELECT id, name FROM collections').all()).toEqual([{ id: 1, name: 'My collection' }]);
  expect(sqlite.prepare('SELECT DISTINCT collection_id FROM set_copies').all()).toEqual([{ collection_id: 1 }]);
  expect(sqlite.prepare('SELECT fig_no, qty, collection_id FROM minifigs').all()).toEqual([{ fig_no: 'sw0001', qty: 2, collection_id: 1 }]);
  // A figure can now be in two collections, but only once in each.
  sqlite.prepare("INSERT INTO collections (id, name) VALUES (2, 'Kids')").run();
  sqlite.prepare("INSERT INTO minifigs (fig_no, name, collection_id) VALUES ('sw0001', 'Luke', 2)").run();
  expect(() => sqlite.prepare("INSERT INTO minifigs (fig_no, name, collection_id) VALUES ('sw0001', 'Luke', 2)").run()).toThrow(/UNIQUE/);
});
