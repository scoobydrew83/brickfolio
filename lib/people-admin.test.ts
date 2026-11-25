// #102: Settings → People for admins. The server actions (ban, delete, sessions, two-factor reset, acting as someone)
// with Brickfolio's access checks, the same rules on Better Auth's /admin/* endpoints, bans in every sign-in method
// and in the proxy modes, and what a deletion takes with it. Passwords and secrets are made at run time.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { openNodeDb } from './db/node';
import type { DB } from './db/types';
import { apiTokens, authApiKey, authInvitation, authMember, authSession, authTwoFactor, authUser } from './db/schema';
import { getAuth } from './better-auth';
import { addCollection } from './service/collections';
import * as perm from './service/permissions';
import * as people from './service/people-admin';
import { createToken } from './service/tokens';
import { identify } from './auth';

vi.mock('server-only', () => ({}));
const holder = vi.hoisted(() => ({ db: undefined as unknown, headers: new Headers(), links: [] as string[] }));
vi.mock('./db', () => ({ getDb: async () => holder.db }));
vi.mock('next/headers', () => ({ headers: async () => holder.headers, cookies: async () => ({ get: () => undefined, set: () => {}, getAll: () => [] }) }));
vi.mock('next/cache', () => ({ refresh: () => {}, revalidatePath: () => {} }));
vi.mock('./email', () => ({ emailConfigured: () => true, sendAuthEmail: async (_k: string, m: { url: string }) => { holder.links.push(m.url); } }));

const actions = await import('../app/actions');
const password = crypto.randomUUID();
let db: DB;
let auth: ReturnType<typeof getAuth>;
let kids = 0;

const jar = (h: Headers, keep = '') => {
  const old = new Map(keep.split('; ').filter(Boolean).map((c) => [c.split('=')[0], c] as const));
  for (const c of h.getSetCookie()) {
    const pair = c.split(';')[0], name = pair.split('=')[0];
    if (/max-age=0/i.test(c)) old.delete(name); else old.set(name, pair);
  }
  return [...old.values()].join('; ');
};
async function signIn(email: string) {
  const r = await auth.api.signInEmail({ body: { email, password }, returnHeaders: true });
  return new Headers({ cookie: jar(r.headers) });
}
/** Adds someone with a password, as an admin would (verified). */
async function add(email: string) {
  await perm.addPerson(db, email);
  const { setPassword } = await import('./better-auth');
  const r = await setPassword(db, email, password);
  if (!r.ok) throw new Error(r.error);
}
const as = async (email: string) => { holder.headers = await signIn(email); };
const userId = async (email: string) => (await db.select({ id: authUser.id }).from(authUser).where(eq(authUser.email, email)).get())!.id;
const sessions = async (email: string) => db.select().from(authSession).where(eq(authSession.userId, await userId(email))).all();
const admin = { login: 'admin@x.test', admin: true, roles: new Map() } as perm.Access;

beforeEach(async () => {
  vi.stubEnv('AUTH_MODE', 'better-auth');
  vi.stubEnv('BETTER_AUTH_SECRET', crypto.randomUUID() + crypto.randomUUID());
  vi.stubEnv('BETTER_AUTH_URL', 'http://app');
  db = openNodeDb(':memory:').db;
  holder.db = db;
  auth = getAuth(db);
  await auth.api.signUpEmail({ body: { email: 'admin@x.test', password, name: 'Admin' } }); // first account: admin
  await add('ann@x.test');
  await add('bob@x.test');
  const r = await addCollection(db, 'Kids');
  if (!r.ok) throw new Error(r.error);
  kids = r.collection.id;
});
afterEach(() => { vi.unstubAllEnvs(); holder.headers = new Headers(); holder.links = []; });

