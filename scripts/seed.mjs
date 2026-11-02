// Fills a database with demo data (see lib/db/seed.mjs).
//   npm run seed                      → ./data/app.db (or DATABASE_PATH)
//   npm run seed -- --force           → also when the database already has sets
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { seedDemo } from '../lib/db/seed.mjs';

const path = resolve(process.env.DATABASE_PATH || './data/app.db');
const force = process.argv.includes('--force');
mkdirSync(dirname(path), { recursive: true });
const sqlite = new Database(path);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');
migrate(drizzle(sqlite), { migrationsFolder: resolve(process.env.MIGRATIONS_DIR || './drizzle') });

const have = sqlite.prepare('SELECT count(*) AS n FROM sets').get().n;
if (have && !force) {
  console.error(`${path} already has ${have} sets. Run with --force to add the demo data anyway.`);
  process.exit(1);
}

const n = seedDemo(sqlite);
console.log(`Seeded ${path}: ${n} sets, 30 days of history, 4 wishlist items. Prices are demo data.`);
sqlite.close();
