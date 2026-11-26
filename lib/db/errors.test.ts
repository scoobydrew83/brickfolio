import { expect, it } from 'vitest';
import { describeDbError } from './errors';

const kind = (e: unknown, env: Record<string, string> = {}) => describeDbError(e, env)?.kind ?? null;
const sqlite = (code: string, message: string) => Object.assign(new Error(message), { code });

it('recognizes SQLite failures by code or message', () => {
  expect(kind(sqlite('SQLITE_BUSY', 'database is locked'))).toBe('locked');
  expect(kind(sqlite('SQLITE_READONLY', 'attempt to write a readonly database'))).toBe('permission');
  expect(kind(new Error("EACCES: permission denied, mkdir '/data'"))).toBe('permission');
  expect(kind(sqlite('SQLITE_CANTOPEN', 'unable to open database file'))).toBe('missing-file');
  expect(kind(sqlite('SQLITE_FULL', 'database or disk is full'))).toBe('disk-full');
  expect(kind(sqlite('SQLITE_CORRUPT', 'database disk image is malformed'))).toBe('corrupt');
  expect(kind(new Error('no such table: sets'))).toBe('not-migrated');
});

it('looks through causes, and tells D1 and libSQL apart', () => {
  expect(kind(new Error('Failed query', { cause: sqlite('SQLITE_BUSY', 'database is locked') }))).toBe('locked');
  expect(describeDbError(new Error('no such table: sets'), { DB_DRIVER: 'd1' })?.fix).toMatch(/wrangler d1 migrations apply/);
  expect(kind(new Error('D1_ERROR: something'), { DB_DRIVER: 'd1' })).toBe('d1');
  expect(kind(Object.assign(new Error('SERVER_ERROR: Server returned HTTP status 401'), { name: 'LibsqlError' }))).toBe('remote');
  expect(kind(new Error('On Vercel, set DATABASE_URL to a libSQL/Turso database'))).toBe('config');
});

it('leaves other errors alone', () => {
  expect(kind(new Error('BrickLink: daily limit reached'))).toBeNull();
  expect(kind(null)).toBeNull();
});