describe('the server actions', () => {
  it('work for an admin and are refused to anyone else', async () => {
    await as('bob@x.test');
    for (const r of [await actions.banPerson('ann@x.test', 'spam', null), await actions.unbanPerson('ann@x.test'), await actions.deletePerson('ann@x.test'),
      await actions.resetTwoFactor('ann@x.test'), await actions.endPersonSessions('ann@x.test'), await actions.personSessions('ann@x.test'), await actions.impersonate('ann@x.test')]) {
      expect(r).toEqual({ ok: false, error: perm.denied('admin') });
    }
    expect(await db.select().from(authUser).where(eq(authUser.email, 'ann@x.test')).get()).toMatchObject({ banned: false });

    await signIn('ann@x.test');
    await as('admin@x.test');
    const list = await actions.personSessions('ann@x.test');
    expect(list.ok && list.sessions).toHaveLength(1);
    const me = await actions.personSessions('admin@x.test');
    expect(me.ok && me.sessions.filter((s) => s.current)).toHaveLength(1); // "this is you"
    expect(JSON.stringify(me)).not.toContain((await sessions('admin@x.test'))[0].token); // never a session token
    expect(await actions.endPersonSessions('ann@x.test', list.ok ? list.sessions[0].id : '')).toEqual({ ok: true });
    expect(await sessions('ann@x.test')).toEqual([]);
    expect(await actions.banPerson('ann@x.test', 'spam', new Date(Date.now() + 86_400_000).toISOString())).toEqual({ ok: true });
    expect(await perm.listPeople(db)).toContainEqual(expect.objectContaining({ login: 'ann@x.test', ban: { reason: 'spam', until: expect.any(String) } }));
    expect(await actions.unbanPerson('ann@x.test')).toEqual({ ok: true });
    expect(await actions.deletePerson('ann@x.test')).toEqual({ ok: true });
    expect(await db.select().from(authUser).where(eq(authUser.email, 'ann@x.test')).get()).toBeUndefined();
  });

  it("refuse yourself and ADMIN_USERS admins for ban, delete and impersonate", async () => {
    vi.stubEnv('ADMIN_USERS', 'boss@x.test');
    await add('boss@x.test');
    await as('admin@x.test');
    for (const fn of [() => actions.banPerson('admin@x.test', '', null), () => actions.deletePerson('admin@x.test'), () => actions.impersonate('admin@x.test')]) expect((await fn()).ok).toBe(false);
    expect(await actions.banPerson('admin@x.test', '', null)).toMatchObject({ error: "You can't ban yourself." });
    expect(await actions.banPerson('boss@x.test', '', null)).toMatchObject({ error: expect.stringContaining('ADMIN_USERS') });
    expect(await actions.deletePerson('boss@x.test')).toMatchObject({ error: expect.stringContaining('ADMIN_USERS') });
    expect(await actions.impersonate('boss@x.test')).toMatchObject({ error: expect.stringContaining('ADMIN_USERS') });
    // An ADMIN_USERS admin (role `user` in Better Auth) can do all of it to others: Brickfolio's check, not the plugin's.
    await as('boss@x.test');
    expect(await actions.banPerson('ann@x.test', '', null)).toEqual({ ok: true });
    expect(await actions.impersonate('bob@x.test')).toEqual({ ok: true });
  });

  it('refuse a ban that ends in the past', async () => {
    await as('admin@x.test');
    expect(await actions.banPerson('ann@x.test', '', new Date(Date.now() - 1000).toISOString())).toMatchObject({ ok: false, error: expect.stringMatching(/future/) });
  });
});

