// libSQL: Turso (libsql://…, https://…) or a local libSQL file (file:…). Selected by DATABASE_URL (see index.ts).
// Spike for #90: lets the app run on hosts without a persistent disk (Vercel, Render free tier).
import { createClient, type Client } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { resolve } from 'node:path';
import * as schema from './schema';
import type { DB } from './types';
import { migrateAtRuntime } from '../hosting';

/** Opens a libSQL database and applies the drizzle/ migrations (idempotent; tracked in __drizzle_migrations). */
export async function openLibsqlDb(url: string, authToken?: string, opts: { migrate?: boolean } = {}): Promise<{ db: DB; client: Client }> {
  const client = createClient({ url, authToken, concurrency: 1 });
  // Foreign keys are per connection in SQLite. Turso enables them server-side; a local file needs the pragma.
  // concurrency: 1 keeps one local connection so the pragma sticks.
  if (url.startsWith('file:')) await client.execute('PRAGMA foreign_keys = ON');
  const db = drizzle(client, { schema });
  if (opts.migrate !== false) await migrate(db, { migrationsFolder: resolve(/*turbopackIgnore: true*/ process.env.MIGRATIONS_DIR || './drizzle') });
  return { db: db as unknown as DB, client };
}

// One client per server instance (per warm serverless function), migrated on first use (not on Vercel: there
// scripts/migrate.mjs runs them at build time; see lib/hosting.ts). A failed open isn't kept, so the next request
// tries again instead of the instance failing until it's recycled.
const g = globalThis as unknown as { __brickfolioLibsql?: Promise<{ db: DB; client: Client }> };
export const libsqlDb = async (): Promise<DB> => {
  const opening = (g.__brickfolioLibsql ??= openLibsqlDb(process.env.DATABASE_URL!, process.env.DATABASE_AUTH_TOKEN, { migrate: migrateAtRuntime(process.env) }));
  try {
    return (await opening).db;
  } catch (e) {
    if (g.__brickfolioLibsql === opening) g.__brickfolioLibsql = undefined;
    throw e;
  }
};
