// Upgrading a 0.8.1 database: barcodes move from set_barcodes into identifiers + barcode_details, and minifigures with
// both numbers get a mapping. Runs the real migrations: first up to 0017 (0.8.1), then the rest.
import { afterEach, expect, it } from 'vitest';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { openNodeDb } from './node';
import { resolve as resolveId } from '../identifiers/resolve';
import { barcodeStats, resolveBarcode } from '../barcode/resolve';
import type { DB } from './types';

const dirs: string[] = [];
afterEach(() => { delete process.env.MIGRATIONS_DIR; for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

it('moves every saved barcode and minifig pair into identifiers', async () => {
  const old = mkdtempSync(join(tmpdir(), 'brickfolio-migrate-'));
  dirs.push(old);
  cpSync(resolve('drizzle'), old, { recursive: true });
  const journalPath = join(old, 'meta', '_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: { idx: number }[] };
  writeFileSync(journalPath, JSON.stringify({ ...journal, entries: journal.entries.filter((e) => e.idx <= 17) }));

  process.env.MIGRATIONS_DIR = old;
  const { sqlite } = openNodeDb(':memory:');
  const run = (sql: string, ...args: unknown[]) => sqlite.prepare(sql).run(...args);
  run(`INSERT INTO set_barcodes (barcode, format, gtin, set_no, source, verified, region, source_ref, name, year, pieces, image_url, first_seen_at, last_seen_at, verified_at, created_at, updated_at)
       VALUES ('673419264150', 'UPC_A', '0673419264150', '75192-1', 'user', 1, 'US', NULL, NULL, NULL, NULL, NULL, '2026-01-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z', '2026-01-01T00:00:00.000Z', '2026-01-03T00:00:00.000Z')`);
  run(`INSERT INTO set_barcodes (barcode, format, gtin, set_no, source, source_ref, name, year, pieces, image_url)
       VALUES ('673419264150', 'UPC_A', '0673419264150', '10179-1', 'comparethebricks', 'ctb-1', 'UCS Falcon', 2007, 5195, 'https://img/10179.jpg')`);
  run(`INSERT INTO set_barcodes (barcode, format, gtin, set_no, source) VALUES ('5702015869935', 'EAN_13', '5702015869935', '10497-1', 'community')`);
  run(`INSERT INTO set_barcodes (barcode, format, gtin, set_no, source) VALUES ('5702015869935', 'EAN_13', '5702015869935', '10497-1', 'brickset')`);
  run(`INSERT INTO minifigs (fig_no, rb_fig_no, name) VALUES ('sw0001', 'fig-000123', 'Luke'), ('sw0002', NULL, 'Han'), (NULL, 'fig-013525', 'Detective')`);
  const before = sqlite.prepare('SELECT * FROM set_barcodes ORDER BY id').all() as Record<string, unknown>[];

  migrate(drizzle(sqlite), { migrationsFolder: resolve('drizzle') });
  const db = drizzle(sqlite) as unknown as DB;

  expect(sqlite.prepare("SELECT name FROM sqlite_master WHERE name = 'set_barcodes'").get()).toBeUndefined();
  const after = sqlite.prepare(`SELECT i.value AS gtin, i.canonical AS set_no, i.source, i.verified, i.region, i.source_ref, i.first_seen_at, i.last_seen_at, i.verified_at, i.created_at, i.updated_at,
      d.barcode, d.format, d.name, d.year, d.pieces, d.image_url
    FROM identifiers i JOIN barcode_details d ON d.identifier_id = i.id WHERE i.kind = 'set' AND i.scheme = 'gtin' ORDER BY i.id`).all();
  expect(after).toEqual(before.map(({ id: _, ...r }) => r));

  expect(sqlite.prepare("SELECT kind, scheme, value, canonical, source, verified FROM identifiers WHERE kind = 'minifig'").all())
    .toEqual([{ kind: 'minifig', scheme: 'rebrickable', value: 'fig-000123', canonical: 'sw0001', source: 'user', verified: 1 }]);
  expect((await resolveId(db, 'minifig', 'rebrickable', 'fig-000123')).canonical).toBe('sw0001');

  // Scanning and the Settings counts are as before.
  expect(await barcodeStats(db)).toEqual({ total: 4, user: 1, community: 1, brickset: 1, providers: 1 });
  expect(await resolveBarcode(db, '673419264150', { providers: [], readOnly: true })).toMatchObject({ status: 'matched', candidates: [{ setNo: '75192-1', source: 'user' }] });
  expect(await resolveBarcode(db, '5702015869935', { providers: [], readOnly: true })).toMatchObject({ status: 'matched', candidates: [{ setNo: '10497-1', source: 'community' }] });
});
