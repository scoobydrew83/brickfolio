// Applies the drizzle/ migrations to the libSQL/Turso database in DATABASE_URL (+ DATABASE_AUTH_TOKEN), then exits.
// `npm run db:migrate`. Vercel runs it before `next build` (vercel.json), because Vercel's functions don't ship the
// drizzle/ folder and many cold starts at once shouldn't race to migrate (lib/hosting.ts turns runtime migrations off
// there). A failed migration fails the deploy, and the previous deployment keeps serving.
//
// On Vercel only Production builds migrate; a Preview build skips it unless DB_MIGRATE_ON_BUILD=on (give Preview its
// own DATABASE_URL first, or a preview branch's migrations would change your production database).
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { resolve } from 'node:path';

const url = process.env.DATABASE_URL ?? '';
const fail = (msg) => { console.error(`db:migrate: ${msg}`); process.exit(1); };

if (!/^(libsql|https?|wss?|file):/i.test(url)) {
  fail(process.env.VERCEL
    ? 'set DATABASE_URL to a libSQL/Turso database (libsql://…) and DATABASE_AUTH_TOKEN in the project\'s Environment Variables: Vercel has no persistent disk. See docs/hosting.md#vercel.'
    : 'DATABASE_URL must be a libSQL URL (libsql://…, https://… or file:…). The SQLite file (DATABASE_PATH) is migrated when the app opens it.');
}
if (process.env.VERCEL && process.env.VERCEL_ENV !== 'production' && process.env.DB_MIGRATE_ON_BUILD !== 'on') {
  console.log(`db:migrate: skipped on this ${process.env.VERCEL_ENV || 'non-production'} build (set DB_MIGRATE_ON_BUILD=on to migrate its database).`);
  process.exit(0);
}

const client = createClient({ url, authToken: process.env.DATABASE_AUTH_TOKEN || undefined });
try {
  if (url.startsWith('file:')) await client.execute('PRAGMA foreign_keys = ON');
  const folder = resolve(process.env.MIGRATIONS_DIR || './drizzle');
  await migrate(drizzle(client), { migrationsFolder: folder });
  const { rows } = await client.execute('SELECT count(*) AS n FROM __drizzle_migrations');
  console.log(`db:migrate: up to date (${rows[0].n} migrations applied)`);
} catch (e) {
  fail(e instanceof Error ? e.message : String(e));
} finally {
  client.close();
}
