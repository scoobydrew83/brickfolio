// #90: API tokens in Better Auth's apiKey table. Tokens made by the old code (rows in `api_tokens`, hex SHA-256) keep
// working after they're copied over, with the same owner and permissions; the copy is idempotent and never brings a
// revoked token back. Tokens are made up at run time, so secret scanners have no literal to flag.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { openNodeDb } from '../db/node';
import type { DB } from '../db/types';
import { apiTokens, authApiKey, authUser, settings } from '../db/schema';
import * as perm from './permissions';
import { checkToken, createToken, hashKey, listTokens, migrateLegacyTokens, moveLegacyTokens, revokeToken, sha256Hex, SYSTEM_OWNER } from './tokens';

let db: DB;
beforeEach(() => { db = openNodeDb(':memory:').db; });
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

/** A token as the code before #90 made it: a random `bf_…` secret, its hex SHA-256 in `api_tokens`. */
async function legacyToken(name: string, owner: string | null, lastUsedAt: string | null = null) {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const token = 'bf_' + btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const [row] = await db.insert(apiTokens).values({ name, hash: await sha256Hex(token), prefix: token.slice(0, 8), owner, lastUsedAt }).returning().all();
  return { token, row };
}
const keys = () => db.select().from(authApiKey).all();
const access = async (t: { name: string; owner: string | null } | null) => (t ? perm.resolveAccess(db, { user: `token:${t.name}`, via: 'token', owner: t.owner }) : null);

