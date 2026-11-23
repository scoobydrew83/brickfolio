// #90 phase 2: /account's actions act only on the signed-in person, and never leave them without a way to sign in.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { openNodeDb } from './db/node';
import type { DB } from './db/types';
import { authAccount, authSession, authUser } from './db/schema';
import { getAuth } from './better-auth';
import * as account from './account';
import * as perm from './service/permissions';
import { addCollection } from './service/collections';
import { createInvite } from './service/invitations';

vi.mock('server-only', () => ({}));
const mail = vi.hoisted(() => ({ on: false }));
vi.mock('./email', () => ({ emailConfigured: () => mail.on, sendAuthEmail: async () => {} }));
// Made up at run time, so secret scanners have no literal to flag.
const PW: Record<string, string> = new Proxy({}, { get: (t: Record<string, string>, k: string) => (t[k] ??= `${crypto.randomUUID()}`) });
let db: DB;
let auth: ReturnType<typeof getAuth>;

beforeEach(async () => {
  vi.stubEnv('AUTH_MODE', 'better-auth');
  vi.stubEnv('BETTER_AUTH_SECRET', crypto.randomUUID() + crypto.randomUUID());
  vi.stubEnv('BETTER_AUTH_URL', 'http://app');
  db = openNodeDb(':memory:').db;
  auth = getAuth(db);
  for (const email of ['me@x.test', 'other@x.test']) {
    vi.stubEnv('BETTER_AUTH_OPEN_SIGNUP', '1');
    mail.on = true;
    await auth.api.signUpEmail({ body: { email, password: PW.first, name: email } });
    mail.on = false;
    await db.update(authUser).set({ emailVerified: true }).where(eq(authUser.email, email));
  }
  vi.stubEnv('BETTER_AUTH_OPEN_SIGNUP', '');
});
afterEach(() => { vi.unstubAllEnvs(); mail.on = false; });

