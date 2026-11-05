// Upgrading a 0.9.0 database: price_snapshots and minifig_price_snapshots become BrickLink sold_avg rows in
// price_observations. Runs the real migrations: first up to 0023 (0.9.0), then the rest.
import { afterEach, expect, it, vi } from 'vitest';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { openNodeDb } from './node';
import { priceHistory } from '../service/sets';
import { getRadar } from '../service/radar';
import type { DB } from './types';

vi.mock('server-only', () => ({}));

const dirs: string[] = [];
afterEach(() => { delete process.env.MIGRATIONS_DIR; for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

it('moves every price snapshot into price_observations', async () => {
  const old = mkdtempSync(join(tmpdir(), 'brickfolio-migrate-'));
  dirs.push(old);
  cpSync(resolve('drizzle'), old, { recursive: true });
  const journalPath = join(old, 'meta', '_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: { idx: number }[] };
  writeFileSync(journalPath, JSON.stringify({ ...journal, entries: journal.entries.filter((e) => e.idx <= 23) }));

  process.env.MIGRATIONS_DIR = old;
  const { sqlite } = openNodeDb(':memory:');
  const run = (sql: string, ...args: unknown[]) => sqlite.prepare(sql).run(...args);
  run("INSERT INTO settings (key, value) VALUES ('currency', 'EUR') ON CONFLICT(key) DO UPDATE SET value = 'EUR'");
  run("INSERT INTO sets (set_no, name, avg_sold, exit_date, retired) VALUES ('10305-1', 'Lion Knights Castle', 300, '2024-11-01', 1), ('10280-1', 'Flower Bouquet', 45, NULL, 0)");
  const id = (no: string) => (sqlite.prepare('SELECT id FROM sets WHERE set_no = ?').get(no) as { id: number }).id;
  run("INSERT INTO set_copies (set_id, status, condition) VALUES (?, 'sealed', 'New'), (?, 'built', 'Used')", id('10305-1'), id('10280-1'));
  run(`INSERT INTO price_snapshots (set_id, date, guide, avg_sold, min_sold, max_sold, qty_sold) VALUES
       (?, '2024-11-05', 'N', 200, 180, 230, 4), (?, '2026-11-01', 'N', 300, 250, 350, 9),
       (?, '2026-10-01', 'U', 40, 30, 50, 12), (?, '2026-11-01', 'U', NULL, NULL, NULL, 0)`, id('10305-1'), id('10305-1'), id('10280-1'), id('10280-1'));
  run("INSERT INTO minifigs (fig_no, rb_fig_no, name) VALUES ('sw0001', NULL, 'Luke'), (NULL, 'fig-000123', 'CMF')");
  const fig = (sqlite.prepare("SELECT id FROM minifigs WHERE fig_no = 'sw0001'").get() as { id: number }).id;
  const rb = (sqlite.prepare("SELECT id FROM minifigs WHERE rb_fig_no = 'fig-000123'").get() as { id: number }).id;
  run("INSERT INTO minifig_price_snapshots (fig_id, date, guide, avg_sold, qty_sold) VALUES (?, '2026-11-01', 'U', 3.5, 20), (?, '2026-11-01', 'U', 9, 1)", fig, rb);
  const before = (sqlite.prepare("SELECT date, guide, avg_sold AS avgSold, min_sold AS minSold, max_sold AS maxSold, qty_sold AS qtySold FROM price_snapshots WHERE set_id = ? ORDER BY date").all(id('10280-1')));
  const db = drizzle(sqlite) as unknown as DB;
  const radarBefore = await getRadarSafe(db);
  expect(radarBefore).toEqual([expect.objectContaining({ perYear: expect.any(Number) })]);

  migrate(drizzle(sqlite), { migrationsFolder: resolve('drizzle') });

  for (const t of ['price_snapshots', 'minifig_price_snapshots']) expect(sqlite.prepare('SELECT name FROM sqlite_master WHERE name = ?').get(t)).toBeUndefined();
  expect(sqlite.prepare('SELECT item_kind, item_id, source, type, condition, currency, amount, low, high, sample_size, observed_on, observed_at FROM price_observations ORDER BY item_kind DESC, item_id, observed_on').all()).toEqual([
    { item_kind: 'set', item_id: '10280-1', source: 'bricklink', type: 'sold_avg', condition: 'U', currency: 'EUR', amount: 40, low: 30, high: 50, sample_size: 12, observed_on: '2026-10-01', observed_at: '2026-10-01T00:00:00.000Z' },
    { item_kind: 'set', item_id: '10280-1', source: 'bricklink', type: 'sold_avg', condition: 'U', currency: 'EUR', amount: null, low: null, high: null, sample_size: 0, observed_on: '2026-11-01', observed_at: '2026-11-01T00:00:00.000Z' },
    { item_kind: 'set', item_id: '10305-1', source: 'bricklink', type: 'sold_avg', condition: 'N', currency: 'EUR', amount: 200, low: 180, high: 230, sample_size: 4, observed_on: '2024-11-05', observed_at: '2024-11-05T00:00:00.000Z' },
    { item_kind: 'set', item_id: '10305-1', source: 'bricklink', type: 'sold_avg', condition: 'N', currency: 'EUR', amount: 300, low: 250, high: 350, sample_size: 9, observed_on: '2026-11-01', observed_at: '2026-11-01T00:00:00.000Z' },
    { item_kind: 'minifig', item_id: 'sw0001', source: 'bricklink', type: 'sold_avg', condition: 'U', currency: 'EUR', amount: 3.5, low: null, high: null, sample_size: 20, observed_on: '2026-11-01', observed_at: '2026-11-01T00:00:00.000Z' },
  ]);
  // GET /api/v1/sets/{setNo}/prices answers as before.
  expect(await priceHistory(db, '10280-1')).toEqual(before);
  // Radar growth is unchanged.
  expect((await getRadar(db, '2026-11-05')).retired.map((r) => r.growth)).toEqual(radarBefore);
});

/** Radar growth on the 0.9.0 schema, read with the 0.9.0 query (price_snapshots by set id). */
async function getRadarSafe(db: DB) {
  const { sql } = await import('drizzle-orm');
  const { growthSince } = await import('../radar');
  const s = (await db.all(sql`SELECT id, exit_date AS exitDate, avg_sold AS avgSold FROM sets WHERE retired = 1`)) as { id: number; exitDate: string; avgSold: number }[];
  return Promise.all(s.map(async (r) => {
    const hist = (await db.all(sql`SELECT date, avg_sold AS avgSold FROM price_snapshots WHERE set_id = ${r.id} AND guide = 'N' ORDER BY date`)) as { date: string; avgSold: number }[];
    return growthSince(r.exitDate, r.avgSold, hist, { price: null, currency: null }, 'EUR', '2026-11-05');
  }));
}