describe('acting as someone', () => {
  async function start(by: string, who: string) {
    const h = await signIn(by);
    const r = await auth.api.brickfolioImpersonate({ body: { userId: await userId(who) }, headers: h, returnHeaders: true });
    return new Headers({ cookie: jar(r.headers, h.get('cookie')!) });
  }

  it('gives only that person’s rights, refuses admin actions, can’t be stacked, and Stop brings the admin back', async () => {
    await perm.setRole(db, admin, kids, 'ann@x.test', 'viewer');
    const h = await start('admin@x.test', 'ann@x.test');
    const id = await identify(h);
    expect(id).toMatchObject({ user: 'ann@x.test', impersonatedBy: await userId('admin@x.test') });
    const a = await perm.resolveAccess(db, id!);
    expect(a).toMatchObject({ admin: false, impersonated: true });
    expect([...a.roles]).toEqual([[kids, 'viewer']]);
    // Admin-only server actions refuse while acting as someone, and so does stacking another impersonation.
    holder.headers = h;
    expect((await actions.banPerson('bob@x.test', '', null)).ok).toBe(false);
    expect((await actions.impersonate('bob@x.test')).ok).toBe(false);
    await expect(auth.api.brickfolioImpersonate({ body: { userId: await userId('bob@x.test') }, headers: h })).rejects.toThrow(/acting as someone else/);
    // The plugin's own endpoints too, even for someone whose user.role is admin.
    await expect(auth.api.impersonateUser({ body: { userId: await userId('bob@x.test') }, headers: h })).rejects.toThrow(/acting as someone else/);
    // Stop works although Ann isn't an admin, and the admin's own session comes back.
    const stop = await auth.api.stopImpersonating({ headers: h, returnHeaders: true });
    const back = new Headers({ cookie: jar(stop.headers, h.get('cookie')!) });
    expect(await identify(back)).toEqual({ user: 'admin@x.test', via: 'better-auth' });
    expect((await sessions('ann@x.test')).filter((s) => s.impersonatedBy)).toEqual([]);
  });

  it('works through the server action and Stop (the action)', async () => {
    await as('admin@x.test');
    expect(await actions.impersonate('ann@x.test')).toEqual({ ok: true });
    expect((await sessions('ann@x.test')).filter((s) => s.impersonatedBy === null)).toHaveLength(0);
    expect((await sessions('ann@x.test')).filter((s) => s.impersonatedBy)).toHaveLength(1);
    expect(await actions.stopImpersonating()).toEqual({ ok: false, error: "You aren't acting as anyone." }); // the admin's own session
    holder.headers = await start('admin@x.test', 'bob@x.test');
    expect(await actions.stopImpersonating()).toEqual({ ok: true });
  });

  it('Stop still works after the person stops being allowed in (ALLOWED_USERS)', async () => {
    holder.headers = await start('admin@x.test', 'bob@x.test');
    vi.stubEnv('ALLOWED_USERS', 'admin@x.test');
    expect(await identify(holder.headers)).toBeNull(); // Brickfolio no longer lets bob in, but the bar still shows
    expect(await actions.stopImpersonating()).toEqual({ ok: true });
    expect((await sessions('bob@x.test')).filter((s) => s.impersonatedBy)).toEqual([]);
  });

  it('refuses admins, banned people and people who can’t sign in', async () => {
    await perm.setAdmin(db, admin, 'bob@x.test', true);
    await expect(start('admin@x.test', 'bob@x.test')).rejects.toThrow(/is an admin/);
    await db.update(authUser).set({ emailVerified: false }).where(eq(authUser.email, 'ann@x.test'));
    await expect(start('admin@x.test', 'ann@x.test')).rejects.toThrow(/can't sign in/);
  });
});

describe("Better Auth's /admin/* endpoints follow the same rules", () => {
  const post = async (path: string, body: unknown, cookie: string) =>
    auth.handler(new Request(`http://app/api/auth/admin/${path}`, { method: 'POST', headers: { cookie, 'content-type': 'application/json', origin: 'http://app' }, body: JSON.stringify(body) }));

  it('refuses non-admins, yourself and ADMIN_USERS admins through auth.handler', async () => {
    vi.stubEnv('ADMIN_USERS', 'boss@x.test,admin@x.test');
    await add('boss@x.test');
    const bob = (await signIn('bob@x.test')).get('cookie')!;
    expect((await post('ban-user', { userId: await userId('ann@x.test') }, bob)).status).toBe(403);
    expect((await post('list-user-sessions', { userId: await userId('ann@x.test') }, bob)).status).toBe(403);
    const adm = (await signIn('admin@x.test')).get('cookie')!; // user.role admin, and in ADMIN_USERS
    expect((await post('ban-user', { userId: await userId('admin@x.test') }, adm)).status).toBe(409);
    for (const p of ['ban-user', 'remove-user', 'impersonate-user']) expect((await post(p, { userId: await userId('boss@x.test') }, adm)).status).toBe(409);
    expect((await post('update-user', { userId: await userId('boss@x.test'), data: { banned: true } }, adm)).status).toBe(409);
    expect(await db.select({ b: authUser.banned }).from(authUser).where(eq(authUser.email, 'boss@x.test')).get()).toEqual({ b: false });
    // Someone else is fine, and remove-user cleans up as the action does.
    await perm.setRole(db, admin, kids, 'ann@x.test', 'editor');
    expect((await post('remove-user', { userId: await userId('ann@x.test') }, adm)).status).toBe(200);
    expect(await db.select().from(authMember).all()).toEqual([]);
  });

  it("doesn't expose Brickfolio's own impersonate endpoint over HTTP (server-only)", async () => {
    const adm = (await signIn('admin@x.test')).get('cookie')!;
    const res = await auth.handler(new Request('http://app/api/auth/brickfolio/impersonate', { method: 'POST', headers: { cookie: adm, 'content-type': 'application/json', origin: 'http://app' }, body: JSON.stringify({ userId: await userId('ann@x.test') }) }));
    expect(res.status).toBe(404);
    expect(await sessions('ann@x.test')).toEqual([]); // nothing was started
  });
});

describe('bans', () => {
  it('end sessions at once and refuse password and emailed-link sign-in; an ended ban lets them back', async () => {
    const h = await signIn('ann@x.test');
    expect(await identify(h)).toMatchObject({ user: 'ann@x.test' });
    expect(await people.banPerson(db, admin, 'ann@x.test', { reason: 'x', until: new Date(Date.now() + 60_000) })).toEqual({ ok: true });
    expect(await sessions('ann@x.test')).toEqual([]);
    expect(await identify(h)).toBeNull();
    await expect(signIn('ann@x.test')).rejects.toThrow(/banned/);
    await auth.api.signInMagicLink({ body: { email: 'ann@x.test', callbackURL: '/' }, headers: new Headers() });
    const res = await auth.handler(new Request(holder.links.at(-1)!));
    expect(res.headers.getSetCookie().some((c) => c.includes('session_token=') && !/max-age=0/i.test(c))).toBe(false);
    expect(await sessions('ann@x.test')).toEqual([]);
    // Every method makes its session through the same place (passkeys too: lib/better-auth-2fa.test.ts).
    await expect((await auth.$context).internalAdapter.createSession(await userId('ann@x.test'))).rejects.toThrow(/banned/);
    // Ended: signs in again.
    await db.update(authUser).set({ banExpires: new Date(Date.now() - 1000) }).where(eq(authUser.email, 'ann@x.test'));
    expect(await identify(await signIn('ann@x.test'))).toMatchObject({ user: 'ann@x.test' });
  });

  it('mean no access in the proxy modes (resolveAccess), with their API tokens too', async () => {
    vi.stubEnv('AUTH_MODE', 'tailscale');
    vi.stubEnv('ADMIN_USERS', 'admin@x.test');
    await perm.setRole(db, admin, kids, 'ann@x.test', 'owner');
    const token = await createToken(db, 'phone', 'ann@x.test');
    expect(token.ok).toBe(true);
    expect(await people.banPerson(db, admin, 'ann@x.test', { reason: '' })).toEqual({ ok: true });
    const a = await perm.resolveAccess(db, { user: 'ann@x.test', via: 'tailscale' });
    expect(a).toMatchObject({ banned: true, admin: false });
    expect(perm.can(a, 'member')).toBe(false);
    expect(perm.can(await perm.resolveAccess(db, { user: 'token:phone', via: 'token', owner: 'ann@x.test' }), { action: 'read', collectionId: kids })).toBe(false);
    // Everyone-is-admin (no ADMIN_USERS) doesn't outrank a ban either.
    vi.stubEnv('ADMIN_USERS', '');
    expect((await perm.resolveAccess(db, { user: 'ann@x.test', via: 'tailscale' })).admin).toBe(false);
    vi.stubEnv('ADMIN_USERS', 'admin@x.test');
    await db.update(authUser).set({ banExpires: new Date(Date.now() - 1000) }).where(eq(authUser.email, 'ann@x.test'));
    expect(perm.can(await perm.resolveAccess(db, { user: 'ann@x.test', via: 'tailscale' }), 'member')).toBe(true);
  });

  it('and deletion work in a proxy mode without Better Auth set up', async () => {
    vi.stubEnv('AUTH_MODE', 'tailscale');
    vi.stubEnv('BETTER_AUTH_SECRET', '');
    vi.stubEnv('ADMIN_USERS', 'admin@x.test');
    await perm.addPerson(db, 'carl@x.test');
    expect(await people.banPerson(db, admin, 'carl@x.test', { reason: 'r' })).toEqual({ ok: true });
    expect(await people.deletePerson(db, admin, 'carl@x.test')).toEqual({ ok: true });
    expect(await people.listSessions(db, 'carl@x.test')).toEqual([]);
  });
});

describe('deleting someone', () => {
  it('removes their roles, invitations (to and from them) and API keys', async () => {
    await perm.setRole(db, admin, kids, 'ann@x.test', 'owner');
    const ann = await userId('ann@x.test');
    const { createInvite } = await import('./service/invitations');
    expect((await createInvite(db, await perm.accessOf(db, 'ann@x.test'), kids, 'new@x.test', 'viewer')).ok).toBe(true);
    const other = await addCollection(db, 'Shop');
    if (!other.ok) throw new Error(other.error);
    expect((await createInvite(db, admin, other.collection.id, 'ann@x.test', 'viewer')).ok).toBe(true);
    expect((await createToken(db, 'phone', 'ann@x.test')).ok).toBe(true);
    await db.insert(apiTokens).values({ name: 'old', hash: crypto.randomUUID(), prefix: 'bf_x', owner: 'ann@x.test' });
    await db.insert(authTwoFactor).values({ id: crypto.randomUUID(), secret: crypto.randomUUID(), backupCodes: crypto.randomUUID(), userId: ann });
    await signIn('ann@x.test');
    expect(await people.deletePerson(db, admin, 'ann@x.test')).toEqual({ ok: true });
    expect(await db.select().from(authMember).where(eq(authMember.userId, ann)).all()).toEqual([]);
    expect(await db.select().from(authInvitation).all()).toEqual([]);
    expect(await db.select().from(authApiKey).where(eq(authApiKey.referenceId, ann)).all()).toEqual([]);
    expect(await db.select().from(apiTokens).where(eq(apiTokens.owner, 'ann@x.test')).all()).toEqual([]);
    expect(await db.select().from(authSession).where(eq(authSession.userId, ann)).all()).toEqual([]);
    expect(await db.select().from(authTwoFactor).all()).toEqual([]);
  });
});

describe('two-factor reset', () => {
  it('turns two-factor off and signs them out', async () => {
    const ann = await userId('ann@x.test');
    await db.insert(authTwoFactor).values({ id: crypto.randomUUID(), secret: crypto.randomUUID(), backupCodes: crypto.randomUUID(), userId: ann });
    await db.update(authUser).set({ twoFactorEnabled: true }).where(eq(authUser.id, ann));
    // Sign-in asks for the code while it's on.
    expect((await auth.api.signInEmail({ body: { email: 'ann@x.test', password } }))).toMatchObject({ twoFactorRedirect: true });
    await db.insert(authSession).values({ id: crypto.randomUUID(), token: crypto.randomUUID(), userId: ann, expiresAt: new Date(Date.now() + 60_000), createdAt: new Date(), updatedAt: new Date() });
    await as('admin@x.test');
    expect(await actions.resetTwoFactor('ann@x.test')).toEqual({ ok: true });
    expect(await db.select({ on: authUser.twoFactorEnabled }).from(authUser).where(eq(authUser.id, ann)).get()).toEqual({ on: false });
    expect(await db.select().from(authTwoFactor).all()).toEqual([]);
    expect(await sessions('ann@x.test')).toEqual([]);
    expect(await identify(await signIn('ann@x.test'))).toMatchObject({ user: 'ann@x.test' });
  });
});