async function session(email: string, password = PW.first, ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) Firefox/130.0'): Promise<Headers> {
  const r = await auth.api.signInEmail({ body: { email, password }, headers: new Headers({ 'user-agent': ua }), returnHeaders: true });
  return new Headers({ cookie: r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; '), 'user-agent': ua });
}
const alive = async (h: Headers) => !!(await auth.api.getSession({ headers: h }));
const canSignIn = async (email: string, password: string) => !!(await auth.api.signInEmail({ body: { email, password } }).catch(() => null));

describe('the account page', () => {
  it('shows your sessions (no tokens), sign-in methods and invitations, and nothing for no session', async () => {
    const h = await session('me@x.test');
    await session('me@x.test', PW.first, 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1');
    const c = await addCollection(db, 'Kids');
    if (!c.ok) throw new Error(c.error);
    await createInvite(db, await perm.accessOf(db, 'other@x.test').then((a) => ({ ...a, admin: true })), c.collection.id, 'me@x.test', 'viewer');
    const info = await account.accountInfo(db, h);
    expect(info).toMatchObject({ email: 'me@x.test', hasPassword: true, accounts: [{ providerId: 'credential' }], invitations: [{ collection: 'Kids', role: 'viewer', inviter: 'other@x.test', state: 'pending' }] });
    expect(info!.sessions).toHaveLength(2);
    expect(info!.sessions.filter((s) => s.current)).toHaveLength(1);
    const tokens = (await db.select({ t: authSession.token }).from(authSession).all()).map((r) => r.t);
    for (const t of tokens) expect(JSON.stringify(info)).not.toContain(t);
    expect(await account.accountInfo(db, new Headers())).toBeNull();
  });

  it('changes your name', async () => {
    const h = await session('me@x.test');
    expect(await account.changeName(db, h, '  ')).toMatchObject({ ok: false, status: 400 });
    expect(await account.changeName(db, h, 'Me')).toEqual({ ok: true });
    expect((await db.select().from(authUser).where(eq(authUser.email, 'me@x.test')).get())?.name).toBe('Me');
    expect(await account.changeName(db, new Headers(), 'Nobody')).toMatchObject({ ok: false, status: 403 });
  });
});

describe('changing your password', () => {
  it('needs the current one, and signs out your other sessions', async () => {
    const h = await session('me@x.test');
    const elsewhere = await session('me@x.test');
    const theirs = await session('other@x.test');
    expect(await account.changePassword(db, h, PW.first, 'short')).toMatchObject({ ok: false, status: 400 });
    expect(await account.changePassword(db, h, PW.wrong, PW.second)).toMatchObject({ ok: false, error: 'Your current password is wrong.' });
    expect(await account.changePassword(db, h, PW.first, PW.second)).toEqual({ ok: true });
    expect(await alive(elsewhere)).toBe(false);
    expect(await alive(theirs)).toBe(true);
    expect(await canSignIn('me@x.test', PW.first)).toBe(false);
    expect(await canSignIn('me@x.test', PW.second)).toBe(true);
  });
});

describe('sessions', () => {
  it('signs out one of yours, never someone else’s or this one', async () => {
    const h = await session('me@x.test');
    const elsewhere = await session('me@x.test');
    const theirs = await session('other@x.test');
    const info = (await account.accountInfo(db, h))!;
    const cur = info.sessions.find((s) => s.current)!, other = info.sessions.find((s) => !s.current)!;
    const theirId = (await account.accountInfo(db, theirs))!.sessions[0].id;
    expect(await account.revokeSession(db, h, cur.id)).toMatchObject({ ok: false, status: 409 });
    expect(await account.revokeSession(db, h, theirId)).toMatchObject({ ok: false, status: 404 });
    expect(await alive(theirs)).toBe(true);
    expect(await account.revokeSession(db, h, other.id)).toEqual({ ok: true });
    expect(await alive(elsewhere)).toBe(false);
    expect(await alive(h)).toBe(true);
  });

  it('signs out everywhere else', async () => {
    const h = await session('me@x.test');
    const a = await session('me@x.test'), b = await session('me@x.test');
    expect(await account.revokeOtherSessions(db, h)).toEqual({ ok: true });
    expect([await alive(h), await alive(a), await alive(b)]).toEqual([true, false, false]);
  });
});

describe('sign-in methods', () => {
  const linkGoogle = async () => {
    const userId = (await db.select({ id: authUser.id }).from(authUser).where(eq(authUser.email, 'me@x.test')).get())!.id;
    const id = crypto.randomUUID();
    await db.insert(authAccount).values({ id, userId, providerId: 'google', accountId: 'g-123', createdAt: new Date(), updatedAt: new Date() });
    return id;
  };
  const credentialId = async () => (await db.select({ id: authAccount.id }).from(authAccount).innerJoin(authUser, eq(authUser.id, authAccount.userId)).where(eq(authUser.email, 'me@x.test')).get())!.id;

  it("won't remove your only way to sign in", async () => {
    const h = await session('me@x.test');
    expect(await account.unlinkAccount(db, h, await credentialId())).toMatchObject({ ok: false, status: 409, error: expect.stringMatching(/only way/) });
    expect(await canSignIn('me@x.test', PW.first)).toBe(true);
  });

  it("doesn't count a provider this server no longer has keys for as a way back in", async () => {
    const h = await session('me@x.test');
    await linkGoogle(); // linked once, but GOOGLE_* isn't set now
    expect(await account.unlinkAccount(db, h, await credentialId())).toMatchObject({ ok: false, status: 409, error: expect.stringMatching(/only way/) });
    expect((await account.accountInfo(db, h))!.accounts.find((a) => a.providerId === 'google')).toMatchObject({ usable: false });
  });

  it('removes one when another is left, then guards the last', async () => {
    vi.stubEnv('GOOGLE_CLIENT_ID', crypto.randomUUID());
    vi.stubEnv('GOOGLE_CLIENT_SECRET', crypto.randomUUID());
    const h = await session('me@x.test');
    const cred = await credentialId();
    const google = await linkGoogle();
    expect(await account.unlinkAccount(db, h, google)).toEqual({ ok: true });
    expect(await account.unlinkAccount(db, h, cred)).toMatchObject({ ok: false, status: 409 });
    const g2 = await linkGoogle();
    expect(await account.unlinkAccount(db, h, cred)).toEqual({ ok: true }); // Google is left
    expect(await account.unlinkAccount(db, h, g2)).toMatchObject({ ok: false, status: 409 });
    // Someone else's account isn't yours to remove.
    const theirs = (await db.select({ id: authAccount.id }).from(authAccount).innerJoin(authUser, eq(authUser.id, authAccount.userId)).where(eq(authUser.email, 'other@x.test')).get())!.id;
    expect(await account.unlinkAccount(db, h, theirs)).toMatchObject({ ok: false, status: 404 });
  });

  it('adds a password to an account that signs in another way', async () => {
    vi.stubEnv('GOOGLE_CLIENT_ID', crypto.randomUUID());
    vi.stubEnv('GOOGLE_CLIENT_SECRET', crypto.randomUUID());
    const h = await session('me@x.test');
    await linkGoogle();
    await account.unlinkAccount(db, h, await credentialId());
    expect((await account.accountInfo(db, h))?.hasPassword).toBe(false);
    expect(await account.addPassword(db, h, PW.added)).toEqual({ ok: true });
    expect(await canSignIn('me@x.test', PW.added)).toBe(true);
  });
});
