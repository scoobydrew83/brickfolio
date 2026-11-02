import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import type * as schema from './schema';

/** Either driver: better-sqlite3 (sync) or D1 (async). Always `await` queries so code works with both. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DB = BaseSQLiteDatabase<'sync' | 'async', any, typeof schema>;
