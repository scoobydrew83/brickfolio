// Spike for #90: run the suite against libSQL instead of better-sqlite3 (`npx vitest run -c vitest.libsql.config.mts`).
// Every openNodeDb() — which tests call synchronously — gets a fresh copy of one libSQL file that the real drizzle/
// migrations were applied to once, through drizzle-orm/libsql's migrator. `sqlite` is the libSQL client, so tests
// that use better-sqlite3's own API (prepare/pragma/backup) fail by design.
import { vi } from 'vitest';
import { copyFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { openLibsqlDb } from './libsql';
import * as schema from './schema';

const dir = mkdtempSync(join(tmpdir(), 'brickfolio-libsql-'));
const template = join(dir, 'template.db');
const { client: t } = await openLibsqlDb(`file:${template}`);
t.close();
let n = 0;

vi.mock('@/lib/db/node', async (importOriginal) => {
  const real = await importOriginal<typeof import('./node')>();
  return {
    ...real,
    openNodeDb: () => {
      const file = join(dir, `db-${process.pid}-${n++}.db`);
      copyFileSync(template, file);
      const client = createClient({ url: `file:${file}`, concurrency: 1 });
      return { db: drizzle(client, { schema }), sqlite: client };
    },
  };
});
