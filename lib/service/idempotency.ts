// Idempotency keys for API batches: sending the same Idempotency-Key again returns the first answer instead of doing
// the work twice. Used by the scanner's batch add and by POST /api/v1/prices.
import { eq, lt } from 'drizzle-orm';
import { idempotencyKeys } from '../db/schema';
import type { DB } from '../db/types';
import type { Result } from './sets';

/** Keys are kept a day: long enough for any retry, short enough that the table stays tiny. */
const KEY_HOURS = 24;
const PENDING = '{"pending":true}';

/**
 * Runs `fn` once per key. A key seen before returns its first answer with `replayed: true`; one still running answers
 * 409. When `fn` fails (or returns an error), the key is released so a retry can run. Keys are namespaced by `scope`,
 * so the same key sent to two endpoints doesn't collide ('' keeps the key as sent, as the scanner always has).
 */
export async function withIdempotency<T extends object>(db: DB, scope: string, rawKey: string | null | undefined, fn: () => Promise<Result<T>>): Promise<Result<T & { replayed?: true }>> {
  const key = rawKey ? `${scope ? `${scope}:` : ''}${String(rawKey).slice(0, 100)}` : null;
  if (!key) return fn();
  await db.delete(idempotencyKeys).where(lt(idempotencyKeys.createdAt, new Date(Date.now() - KEY_HOURS * 3_600_000).toISOString()));
  const claimed = await db.insert(idempotencyKeys).values({ key, result: PENDING }).onConflictDoNothing().returning({ key: idempotencyKeys.key }).all();
  if (!claimed.length) {
    const prev = await db.select().from(idempotencyKeys).where(eq(idempotencyKeys.key, key)).get();
    if (!prev || prev.result === PENDING) return { ok: false, status: 409, error: 'This batch is already being saved.' };
    return { ok: true, ...(JSON.parse(prev.result) as T), replayed: true };
  }
  try {
    const r = await fn();
    if (r.ok) {
      const { ok: _ok, ...rest } = r;
      await db.update(idempotencyKeys).set({ result: JSON.stringify(rest) }).where(eq(idempotencyKeys.key, key));
    } else {
      await db.delete(idempotencyKeys).where(eq(idempotencyKeys.key, key)); // nothing to replay: let a retry run
    }
    return r;
  } catch (e) {
    await db.delete(idempotencyKeys).where(eq(idempotencyKeys.key, key));
    throw e;
  }
}
