// #90: Better Auth as Brickfolio's sign-in and access control. First account is the admin, sign-up closes after it,
// Better Auth's own organization API enforces the collection roles, and existing API tokens verify in its apiKey plugin.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { openNodeDb } from './db/node';
import type { DB } from './db/types';
import { apiTokens, authAccount, authApiKey, authInvitation, authMember, authOrganization, authUser } from './db/schema';
import { authOptions, getAuth, resetLink, setPassword } from './better-auth';
import { addCollection, deleteCollection, renameCollection } from './service/collections';
import * as perm from './service/permissions';
import { asApiKeyRow, checkToken, createToken, hashKey, listTokens, migrateLegacyTokens, moveLegacyTokens, sha256Hex } from './service/tokens';
// Test passwords are made up at run time, so secret scanners have no literal to flag.
const PASSWORDS: Record<string, string> = new Proxy({}, { get: (t: Record<string, string>, k: string) => (t[k] ??= `${crypto.randomUUID()}`) });

vi.mock('server-only', () => ({}));
const mail = vi.hoisted(() => ({ on: false, sent: [] as { kind: string; msg: { to: string; url: string } }[] }));
// Holds password hashing until `n` sign-ups are hashing, so they all reach "is this the first account?" together.
const gate = vi.hoisted(() => ({ n: 0, waiting: [] as (() => void)[] }));
vi.mock('./password', async (orig) => {
  const real = await orig<typeof import('./password')>();
  return {
    ...real,
    hashPassword: async (pw: string) => {
      const h = await real.hashPassword(pw);
      if (gate.n) await new Promise<void>((go) => { gate.waiting.push(go); if (gate.waiting.length >= gate.n) { gate.waiting.forEach((g) => g()); gate.waiting = []; } });
      return h;
    },
  };
});
vi.mock('./email', () => ({
  emailConfigured: () => mail.on,
  sendAuthEmail: async (kind: string, msg: { to: string; url: string }) => { mail.sent.push({ kind, msg }); },
}));
const password = PASSWORDS['correct horse battery'];
let db: DB;
let auth: ReturnType<typeof getAuth>;
let kids = 0;

beforeEach(async () => {
  vi.stubEnv('AUTH_MODE', 'better-auth');
  vi.stubEnv('BETTER_AUTH_SECRET', crypto.randomUUID() + crypto.randomUUID());
  vi.stubEnv('BETTER_AUTH_URL', 'http://app');
  db = openNodeDb(':memory:').db;
  auth = getAuth(db);
  const r = await addCollection(db, 'Kids');
  if (!r.ok) throw new Error(r.error);
  kids = r.collection.id;
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); mail.on = false; mail.sent = []; gate.n = 0; });

