// Cloudflare D1. Migrations are applied with `wrangler d1 migrations apply` (see docs/cloudflare.md).
import { getCloudflareContext } from '@opennextjs/cloudflare';
import type { D1Database } from '@cloudflare/workers-types';
import { drizzle } from 'drizzle-orm/d1';
import * as schema from './schema';
import type { DB } from './types';

export const d1Db = (): DB => drizzle((getCloudflareContext().env as { DB: D1Database }).DB, { schema }) as unknown as DB;
