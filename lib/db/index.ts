// Returns the app's database. DB_DRIVER=d1 on Cloudflare (binding `DB`); a libsql:/https:/file: DATABASE_URL
// uses libSQL (Turso or a local libSQL file); otherwise a local SQLite file via better-sqlite3.
import 'server-only';
import type { DB } from './types';
import { hostProblem } from '../hosting';

export type { DB } from './types';

export async function getDb(): Promise<DB> {
  if (process.env.DB_DRIVER === 'd1') return (await import('./d1')).d1Db();
  const problem = hostProblem(process.env); // e.g. Vercel without a libSQL DATABASE_URL: say so, not "can't open app.db"
  if (problem) throw new Error(problem);
  const url = process.env.DATABASE_URL;
  if (process.env.DB_DRIVER === 'libsql' || (url && /^(libsql|https?|wss?|file):/i.test(url))) return (await import('./libsql')).libsqlDb();
  return (await import('./node')).nodeDb().db;
}
