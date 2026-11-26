// Plain explanations for the ways opening or reading the database fails, so the app can say what's wrong and how to
// fix it instead of a bare stack trace. Used by the database check in the app shell and by /api/health.
// Only fixed text is shown to people; the raw error stays in the server log.

export type DbProblemKind = 'config' | 'permission' | 'missing-file' | 'locked' | 'disk-full' | 'corrupt' | 'not-migrated' | 'd1' | 'remote';
export type DbProblem = { kind: DbProblemKind; title: string; fix: string };

const text = (e: unknown): string => {
  if (!e) return '';
  const parts: string[] = [];
  let cur: unknown = e;
  for (let i = 0; cur && i < 4; i++) { // the error and up to three causes
    const x = cur as { message?: unknown; code?: unknown; cause?: unknown };
    parts.push(String(x.code ?? ''), String(x.message ?? (typeof cur === 'string' ? cur : '')));
    cur = x.cause;
  }
  return parts.join(' ');
};

/** What went wrong with the database, in plain words, or null when the error isn't a known database failure. */
export function describeDbError(e: unknown, env: Record<string, string | undefined> = process.env): DbProblem | null {
  const t = text(e);
  const d1 = env.DB_DRIVER === 'd1';
  if (/On Vercel, set DATABASE_URL/.test(t)) return { kind: 'config', title: 'The database isn’t configured for this host.', fix: t.trim() };
  if (/no such table|no such column/i.test(t)) {
    return { kind: 'not-migrated', title: 'The database is missing tables, so its migrations haven’t run.', fix: d1
      ? 'Apply them with `npx wrangler d1 migrations apply <database> --remote` (see docs/cloudflare.md), then reload.'
      : 'Migrations run when the app opens the database. Check the server log for the first error after starting, and that MIGRATIONS_DIR (if set) points at the drizzle folder.' };
  }
  if (/SQLITE_BUSY|database is locked/i.test(t)) return { kind: 'locked', title: 'The database is busy (locked by another process).', fix: 'Wait a moment and retry. If it keeps happening, make sure only one Brickfolio container uses the same app.db, and that nothing else (a backup tool, a DB browser) holds it open.' };
  if (/SQLITE_FULL|ENOSPC|disk is full|database or disk is full/i.test(t)) return { kind: 'disk-full', title: 'The server’s disk is full.', fix: 'Free space on the volume that holds the data folder (old backups in /data/backups and the image cache in /data/images are safe to remove), then retry.' };
  if (/SQLITE_CORRUPT|SQLITE_NOTADB|malformed|file is not a database/i.test(t)) return { kind: 'corrupt', title: 'The database file is damaged.', fix: 'Stop the app and restore the newest good copy from /data/backups (see docs/backup-restore.md).' };
  if (/SQLITE_READONLY|readonly database|EACCES|EPERM|permission denied/i.test(t)) return { kind: 'permission', title: 'The app can’t write to its data folder.', fix: 'The folder holding app.db (DATABASE_PATH, /data on Docker) must be writable by the user the app runs as. On Docker, use the named volume from the compose file, or chown a bind-mounted folder to that user.' };
  if (/SQLITE_CANTOPEN|unable to open database file|ENOENT/i.test(t)) return { kind: 'missing-file', title: 'The database file can’t be opened.', fix: 'Check DATABASE_PATH and that its folder exists and is mounted (on Docker, the data volume at /data).' };
  if (d1 && /D1_|binding|DB\b.*undefined|Cannot read properties of undefined/i.test(t)) return { kind: 'd1', title: 'The D1 database isn’t reachable.', fix: 'Check the `DB` binding under d1_databases in wrangler.jsonc and that the database exists in your Cloudflare account, then redeploy.' };
  if (/LibsqlError|SERVER_ERROR|URL_INVALID|Unauthorized|\b401\b|ENOTFOUND|ECONNREFUSED|fetch failed/i.test(t)) return { kind: 'remote', title: 'The remote database (libSQL / Turso) can’t be reached.', fix: 'Check DATABASE_URL and DATABASE_AUTH_TOKEN, and that the server can reach that host.' };
  return null;
}
