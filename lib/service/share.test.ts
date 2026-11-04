import { beforeEach, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { openNodeDb } from '../db/node';
import { minifigs, shareLinks } from '../db/schema';
import type { DB } from '../db/types';
import { checkShareLink, createShareLink, listShareLinks, parseShareInput, revokeShareLink, sharedCollection, type ShareInput } from './share';
import { addSet } from './sets';
import { createToken } from './tokens';

vi.mock('server-only', () => ({}));

let db: DB;
const NOW = new Date('2026-11-04T12:00:00Z');
const input = (o: Partial<ShareInput> = {}): ShareInput => ({ name: 'For Dad', showValues: false, showLocations: false, showNotes: false, showMinifigs: true, expiresAt: null, ...o });
const make = async (o: Partial<ShareInput> = {}) => {
  const r = await createShareLink(db, input(o));
  if (!r.ok) throw new Error(r.error);
  return r;
};

beforeEach(async () => {
  db = openNodeDb(':memory:').db;
  await db.insert(await import('../db/schema').then((m) => m.locations)).values({ name: 'SecretShelf', sort: 9 }).onConflictDoNothing();
  await addSet(db, { setNo: '10280-1', name: 'Flower Bouquet', condition: 'Used', location: 'SecretShelf', notes: 'SecretNote', copy: { pricePaid: 31.41 } }, { lookup: null });
  await db.insert(minifigs).values({ figNo: 'sw0001', name: 'Battle Droid', qty: 2, location: 'SecretShelf', notes: 'SecretFigNote', avgSold: 27.18 });
});

it('validates the name and expiry', () => {
  expect(parseShareInput({ name: '' }, NOW).ok).toBe(false);
  expect(parseShareInput({ name: 'x'.repeat(61) }, NOW).ok).toBe(false);
  expect(parseShareInput({ name: 'a' }, NOW)).toEqual({ ok: true, value: input({ name: 'a' }) });
  expect(parseShareInput({ name: 'a', expires: '7' }, NOW)).toMatchObject({ ok: true, value: { expiresAt: '2026-11-11T12:00:00.000Z' } });
  expect(parseShareInput({ name: 'a', expires: '2026-12-01' }, NOW)).toMatchObject({ ok: true, value: { expiresAt: '2026-12-01T23:59:59.999Z' } });
  expect(parseShareInput({ name: 'a', expires: '2026-01-01' }, NOW).ok).toBe(false); // past
  expect(parseShareInput({ name: 'a', expires: '2040-01-01' }, NOW).ok).toBe(false); // over 5 years
  expect(parseShareInput({ name: 'a', expires: 'soon' }, NOW).ok).toBe(false);
  expect(parseShareInput({ name: 'a', showValues: 'on', showMinifigs: false }, NOW)).toMatchObject({ ok: true, value: { showValues: true, showMinifigs: false } });
});

it('creates, checks and revokes; stores only the hash and counts views', async () => {
  const { token, id } = await make();
  expect(token).toMatch(/^bfs_[A-Za-z0-9_-]{43}$/);
  const [row] = await db.select().from(shareLinks).all();
  expect(row.hash).not.toContain(token);
  expect(row.prefix).toBe(token.slice(0, 8));
  expect(JSON.stringify(await listShareLinks(db))).not.toContain(row.hash);

  expect(await checkShareLink(db, token)).toMatchObject({ id, name: 'For Dad' });
  await checkShareLink(db, token);
  expect((await listShareLinks(db))[0]).toMatchObject({ views: 2, lastViewedAt: expect.any(String) });

  expect(await checkShareLink(db, token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A'))).toBeNull();
  expect(await revokeShareLink(db, id)).toEqual({ ok: true });
  expect(await checkShareLink(db, token)).toBeNull();
  expect(await revokeShareLink(db, id)).toMatchObject({ ok: false, status: 404 });
});

it('refuses expired links and API tokens', async () => {
  const { token, id } = await make({ expiresAt: '2026-11-05T00:00:00.000Z' });
  expect(await checkShareLink(db, token, NOW)).not.toBeNull();
  expect(await checkShareLink(db, token, new Date('2026-11-05T00:00:01Z'))).toBeNull();
  await db.update(shareLinks).set({ expiresAt: null }).where(eq(shareLinks.id, id));
  const api = await createToken(db, 'script');
  expect(api.ok && (await checkShareLink(db, api.token))).toBeNull(); // bf_ tokens never open a share page
});

it('shows only what the link allows', async () => {
  const hidden = JSON.stringify(await sharedCollection(db, input(), 'USD'));
  for (const secret of ['SecretShelf', 'SecretNote', 'SecretFigNote', '31.41', '27.18', 'blError', '"id"', 'estValue', 'costBasis', 'missingPct', 'registered']) {
    expect(hidden).not.toContain(secret);
  }
  const c = await sharedCollection(db, input(), 'USD');
  expect(c.sets[0]).toMatchObject({ setNo: '10280-1', name: 'Flower Bouquet', qty: 1, copies: '1 built', condition: 'Used' });
  expect(c.totals).toEqual({ sets: 1, copies: 1, pieces: 0, minifigs: 2 });

  expect(JSON.stringify(await sharedCollection(db, input({ showLocations: true }), 'USD'))).toContain('SecretShelf');
  const notes = JSON.stringify(await sharedCollection(db, input({ showNotes: true }), 'USD'));
  expect(notes).toContain('SecretNote');
  expect(notes).not.toContain('SecretShelf');
  const values = await sharedCollection(db, input({ showValues: true }), 'USD');
  expect(values.minifigs[0].estValue).toBe(27.18);
  expect(values.totals.estValue).toBe(54.36);
  expect(JSON.stringify(values)).not.toContain('SecretShelf');
  expect((await sharedCollection(db, input({ showMinifigs: false }), 'USD')).minifigs).toEqual([]);
});