describe('tokens made before #90', () => {
  it('keep working after the copy: same secret, same owner, same permissions', async () => {
    vi.stubEnv('ADMIN_USERS', 'boss@x.test');
    await perm.addPerson(db, 'viewer@x.test');
    const kids = await (await import('./collections')).addCollection(db, 'Kids');
    if (!kids.ok) throw new Error(kids.error);
    await perm.setRole(db, { login: 'boss@x.test', admin: true, roles: new Map() }, kids.collection.id, 'viewer@x.test', 'viewer');
    const used = '2026-01-02T03:04:05.000Z';
    const { token, row } = await legacyToken('phone', 'viewer@x.test', used);

    const t = await checkToken(db, token);
    expect(t).toMatchObject({ id: `legacy_${row.id}`, name: 'phone', owner: 'viewer@x.test' });
    const a = (await access(t))!;
    expect(a.admin).toBe(false);
    expect([...a.roles]).toEqual([[kids.collection.id, 'viewer']]);
    expect(await checkToken(db, token + 'x')).toBeNull();

    // Stored as the plugin stores it, owned by the person's Better Auth user; the old row is left as it was.
    const [k] = await keys();
    const userId = (await db.select({ id: authUser.id }).from(authUser).where(eq(authUser.email, 'viewer@x.test')).get())!.id;
    expect(k).toMatchObject({ key: await hashKey(token), referenceId: userId, prefix: 'bf_', start: token.slice(0, 8), rateLimitEnabled: false, enabled: true, expiresAt: null });
    expect(k.createdAt.toISOString()).toBe(row.createdAt);
    expect(await db.select().from(apiTokens).all()).toEqual([row]);
    // Listed with its name, prefix, created and last-used times.
    expect(await listTokens(db, 'viewer@x.test')).toEqual([expect.objectContaining({ name: 'phone', prefix: token.slice(0, 8), createdAt: row.createdAt, owner: 'viewer@x.test' })]);
  });

  it('without an owner (before #50, or AUTH_MODE=none) still act as admin, listed for admins only', async () => {
    vi.stubEnv('ADMIN_USERS', 'boss@x.test');
    const old = await legacyToken('old', null);
    const cli = await legacyToken('cli', 'local');
    for (const { token } of [old, cli]) {
      const t = await checkToken(db, token);
      expect(t?.owner).toBeNull();
      expect((await access(t))!.admin).toBe(true);
    }
    expect((await keys()).map((k) => k.referenceId)).toEqual([SYSTEM_OWNER, SYSTEM_OWNER]);
    // No account is made for them: nobody can sign in as one, and the first sign-up is still the first account.
    expect(await db.select().from(authUser).all()).toEqual([]);
    expect((await listTokens(db)).map((t) => [t.name, t.owner])).toEqual([['cli', null], ['old', null]]);
    expect(await listTokens(db, 'local')).toEqual([]);
    // Only an admin's revoke (no owner given) removes them.
    const id = (await listTokens(db)).find((t) => t.name === 'old')!.id;
    await revokeToken(db, id, 'local');
    await revokeToken(db, id, 'someone@x.test');
    expect(await checkToken(db, old.token)).not.toBeNull();
    await revokeToken(db, id);
    expect(await checkToken(db, old.token)).toBeNull();
  });

  it('are copied idempotently: twice in a row, or at the same time', async () => {
    const a = await legacyToken('a', 'a@x.test');
    await legacyToken('b', null);
    await moveLegacyTokens(db);
    await moveLegacyTokens(db);
    await Promise.all([moveLegacyTokens(db), moveLegacyTokens(db), migrateLegacyTokens(db)]);
    expect((await keys()).map((k) => k.id).sort()).toEqual([`legacy_${a.row.id}`, `legacy_${a.row.id + 1}`]);
    expect(await db.select().from(authUser).all()).toHaveLength(1);
    expect((await db.select().from(settings).where(eq(settings.key, 'api_tokens_moved_through')).get())?.value).toBe(String(a.row.id + 1));
  });

  it('stay revoked: a revoked or expired copy is never copied again, and its old row goes too (for a rollback)', async () => {
    const a = await legacyToken('a', 'a@x.test');
    const b = await legacyToken('b', 'a@x.test');
    await moveLegacyTokens(db);
    await revokeToken(db, `legacy_${a.row.id}`, 'a@x.test');
    expect(await db.select({ id: apiTokens.id }).from(apiTokens).all()).toEqual([{ id: b.row.id }]);
    // The plugin's own delete (or its sweep of expired keys) removes only the copy: the old row stays, but isn't copied.
    await db.delete(authApiKey).where(eq(authApiKey.id, `legacy_${b.row.id}`));
    await moveLegacyTokens(db);
    expect(await keys()).toEqual([]);
    expect(await checkToken(db, a.token)).toBeNull();
    expect(await checkToken(db, b.token)).toBeNull();
  });

  it('follow a rollback: tokens made on the old version are copied, ones revoked there are removed', async () => {
    const a = await legacyToken('a', 'a@x.test');
    await moveLegacyTokens(db);
    // Back on the old version: a new token, and `a` revoked (deleted from api_tokens only).
    const c = await legacyToken('c', 'a@x.test');
    await db.delete(apiTokens).where(eq(apiTokens.id, a.row.id));
    await moveLegacyTokens(db);
    expect(await checkToken(db, a.token)).toBeNull();
    expect(await checkToken(db, c.token)).toMatchObject({ name: 'c', owner: 'a@x.test' });
  });
});

