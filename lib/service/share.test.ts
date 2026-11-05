import { beforeEach, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { openNodeDb } from '../db/node';
import { minifigs, shareLinks } from '../db/schema';
import type { DB } from '../db/types';
import { checkShareLink, createShareLink, listShareLinks, parseShareInput, revokeShareLink, sharedCollection, sharesItem, type ShareInput } from './share';
import { editCopy, listCopies } from './copies';
import { getSet } from './sets';
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
  expect(await checkShareLink(db, token, new Date(), { count: false })).toMatchObject({ id }); // photos don't count
  expect((await listShareLinks(db))[0]).toMatchObject({ views: 2 });

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
  const hidden = JSON.stringify(await sharedCollection(db, input(), 'USD', 'bfs_t'));
  for (const secret of ['SecretShelf', 'SecretNote', 'SecretFigNote', '31.41', '27.18', 'blError', '"id"', 'estValue', 'costBasis', 'missingPct', 'registered']) {
    expect(hidden).not.toContain(secret);
  }
  const c = await sharedCollection(db, input(), 'USD', 'bfs_t');
  expect(c.sets[0]).toMatchObject({ setNo: '10280-1', name: 'Flower Bouquet', qty: 1, copies: '1 built', condition: 'Used' });
  expect(c.totals).toEqual({ sets: 1, copies: 1, pieces: 0, minifigs: 2 });

  expect(JSON.stringify(await sharedCollection(db, input({ showLocations: true }), 'USD', 'bfs_t'))).toContain('SecretShelf');
  const notes = JSON.stringify(await sharedCollection(db, input({ showNotes: true }), 'USD', 'bfs_t'));
  expect(notes).toContain('SecretNote');
  expect(notes).not.toContain('SecretShelf');
  const values = await sharedCollection(db, input({ showValues: true }), 'USD', 'bfs_t');
  expect(values.minifigs[0].estValue).toBe(27.18);
  expect(values.totals.estValue).toBe(54.36);
  expect(JSON.stringify(values)).not.toContain('SecretShelf');
  expect((await sharedCollection(db, input({ showMinifigs: false }), 'USD', 'bfs_t')).minifigs).toEqual([]);
});

it('points photos at the share route, and only for items the link shows', async () => {
  await db.update(minifigs).set({ imageUrl: 'https://img.bricklink.com/ItemImage/MN/0/sw0001.png' });
  const { sets } = await import('../db/schema');
  await db.update(sets).set({ imageUrl: 'https://img.bricklink.com/ItemImage/SN/0/10280-1.png' });
  const c = await sharedCollection(db, input(), 'USD', 'bfs_abc');
  expect(c.sets[0].image).toBe('/share/bfs_abc/img/set/10280-1');
  expect(c.minifigs[0].image).toBe('/share/bfs_abc/img/minifig/sw0001');
  expect(JSON.stringify(c)).not.toContain('bricklink.com/ItemImage');

  expect(await sharesItem(db, input(), 'set', '10280-1')).toBe(true);
  expect(await sharesItem(db, input(), 'set', '75192-1')).toBe(false);
  expect(await sharesItem(db, input(), 'minifig', 'sw0001')).toBe(true);
  expect(await sharesItem(db, input({ showMinifigs: false }), 'minifig', 'sw0001')).toBe(false);
  // A set whose only copy was parted out isn't on the page, so neither is its photo.
  const s = await getSet(db, '10280-1');
  const [copy] = await listCopies(db, s!.id);
  expect((await editCopy(db, copy.id, { status: 'parted_out' })).ok).toBe(true);
  expect(await sharesItem(db, input(), 'set', '10280-1')).toBe(false);
});