/** Signs up with email set up (needed for anyone but the first account), then follows the verification link. */
async function signUp(email: string) {
  const was = mail.on;
  mail.on = true;
  try { await auth.api.signUpEmail({ body: { email, password, name: email } }); } finally { mail.on = was; }
  mail.sent = mail.sent.filter((m) => m.kind !== 'verify-email');
  await db.update(authUser).set({ emailVerified: true }).where(eq(authUser.email, email));
}
async function session(email: string): Promise<Headers> {
  const r = await auth.api.signInEmail({ body: { email, password }, returnHeaders: true });
  return new Headers({ cookie: r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ') });
}

describe('sign-up', () => {
  it('makes the first account an admin, then closes unless ALLOWED_USERS or BETTER_AUTH_OPEN_SIGNUP allows it', async () => {
    await signUp('first@x.test');
    expect((await perm.resolveAccess(db, { user: 'first@x.test', via: 'better-auth' })).admin).toBe(true);
    await expect(signUp('second@x.test')).rejects.toThrow(/Sign-up is closed/);
    vi.stubEnv('ALLOWED_USERS', 'third@x.test');
    await signUp('third@x.test');
    const a = await perm.resolveAccess(db, { user: 'third@x.test', via: 'better-auth' });
    expect(a).toMatchObject({ admin: false });
    expect(perm.can(a, 'member')).toBe(false); // no collection yet
  });

  it('turns a session into the same Access as before', async () => {
    await signUp('first@x.test');
    vi.stubEnv('BETTER_AUTH_OPEN_SIGNUP', '1');
    await signUp('v@x.test');
    await perm.setRole(db, { login: 'first@x.test', admin: true, roles: new Map() }, kids, 'v@x.test', 'viewer');
    const s = await auth.api.getSession({ headers: await session('v@x.test') });
    const a = await perm.resolveAccess(db, { user: s!.user.email, via: 'better-auth' });
    expect([...a.roles]).toEqual([[kids, 'viewer']]);
    expect(perm.clampScope(a, 'all')).toEqual([kids]);
  });
});

describe('the first account', () => {
  it('is the only admin when two sign up at the same moment', async () => {
    gate.n = 3;
    const r = await Promise.allSettled([signUp('one@x.test'), signUp('two@x.test'), signUp('three@x.test')]);
    const admins = await db.select({ email: authUser.email }).from(authUser).where(eq(authUser.role, 'admin')).all();
    expect(admins).toHaveLength(1);
    // The others lost the race while sign-up was closed: refused, and no account left behind.
    expect(r.filter((x) => x.status === 'rejected').map((x) => String((x as PromiseRejectedResult).reason))).toEqual([expect.stringMatching(/Sign-up is closed/), expect.stringMatching(/Sign-up is closed/)]);
    expect(await db.select({ email: authUser.email }).from(authUser).all()).toEqual(admins);
  });

  it('with open sign-up, the others get plain accounts', async () => {
    vi.stubEnv('BETTER_AUTH_OPEN_SIGNUP', '1');
    gate.n = 2;
    await Promise.all([signUp('one@x.test'), signUp('two@x.test')]);
    expect((await db.select({ role: authUser.role }).from(authUser).all()).map((u) => u.role).sort()).toEqual(['admin', 'user']);
  });

  it("isn't an admin when there are people already (an upgraded install)", async () => {
    await perm.addPerson(db, 'old@x.test');
    vi.stubEnv('BETTER_AUTH_OPEN_SIGNUP', '1');
    await signUp('new@x.test');
    expect((await perm.resolveAccess(db, { user: 'new@x.test', via: 'better-auth' })).admin).toBe(false);
  });
});

describe('the instance', () => {
  it('is made once per database handle', () => {
    expect(getAuth(db)).toBe(auth);
    expect(getAuth(openNodeDb(':memory:').db)).not.toBe(auth);
  });

  it('keeps D1 under 100 parameters per query: at most 90 members a collection', async () => {
    const org = authOptions(db).plugins.find((p) => p.id === 'organization') as unknown as { options: { membershipLimit: number } };
    expect(org.options.membershipLimit).toBeLessThanOrEqual(90);
    const admin = { login: 'admin@x.test', admin: true, roles: new Map() };
    for (let i = 0; i < perm.MEMBERSHIP_LIMIT; i++) await perm.setRole(db, admin, kids, `p${i}@x.test`, 'viewer');
    expect(await perm.setRole(db, admin, kids, 'one-more@x.test', 'viewer')).toMatchObject({ ok: false, status: 409, error: expect.stringMatching(/90 members/) });
    expect(await perm.setRole(db, admin, kids, 'p0@x.test', 'editor')).toEqual({ ok: true }); // changing a role still works
  });

  it('lists members of many collections in chunks', async () => {
    expect(perm.chunks([...Array(181).keys()]).map((c) => c.length)).toEqual([90, 90, 1]);
    const admin = { login: 'admin@x.test', admin: true, roles: new Map() };
    await perm.setRole(db, admin, kids, 'v@x.test', 'viewer');
    const ids = [...Array(200).keys()].map((i) => i + 1000).concat(kids);
    expect(await perm.membersOf(db, ids)).toEqual([{ collectionId: kids, login: 'v@x.test', role: 'viewer' }]);
  });
});

describe('collections and their organizations', () => {
  it('makes, renames and deletes the organization with the collection', async () => {
    const org = () => db.select({ name: authOrganization.name, collectionId: authOrganization.collectionId }).from(authOrganization).where(eq(authOrganization.id, perm.orgId(kids))).get();
    expect(await org()).toEqual({ name: 'Kids', collectionId: kids });
    expect(await renameCollection(db, kids, 'Children')).toEqual({ ok: true });
    expect((await org())?.name).toBe('Children');
    await signUp('admin@x.test');
    await perm.setRole(db, { login: 'admin@x.test', admin: true, roles: new Map() }, kids, 'v@x.test', 'viewer');
    await db.insert(authInvitation).values({ id: 'inv1', organizationId: perm.orgId(kids), email: 'w@x.test', role: 'viewer', status: 'pending', expiresAt: new Date(Date.now() + 1e6), inviterId: (await db.select().from(authUser).get())!.id });
    expect(await deleteCollection(db, kids)).toEqual({ ok: true });
    expect(await org()).toBeUndefined();
    expect(await db.select().from(authMember).all()).toEqual([]);
    expect(await db.select().from(authInvitation).all()).toEqual([]);
  });
});

describe('people without a password', () => {
  beforeEach(async () => {
    await signUp('admin@x.test');
    await perm.addPerson(db, 'new@x.test');
  });
  const canSignIn = async (email: string, pw: string) => !!(await auth.api.signInEmail({ body: { email, password: pw } }).catch(() => null));

  it('get one from an admin, which signs them out elsewhere', async () => {
    expect((await perm.listPeople(db)).map((p) => [p.login, p.password])).toEqual([['admin@x.test', true], ['new@x.test', false]]);
    expect(await setPassword(db, 'new@x.test', 'short')).toMatchObject({ ok: false, status: 400 });
    expect(await setPassword(db, 'nobody@x.test', 'long enough pw')).toMatchObject({ ok: false, status: 404 });
    expect(await setPassword(db, 'New@x.test', PASSWORDS['first password'])).toEqual({ ok: true });
    expect(await canSignIn('new@x.test', PASSWORDS['first password'])).toBe(true);
    const h = await (async () => { const r = await auth.api.signInEmail({ body: { email: 'new@x.test', password: PASSWORDS['first password'] }, returnHeaders: true }); return new Headers({ cookie: r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ') }); })();
    expect(await setPassword(db, 'new@x.test', 'second password')).toEqual({ ok: true }); // the account row is updated, not added
    expect(await db.select().from(authAccount).where(eq(authAccount.providerId, 'credential')).all()).toHaveLength(2);
    expect(await canSignIn('new@x.test', PASSWORDS['first password'])).toBe(false);
    expect(await canSignIn('new@x.test', 'second password')).toBe(true);
    expect(await auth.api.getSession({ headers: h })).toBeNull();
  });

  it('get a reset link to copy when email is not set up, which sets a password', async () => {
    const log = vi.spyOn(console, 'log'), warn = vi.spyOn(console, 'warn'), info = vi.spyOn(console, 'info');
    const r = await resetLink(db, 'new@x.test');
    if (!r.ok || !r.url) throw new Error('no link');
    expect(r.url).toMatch(/^http:\/\/app\/api\/auth\/reset-password\/\w+\?callbackURL=%2Freset-password$/);
    for (const s of [log, warn, info]) expect(JSON.stringify(s.mock.calls)).not.toContain(r.url.split('/').pop()!.split('?')[0]);
    const res = await auth.handler(new Request(r.url));
    const to = new URL(res.headers.get('location')!, 'http://app');
    expect(to.pathname).toBe('/reset-password');
    await auth.api.resetPassword({ body: { newPassword: PASSWORDS['from the link'], token: to.searchParams.get('token')! } });
    expect(await canSignIn('new@x.test', PASSWORDS['from the link'])).toBe(true);
    expect(mail.sent).toEqual([]);
  });

  it('get the reset link by email when email is set up', async () => {
    mail.on = true;
    expect(await resetLink(db, 'new@x.test')).toEqual({ ok: true });
    expect(mail.sent).toEqual([{ kind: 'reset-password', msg: expect.objectContaining({ to: 'new@x.test', url: expect.stringContaining('/reset-password/') }) }]);
  });
});

describe("Better Auth's organization API follows the same roles", () => {
  beforeEach(async () => {
    await signUp('admin@x.test');
    vi.stubEnv('BETTER_AUTH_OPEN_SIGNUP', '1');
    for (const e of ['owner@x.test', 'viewer@x.test']) await signUp(e);
    const admin = { login: 'admin@x.test', admin: true, roles: new Map() };
    await perm.setRole(db, admin, kids, 'owner@x.test', 'owner');
    await perm.setRole(db, admin, kids, 'viewer@x.test', 'viewer');
  });

  it('answers has-permission from lib/auth-ac.ts for any collection, without an active organization', async () => {
    const ask = async (email: string, permissions: Record<string, string[]>) =>
      (await auth.api.hasPermission({ headers: await session(email), body: { organizationId: perm.orgId(kids), permissions } })).success;
    expect(await ask('viewer@x.test', { collection: ['read'] })).toBe(true);
    expect(await ask('viewer@x.test', { collection: ['write'] })).toBe(false);
    expect(await ask('owner@x.test', { collection: ['manage'] })).toBe(true);
  });

  it('lets an owner change roles through it and refuses a viewer', async () => {
    const members = await auth.api.listMembers({ headers: await session('owner@x.test'), query: { organizationId: perm.orgId(kids) } });
    const viewer = members.members.find((m) => m.user.email === 'viewer@x.test')!;
    await expect(auth.api.updateMemberRole({ headers: await session('viewer@x.test'), body: { organizationId: perm.orgId(kids), memberId: viewer.id, role: 'owner' } })).rejects.toThrow();
    await auth.api.updateMemberRole({ headers: await session('owner@x.test'), body: { organizationId: perm.orgId(kids), memberId: viewer.id, role: 'editor' } });
    expect([...(await perm.resolveAccess(db, { user: 'viewer@x.test', via: 'better-auth' })).roles]).toEqual([[kids, 'editor']]);
  });

  const memberId = async (email: string) => (await db.select({ id: authMember.id }).from(authMember).innerJoin(authUser, eq(authUser.id, authMember.userId)).where(eq(authUser.email, email)).get())!.id;
  const roleOf = async (email: string) => (await perm.resolveAccess(db, { user: email, via: 'better-auth' })).roles.get(kids);
  const body = (id: string, role: string) => ({ organizationId: perm.orgId(kids), memberId: id, role });

  it("doesn't let an owner change their own role, remove themselves or leave", async () => {
    vi.stubEnv('BETTER_AUTH_OPEN_SIGNUP', '1');
    await signUp('owner2@x.test');
    await perm.setRole(db, { login: 'admin@x.test', admin: true, roles: new Map() }, kids, 'owner2@x.test', 'owner'); // Better Auth would allow it with two owners
    const h = await session('owner@x.test');
    await expect(auth.api.updateMemberRole({ headers: h, body: body(await memberId('owner@x.test'), 'viewer') })).rejects.toThrow(/your own role/);
    await expect(auth.api.removeMember({ headers: h, body: { organizationId: perm.orgId(kids), memberIdOrEmail: 'owner@x.test' } })).rejects.toThrow(/your own role/);
    await expect(auth.api.leaveOrganization({ headers: h, body: { organizationId: perm.orgId(kids) } })).rejects.toThrow(/your own role/);
    expect(await roleOf('owner@x.test')).toBe('owner');
  });

  it('lets an owner demote or remove another owner, and an admin change anyone, member or not', async () => {
    vi.stubEnv('BETTER_AUTH_OPEN_SIGNUP', '1');
    await signUp('owner2@x.test');
    await perm.setRole(db, { login: 'admin@x.test', admin: true, roles: new Map() }, kids, 'owner2@x.test', 'owner');
    const r = await auth.api.updateMemberRole({ headers: await session('owner@x.test'), body: body(await memberId('owner2@x.test'), 'editor') });
    expect(r).toMatchObject({ role: 'editor', organizationId: perm.orgId(kids) });
    expect(await roleOf('owner2@x.test')).toBe('editor');
    // The admin isn't a member of Kids (Better Auth alone would say "member not found") and demotes the last owner.
    await auth.api.updateMemberRole({ headers: await session('admin@x.test'), body: body(await memberId('owner@x.test'), 'viewer') });
    expect(await roleOf('owner@x.test')).toBe('viewer');
    await auth.api.removeMember({ headers: await session('admin@x.test'), body: { organizationId: perm.orgId(kids), memberIdOrEmail: 'viewer@x.test' } });
    expect(await roleOf('viewer@x.test')).toBeUndefined();
    await expect(auth.api.updateMemberRole({ headers: await session('admin@x.test'), body: body(await memberId('owner@x.test'), 'boss') })).rejects.toThrow(/Role must be/);
  });

  it("doesn't let anyone rename, delete or make organizations through it (they follow the collections)", async () => {
    const h = await session('owner@x.test');
    await expect(auth.api.updateOrganization({ headers: h, body: { organizationId: perm.orgId(kids), data: { name: 'Mine' } } })).rejects.toThrow();
    await expect(auth.api.deleteOrganization({ headers: h, body: { organizationId: perm.orgId(kids) } })).rejects.toThrow();
    await expect(auth.api.createOrganization({ headers: h, body: { name: 'New', slug: 'new', collectionId: 99 } })).rejects.toThrow();
    expect((await db.select({ name: authOrganization.name }).from(authOrganization).all()).map((o) => o.name)).toEqual(['My collection', 'Kids']);
  });
});

describe('API tokens', () => {
  /** A token as the code before #90 made it (a row in `api_tokens`), made up at run time. */
  async function legacyToken(name: string, owner: string | null) {
    const token = 'bf_' + btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const [row] = await db.insert(apiTokens).values({ name, hash: await sha256Hex(token), prefix: token.slice(0, 8), owner }).returning().all();
    return { token, row };
  }
  const userId = async (email: string) => (await db.select({ id: authUser.id }).from(authUser).where(eq(authUser.email, email)).get())!.id;

  it("verifies tokens in Better Auth's apiKey plugin: copied ones from before, and new ones", async () => {
    await signUp('owner@x.test');
    const old = await legacyToken('phone', 'owner@x.test');
    const row = asApiKeyRow(old.row, await userId('owner@x.test'));
    expect(row.key).toBe(await hashKey(old.token));
    await migrateLegacyTokens(db);
    expect(await auth.api.verifyApiKey({ body: { key: old.token } })).toMatchObject({ valid: true, key: { referenceId: await userId('owner@x.test'), name: 'phone' } });
    expect((await auth.api.verifyApiKey({ body: { key: old.token + 'x' } })).valid).toBe(false);
    const t = await createToken(db, 'tablet', 'owner@x.test');
    if (!t.ok) throw new Error(t.error);
    expect(await auth.api.verifyApiKey({ body: { key: t.token } })).toMatchObject({ valid: true, key: { name: 'tablet' } });
  });

  it("lets nobody list, read, change or delete another person's keys through the plugin's endpoints", async () => {
    await signUp('admin@x.test');
    vi.stubEnv('BETTER_AUTH_OPEN_SIGNUP', '1');
    await signUp('b@x.test');
    const theirs = await createToken(db, 'admins', 'admin@x.test');
    const nobody = await createToken(db, 'nobody', null);
    if (!theirs.ok || !nobody.ok) throw new Error('not made');
    const [a, n] = ['admins', 'nobody'].map((name) => listTokens(db).then((l) => l.find((t) => t.name === name)!.id));
    const b = await session('b@x.test');
    expect((await auth.api.listApiKeys({ headers: b })).apiKeys).toEqual([]);
    for (const keyId of [await a, await n]) {
      await expect(auth.api.getApiKey({ headers: b, query: { id: keyId } })).rejects.toThrow();
      await expect(auth.api.updateApiKey({ headers: b, body: { keyId, enabled: false } })).rejects.toThrow();
      await expect(auth.api.deleteApiKey({ headers: b, body: { keyId } })).rejects.toThrow();
    }
    // Nor an admin, for keys of nobody: those are revoked in Settings.
    await expect(auth.api.deleteApiKey({ headers: await session('admin@x.test'), body: { keyId: await n } })).rejects.toThrow();
    // Over HTTP, a key for someone else can't be made.
    const res = await auth.handler(new Request('http://app/api/auth/api-key/create', { method: 'POST', headers: { ...Object.fromEntries(b), 'content-type': 'application/json', origin: 'http://app' }, body: JSON.stringify({ name: 'x', userId: await userId('admin@x.test') }) }));
    expect(res.status).toBe(401);
    expect(await auth.api.verifyApiKey({ body: { key: theirs.token } })).toMatchObject({ valid: true });
    expect(await auth.api.verifyApiKey({ body: { key: nobody.token } })).toMatchObject({ valid: true });
    expect(await db.select().from(authApiKey).all()).toHaveLength(2);
  });

  it("manages your own keys through the plugin: bf_ prefix only, no rate limit, and a copied key's old row goes too", async () => {
    await signUp('owner@x.test');
    const h = await session('owner@x.test');
    const made = await auth.api.createApiKey({ headers: h, body: { name: 'script' } });
    expect(made.key.startsWith('bf_')).toBe(true);
    expect(made).toMatchObject({ rateLimitEnabled: false, start: made.key.slice(0, 8) });
    expect(await checkToken(db, made.key)).toMatchObject({ name: 'script', owner: 'owner@x.test' });
    await expect(auth.api.createApiKey({ headers: h, body: { name: 'other', prefix: 'xx_' } })).rejects.toThrow(/start with bf_/);

    const old = await legacyToken('phone', 'owner@x.test');
    await moveLegacyTokens(db); // this process copied already (checkToken above); a new one would on first use
    expect((await auth.api.listApiKeys({ headers: h })).apiKeys.map((k) => k.name).sort()).toEqual(['phone', 'script']);
    await auth.api.deleteApiKey({ headers: h, body: { keyId: `legacy_${old.row.id}` } });
    expect(await db.select().from(apiTokens).all()).toEqual([]);
    expect(await checkToken(db, old.token)).toBeNull();
  });

  it('refuses the plugin endpoints to someone taken out of ALLOWED_USERS', async () => {
    await signUp('owner@x.test');
    const h = await session('owner@x.test');
    vi.stubEnv('ALLOWED_USERS', 'someone-else@x.test');
    await expect(auth.api.listApiKeys({ headers: h })).rejects.toThrow(/don't have access/);
    await expect(auth.api.createApiKey({ headers: h, body: { name: 'x' } })).rejects.toThrow(/don't have access/);
  });
});

describe('proving an address before it gives access (#91 review)', () => {
  beforeEach(async () => { await signUp('admin@x.test'); });

  it("keeps sign-up closed without email, so nobody can claim an address in ALLOWED_USERS or ADMIN_USERS", async () => {
    vi.stubEnv('ALLOWED_USERS', 'admin@x.test,boss@x.test');
    vi.stubEnv('ADMIN_USERS', 'boss@x.test');
    await expect(auth.api.signUpEmail({ body: { email: 'boss@x.test', password, name: 'Boss' } })).rejects.toThrow(/Sign-up is closed/);
  });

  it('with email set up, refuses sign-in and access until the address is verified', async () => {
    vi.stubEnv('ALLOWED_USERS', 'admin@x.test,boss@x.test');
    vi.stubEnv('ADMIN_USERS', 'boss@x.test');
    mail.on = true;
    await auth.api.signUpEmail({ body: { email: 'boss@x.test', password, name: 'Boss' } });
    expect(mail.sent.map((m) => m.kind)).toEqual(['verify-email']);
    await expect(auth.api.signInEmail({ body: { email: 'boss@x.test', password } })).rejects.toThrow();
    await db.update(authUser).set({ emailVerified: true }).where(eq(authUser.email, 'boss@x.test')); // followed the link
    expect(await auth.api.signInEmail({ body: { email: 'boss@x.test', password } })).toMatchObject({ user: { email: 'boss@x.test' } });
  });

  it("refuses Better Auth's member endpoints to someone taken out of ALLOWED_USERS", async () => {
    vi.stubEnv('BETTER_AUTH_OPEN_SIGNUP', '1');
    await signUp('owner@x.test');
    await signUp('viewer@x.test');
    const admin = { login: 'admin@x.test', admin: true, roles: new Map() };
    await perm.setRole(db, admin, kids, 'owner@x.test', 'owner');
    await perm.setRole(db, admin, kids, 'viewer@x.test', 'viewer');
    const h = await session('owner@x.test');
    const viewer = (await db.select().from(authMember).innerJoin(authUser, eq(authUser.id, authMember.userId)).where(eq(authUser.email, 'viewer@x.test')).get())!.member;
    vi.stubEnv('ALLOWED_USERS', 'admin@x.test,viewer@x.test');
    await expect(auth.api.updateMemberRole({ headers: h, body: { organizationId: perm.orgId(kids), memberId: viewer.id, role: 'editor' } })).rejects.toThrow(/don't have access/);
    expect([...(await perm.resolveAccess(db, { user: 'viewer@x.test', via: 'better-auth' })).roles]).toEqual([[kids, 'viewer']]);
  });

  it('keeps an admin an admin when they set their own password before switching (keepAdmin)', async () => {
    await perm.addPerson(db, 'me@x.test');
    expect(await setPassword(db, 'me@x.test', PASSWORDS['a long password'], { keepAdmin: true })).toEqual({ ok: true });
    const u = (await db.select().from(authUser).where(eq(authUser.email, 'me@x.test')).get())!;
    expect(u).toMatchObject({ role: 'admin', emailVerified: true });
    expect((await perm.resolveAccess(db, { user: 'me@x.test', via: 'better-auth' })).admin).toBe(true);
  });
});
