// Returns the app's database. DB_DRIVER=d1 on Cloudflare (binding `DB`), otherwise a local SQLite file.
import 'server-only';
import type { DB } from './types';

export type { DB } from './types';

export async function getDb(): Promise<DB> {
  if (process.env.DB_DRIVER === 'd1') return (await import('./d1')).d1Db();
  return (await import('./node')).nodeDb().db;
}
