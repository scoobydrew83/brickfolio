// Local SQLite file via better-sqlite3 (Docker, `npm run dev`). Migrations run on first open.
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import * as schema from './schema';
import type { DB } from './types';

export const dbPath = () => resolve(/*turbopackIgnore: true*/ process.env.DATABASE_PATH || './data/app.db');

/** Opens a database and brings it up to date. `:memory:` is used by tests. */
export function openNodeDb(path: string): { db: DB; sqlite: Database.Database } {
  if (path !== ':memory:') mkdirSync(/*turbopackIgnore: true*/ dirname(path), { recursive: true });
  const sqlite = new Database(path);
  sqlite.pragma('journal_mode = WAL'); // readers don't block the sync's writes
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: resolve(/*turbopackIgnore: true*/ process.env.MIGRATIONS_DIR || './drizzle') });
  return { db: db as unknown as DB, sqlite };
}

// One connection per server process, kept across dev hot reloads.
const g = globalThis as unknown as { __brickfolioDb?: ReturnType<typeof openNodeDb> };
export const nodeDb = () => (g.__brickfolioDb ??= openNodeDb(dbPath()));
