// Cloudflare D1. Migrations are applied with `wrangler d1 migrations apply` (see docs/cloudflare.md).
import { getCloudflareContext } from '@opennextjs/cloudflare';
import type { D1Database } from '@cloudflare/workers-types';
import { drizzle } from 'drizzle-orm/d1';
import * as schema from './schema';
import type { DB } from './types';

// One handle per binding (the binding lives as long as the isolate), so things cached per handle, like the Better
// Auth instance (lib/better-auth.ts), aren't rebuilt on every request.
const handles = new WeakMap<D1Database, DB>();

export const d1Db = (): DB => {
  const binding = (getCloudflareContext().env as { DB: D1Database }).DB;
  let db = handles.get(binding);
  if (!db) handles.set(binding, (db = drizzle(binding, { schema }) as unknown as DB));
  return db;
};
