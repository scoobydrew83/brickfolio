// The copies migration (0021/0022) on a database from before it: one copy per unit of qty, nothing else lost.
import { afterEach, expect, it, vi } from 'vitest';
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { openNodeDb } from './node';
import * as schema from './schema';
import type { DB } from './types';
import { listSets, saveHistory, listHistory } from '../service/sets';

vi.mock('server-only', () => ({}));

const BEFORE = '0020_drop_set_barcodes';
let dir = '';
afterEach(() => { vi.unstubAllEnvs(); if (dir) rmSync(dir, { recursive: true, force: true }); });

/** A migrations folder that stops at `last`, like an installation that hasn't upgraded yet. */
function oldMigrations(last: string): string {
  dir = mkdtempSync(join(tmpdir(), 'brickfolio-mig-copies-'));
  const journal = JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8'));
  const keep = journal.entries.slice(0, journal.entries.findIndex((e: { tag: string }) => e.tag === last) + 1);
  for (const f of readdirSync('drizzle')) if (keep.some((e: { tag: string }) => f === `${e.tag}.sql`)) cpSync(join('drizzle', f), join(dir, f));
  cpSync('drizzle/meta', join(dir, 'meta'), { recursive: true });
  writeFileSync(join(dir, 'meta/_journal.json'), JSON.stringify({ ...journal, entries: keep }));
  return dir;
}

it('backfills copies from qty, keeps condition, location and value, and moves missing parts to the first copy', async () => {
  vi.stubEnv('MIGRATIONS_DIR', oldMigrations(BEFORE));
  const { sqlite } = openNodeDb(':memory:');
  const ins = sqlite.prepare('INSERT INTO sets (set_no, name, qty, condition, location, missing_pct, avg_sold, est_value) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  ins.run('10280-1', 'Flower Bouquet', 3, 'Used', 'Display', null, 20, 20);
  ins.run('75192-1', 'Falcon', 1, 'New', 'Storage', null, 800, 800);
  ins.run('6080-1', "King's Castle", 2, 'Partial', null, 12.5, 100, 87.5);
  ins.run('1-1', 'No condition', 1, null, null, null, null, null);
  const castle = (sqlite.prepare("SELECT id FROM sets WHERE set_no = '6080-1'").get() as { id: number }).id;
  sqlite.prepare("INSERT INTO price_snapshots (set_id, date, guide, avg_sold) VALUES (?, '2026-11-01', 'U', 100)").run(castle);
  sqlite.prepare("INSERT INTO set_parts (set_id, part_no, name, type, color_id, qty) VALUES (?, '3001', 'Brick', 'PART', 5, 40)").run(castle);
  sqlite.prepare("INSERT INTO set_missing_parts (set_id, part_no, color_id, type, qty) VALUES (?, '3001', 5, 'PART', 5)").run(castle);
  const before = (sqlite.prepare('SELECT sum(qty) AS copies, sum(est_value * qty) AS value FROM sets').get() as { copies: number; value: number });

  migrate(drizzle(sqlite, { schema }), { migrationsFolder: './drizzle' });
  const db = drizzle(sqlite, { schema }) as unknown as DB;

  const copies = sqlite.prepare('SELECT s.set_no, c.status, c.condition, c.location, c.missing_pct, c.est_value, c.est_guide FROM set_copies c JOIN sets s ON s.id = c.set_id ORDER BY c.id').all();
  expect(copies).toHaveLength(before.copies);
  expect(copies).toEqual([
    ...Array(3).fill({ set_no: '10280-1', status: 'built', condition: 'Used', location: 'Display', missing_pct: null, est_value: 20, est_guide: 'U' }),
    { set_no: '75192-1', status: 'sealed', condition: 'New', location: 'Storage', missing_pct: null, est_value: 800, est_guide: 'N' },
    ...Array(2).fill({ set_no: '6080-1', status: 'built', condition: 'Partial', location: null, missing_pct: 12.5, est_value: 87.5, est_guide: 'U' }),
    { set_no: '1-1', status: 'built', condition: 'Used', location: null, missing_pct: null, est_value: null, est_guide: 'U' },
  ]);
  const firstCastle = (sqlite.prepare('SELECT min(id) AS id FROM set_copies WHERE set_id = ?').get(castle) as { id: number }).id;
  expect(sqlite.prepare('SELECT copy_id FROM set_missing_parts').all()).toEqual([{ copy_id: firstCastle }]);
  // Related rows survive (no table rebuild).
  expect(sqlite.prepare('SELECT count(*) AS n FROM price_snapshots').get()).toEqual({ n: 1 });
  expect(sqlite.prepare('SELECT count(*) AS n FROM set_parts').get()).toEqual({ n: 1 });

  const rows = await listSets(db);
  expect(rows.find((s) => s.setNo === '6080-1')).toMatchObject({ qty: 2, missingPct: 12.5, missingMarked: 5 });
  await saveHistory(db);
  const [h] = await listHistory(db);
  expect(h).toMatchObject({ sets: 4, copies: before.copies, estValue: Math.round(before.value * 100) / 100 });
});

it('the copies migrations only create, add and index: no table rebuild', () => {
  for (const f of ['0021_set_copies.sql', '0022_copies_backfill.sql']) {
    const sql = readFileSync(join('drizzle', f), 'utf8');
    expect(sql).not.toMatch(/__new_|DROP TABLE/i);
  }
});