describe('new tokens', () => {
  it('are made, listed and revoked in the apiKey table, each person seeing only their own', async () => {
    const mine = await createToken(db, 'mine', 'b@x.test');
    const theirs = await createToken(db, 'theirs', 'a@x.test');
    if (!mine.ok || !theirs.ok) throw new Error('not made');
    expect(mine.token).toMatch(/^bf_[\w-]{43}$/);
    expect(await db.select().from(apiTokens).all()).toEqual([]); // nothing new in the old table
    const row = (await keys()).find((k) => k.name === 'mine')!;
    expect(row).toMatchObject({ key: await hashKey(mine.token), start: mine.token.slice(0, 8), rateLimitEnabled: false, expiresAt: null });
    expect(await checkToken(db, mine.token)).toMatchObject({ name: 'mine', owner: 'b@x.test' });

    expect((await listTokens(db, 'b@x.test')).map((t) => t.name)).toEqual(['mine']);
    const other = (await listTokens(db)).find((t) => t.name === 'theirs')!;
    expect(other).toMatchObject({ owner: 'a@x.test', lastUsedAt: null, expiresAt: null });
    await revokeToken(db, other.id, 'b@x.test'); // not b's: nothing happens
    expect(await listTokens(db)).toHaveLength(2);
    await revokeToken(db, other.id);
    expect(await checkToken(db, theirs.token)).toBeNull(); // at once
    expect((await listTokens(db)).map((t) => t.name)).toEqual(['mine']);
  });

  it('made without a login (AUTH_MODE=none) belong to nobody and act as admin', async () => {
    const t = await createToken(db, 'cli', 'local');
    if (!t.ok) throw new Error(t.error);
    expect((await keys())[0].referenceId).toBe(SYSTEM_OWNER);
    expect((await access(await checkToken(db, t.token)))!.admin).toBe(true);
  });

  it('can expire after 30, 90 or 365 days (never by default)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-06-01T00:00:00Z'));
    const t = await createToken(db, 'month', 'a@x.test', 30);
    if (!t.ok) throw new Error(t.error);
    expect((await listTokens(db))[0].expiresAt).toBe('2026-07-01T00:00:00.000Z');
    expect(await createToken(db, 'odd', 'a@x.test', 7)).toMatchObject({ ok: false, status: 400 });
    expect(await createToken(db, '', 'a@x.test')).toMatchObject({ ok: false, status: 400 });
    vi.setSystemTime(new Date('2026-06-30T23:59:00Z'));
    expect(await checkToken(db, t.token)).not.toBeNull();
    vi.setSystemTime(new Date('2026-07-01T00:00:01Z'));
    expect(await checkToken(db, t.token)).toBeNull();
  });

  it("stop working when disabled (the plugin's update endpoint) or when their person is deleted", async () => {
    const t = await createToken(db, 'x', 'a@x.test');
    if (!t.ok) throw new Error(t.error);
    await db.update(authApiKey).set({ enabled: false });
    expect(await checkToken(db, t.token)).toBeNull();
    await db.update(authApiKey).set({ enabled: true });
    await db.delete(authUser).where(eq(authUser.email, 'a@x.test'));
    expect(await checkToken(db, t.token)).toBeNull();
    expect((await listTokens(db))[0].owner).toBe('(deleted user)');
  });

  it('records the last use at most once a minute', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-06-01T10:00:00Z'));
    const t = await createToken(db, 'poll', 'a@x.test');
    if (!t.ok) throw new Error(t.error);
    const writes = vi.spyOn(db, 'update');
    await checkToken(db, t.token);
    vi.setSystemTime(new Date('2026-06-01T10:00:30Z'));
    await checkToken(db, t.token);
    await checkToken(db, t.token);
    expect(writes).toHaveBeenCalledTimes(1);
    expect((await listTokens(db))[0].lastUsedAt).toBe('2026-06-01T10:00:00.000Z');
    vi.setSystemTime(new Date('2026-06-01T10:01:01Z'));
    await checkToken(db, t.token);
    expect(writes).toHaveBeenCalledTimes(2);
    expect((await listTokens(db))[0].lastUsedAt).toBe('2026-06-01T10:01:01.000Z');
  });

  it('are found with one lookup on the indexed key column', async () => {
    const plan = (openNodeDb(':memory:').sqlite.prepare(`EXPLAIN QUERY PLAN SELECT * FROM apikey LEFT JOIN user ON user.id = apikey.reference_id WHERE apikey.key = ?`).all('x') as { detail: string }[]).map((r) => r.detail);
    expect(plan).toEqual([expect.stringMatching(/SEARCH apikey USING INDEX apikey_key_idx/), expect.stringMatching(/SEARCH user USING INDEX sqlite_autoindex_user_1/)]);
  });
});
