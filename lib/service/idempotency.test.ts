import { beforeEach, expect, it } from 'vitest';
import { openNodeDb } from '../db/node';
import { idempotencyKeys } from '../db/schema';
import type { DB } from '../db/types';
import { withIdempotency } from './idempotency';

let db: DB;
beforeEach(() => { db = openNodeDb(':memory:').db; });

it('runs once per key and replays the first answer', async () => {
  let runs = 0;
  const fn = async () => ({ ok: true as const, n: ++runs });
  expect(await withIdempotency(db, 'p', 'k1', fn)).toEqual({ ok: true, n: 1 });
  expect(await withIdempotency(db, 'p', 'k1', fn)).toEqual({ ok: true, n: 1, replayed: true });
  expect(await withIdempotency(db, 'q', 'k1', fn)).toEqual({ ok: true, n: 2 }); // another scope is another key
  expect(await withIdempotency(db, 'p', null, fn)).toEqual({ ok: true, n: 3 }); // no key: no protection
  expect((await db.select().from(idempotencyKeys).all()).map((r) => r.key).sort()).toEqual(['p:k1', 'q:k1']);
  expect(await withIdempotency(db, '', 'raw', fn)).toEqual({ ok: true, n: 4 });
  expect(await db.select().from(idempotencyKeys).all()).toContainEqual(expect.objectContaining({ key: 'raw' })); // the scanner's keys stay as sent
});

it('answers 409 while the first run is still going', async () => {
  let release!: () => void;
  const slow = withIdempotency<object>(db, 'p', 'k', () => new Promise((r) => { release = () => r({ ok: true }); }));
  await new Promise((r) => setTimeout(r, 10));
  expect(await withIdempotency(db, 'p', 'k', async () => ({ ok: true as const }))).toMatchObject({ ok: false, status: 409 });
  release();
  expect(await slow).toEqual({ ok: true });
});

it('releases the key when the work fails, so a retry runs', async () => {
  expect(await withIdempotency(db, 'p', 'k', async () => ({ ok: false as const, error: 'nope' }))).toEqual({ ok: false, error: 'nope' });
  await expect(withIdempotency(db, 'p', 'k', async () => { throw new Error('boom'); })).rejects.toThrow('boom');
  expect(await withIdempotency(db, 'p', 'k', async () => ({ ok: true as const, done: 1 }))).toEqual({ ok: true, done: 1 });
});
