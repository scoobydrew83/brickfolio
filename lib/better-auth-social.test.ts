// #90 phase 2: sign-in with Google, GitHub or Apple, and emailed sign-in links. The same sign-up rules hold: the first
// account is an admin, then only ALLOWED_USERS or BETTER_AUTH_OPEN_SIGNUP; a provider that verified the address (or
// following the link) proves it, so neither needs email set up for that. GitHub's API is faked with a stubbed fetch.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { openNodeDb } from './db/node';
import type { DB } from './db/types';
import { authAccount, authSession, authUser } from './db/schema';
import { configuredProviders, getAuth, signupOpen, socialProviders } from './better-auth';
import * as perm from './service/permissions';

vi.mock('server-only', () => ({}));
const mail = vi.hoisted(() => ({ on: false, sent: [] as { kind: string; msg: { to: string; url: string } }[] }));
vi.mock('./email', () => ({
  emailConfigured: () => mail.on,
  sendAuthEmail: async (kind: string, msg: { to: string; url: string }) => { mail.sent.push({ kind, msg }); },
}));

const BASE = 'http://app';
let db: DB;
let auth: ReturnType<typeof getAuth>;
// What the fake GitHub says about the person signing in.
let gh: { id: number; email: string; verified: boolean };

beforeEach(() => {
  vi.stubEnv('AUTH_MODE', 'better-auth');
  vi.stubEnv('BETTER_AUTH_SECRET', crypto.randomUUID() + crypto.randomUUID());
  vi.stubEnv('BETTER_AUTH_URL', BASE);
  vi.stubEnv('GITHUB_CLIENT_ID', crypto.randomUUID());
  vi.stubEnv('GITHUB_CLIENT_SECRET', crypto.randomUUID());
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    const json = (b: unknown) => new Response(JSON.stringify(b), { headers: { 'content-type': 'application/json' } });
    if (url.startsWith('https://github.com/login/oauth/access_token')) return json({ access_token: crypto.randomUUID(), token_type: 'bearer', scope: 'read:user,user:email' });
    if (url === 'https://api.github.com/user') return json({ id: gh.id, login: `u${gh.id}`, name: `User ${gh.id}`, email: null, avatar_url: '' });
    if (url === 'https://api.github.com/user/emails') return json([{ email: gh.email, primary: true, verified: gh.verified }]);
    throw new Error(`unexpected fetch ${url}`);
  });
  db = openNodeDb(':memory:').db;
  auth = getAuth(db);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); mail.on = false; mail.sent = []; });

const cookiesOf = (res: Response) => res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
const userRow = (email: string) => db.select().from(authUser).where(eq(authUser.email, email)).get();
const sessionsOf = async (email: string) => {
  const u = await userRow(email);
  return u ? db.select().from(authSession).where(eq(authSession.userId, u.id)).all() : [];
};

/** The whole GitHub round trip: start sign-in, come back to the callback. Returns where the browser is sent. */
async function github(email: string, verified = true, id = 1) {
  gh = { id, email, verified };
  const start = await auth.handler(new Request(`${BASE}/api/auth/sign-in/social`, {
    method: 'POST', headers: { 'content-type': 'application/json', origin: BASE },
    body: JSON.stringify({ provider: 'github', callbackURL: '/', errorCallbackURL: '/sign-in' }),
  }));
  const { url } = (await start.json()) as { url: string };
  const state = new URL(url).searchParams.get('state')!;
  const res = await auth.handler(new Request(`${BASE}/api/auth/callback/github?code=c&state=${state}`, { headers: { cookie: cookiesOf(start) } }));
  const to = new URL(res.headers.get('location')!, BASE);
  return { to: to.pathname, error: to.searchParams.get('error'), signedIn: /session_token=/.test(cookiesOf(res)) };
}

describe('providers', () => {
  it('are on only when both their keys are set', () => {
    expect(socialProviders({})).toEqual({});
    expect(configuredProviders({ GOOGLE_CLIENT_ID: 'a', GITHUB_CLIENT_ID: 'b', GITHUB_CLIENT_SECRET: 'c' })).toEqual(['github']);
    const id = crypto.randomUUID(), secret = crypto.randomUUID();
    expect(socialProviders({ GOOGLE_CLIENT_ID: id, GOOGLE_CLIENT_SECRET: secret, APPLE_CLIENT_ID: id, APPLE_CLIENT_SECRET: secret, APPLE_APP_BUNDLE_IDENTIFIER: 'com.x' })).toEqual({
      google: { clientId: id, clientSecret: secret, prompt: 'select_account' },
      apple: { clientId: id, clientSecret: secret, appBundleIdentifier: 'com.x' },
    });
  });

  it('send people back to <BETTER_AUTH_URL>/api/auth/callback/<provider>', async () => {
    const r = await auth.api.signInSocial({ body: { provider: 'github', callbackURL: '/' } });
    expect(new URL(r.url!).searchParams.get('redirect_uri')).toBe(`${BASE}/api/auth/callback/github`);
  });
});

describe('signing up with a provider', () => {
  it('makes the first account an admin, verified, without email set up', async () => {
    expect(await github('first@x.test')).toEqual({ to: '/', error: null, signedIn: true });
    expect(await userRow('first@x.test')).toMatchObject({ role: 'admin', emailVerified: true });
  });

  it('then follows ALLOWED_USERS and BETTER_AUTH_OPEN_SIGNUP; a verified provider address needs no email set up', async () => {
    await github('first@x.test');
    expect(await github('second@x.test', true, 2)).toEqual({ to: '/sign-in', error: 'SIGNUP_CLOSED', signedIn: false });
    expect(await userRow('second@x.test')).toBeUndefined();
    vi.stubEnv('ALLOWED_USERS', 'first@x.test,second@x.test');
    expect(await github('second@x.test', true, 2)).toMatchObject({ to: '/', signedIn: true });
    expect(await userRow('second@x.test')).toMatchObject({ role: 'user', emailVerified: true });
    expect(signupOpen('second@x.test')).toBe(false); // a password sign-up still needs email
    expect(signupOpen('second@x.test', process.env, true)).toBe(true);
  });

  it('is refused when the provider has not verified the address, even with open sign-up or as the first account', async () => {
    expect(await github('first@x.test', false)).toMatchObject({ to: '/sign-in', error: 'PROVIDER_EMAIL_NOT_VERIFIED', signedIn: false });
    expect(await db.select().from(authUser).all()).toEqual([]);
    await github('admin@x.test', true, 9);
    vi.stubEnv('BETTER_AUTH_OPEN_SIGNUP', '1');
    expect((await github('anyone@x.test', false, 2)).error).toBe('PROVIDER_EMAIL_NOT_VERIFIED');
    expect(await userRow('anyone@x.test')).toBeUndefined();
  });
});

describe('linking a provider to an existing account', () => {
  beforeEach(async () => { await github('admin@x.test', true, 9); });

  it('lets someone an admin added (no password, unverified) sign in with the same verified address', async () => {
    await perm.addPerson(db, 'new@x.test');
    expect(await perm.setRole(db, { login: 'admin@x.test', admin: true, roles: new Map() }, 1, 'new@x.test', 'viewer')).toEqual({ ok: true });
    expect(await userRow('new@x.test')).toMatchObject({ emailVerified: false });
    expect(await github('New@x.test', true, 2)).toMatchObject({ to: '/', signedIn: true });
    const u = (await userRow('new@x.test'))!;
    expect(u).toMatchObject({ emailVerified: true, role: 'user' });
    expect((await db.select().from(authAccount).where(eq(authAccount.userId, u.id)).all()).map((a) => a.providerId)).toEqual(['github']);
    expect([...(await perm.resolveAccess(db, { user: 'new@x.test', via: 'better-auth' })).roles]).toEqual([[1, 'viewer']]); // roles kept
    expect(await github('new@x.test', true, 2)).toMatchObject({ to: '/', signedIn: true }); // and again, through the link
  });

  it('drops an unproven password on that account before linking (it may not be theirs)', async () => {
    await perm.addPerson(db, 'new@x.test');
    const ctx = await auth.$context;
    const u = (await userRow('new@x.test'))!;
    await ctx.internalAdapter.createAccount({ userId: u.id, providerId: 'credential', accountId: u.id, password: await ctx.password.hash(crypto.randomUUID()) });
    await github('new@x.test', true, 2);
    expect((await db.select().from(authAccount).where(eq(authAccount.userId, u.id)).all()).map((a) => a.providerId)).toEqual(['github']);
  });

  it('never links from a provider that has not verified the address', async () => {
    expect(await github('admin@x.test', false, 3)).toMatchObject({ to: '/sign-in', error: 'account_not_linked', signedIn: false });
    await perm.addPerson(db, 'new@x.test');
    expect((await github('new@x.test', false, 4)).error).toBe('account_not_linked');
    expect(await db.select({ p: authAccount.providerId, a: authAccount.accountId }).from(authAccount).all()).toEqual([{ p: 'github', a: '9' }]);
    expect(await userRow('new@x.test')).toMatchObject({ emailVerified: false });
  });

  it("doesn't sign in someone taken out of ALLOWED_USERS", async () => {
    vi.stubEnv('ALLOWED_USERS', 'someone-else@x.test');
    expect(await github('admin@x.test', true, 9)).toMatchObject({ to: '/sign-in', error: 'NOT_ALLOWED', signedIn: false });
  });
});

describe('emailed sign-in links', () => {
  const ask = (email: string) => auth.api.signInMagicLink({ body: { email, callbackURL: '/', errorCallbackURL: '/sign-in' }, headers: new Headers() });
  const follow = async (url: string) => {
    const res = await auth.handler(new Request(url));
    const to = new URL(res.headers.get('location')!, BASE);
    return { to: to.pathname, error: to.searchParams.get('error'), signedIn: /session_token=/.test(cookiesOf(res)) };
  };
  const lastLink = () => mail.sent.at(-1)!.msg.url;

  beforeEach(async () => { await github('admin@x.test', true, 9); mail.on = true; });

  it('need email set up', async () => {
    mail.on = false;
    await expect(ask('admin@x.test')).rejects.toThrow(/Email isn't set up/);
    expect(mail.sent).toEqual([]);
  });

  it('sign in someone an admin added and prove their address; a link works once', async () => {
    await perm.addPerson(db, 'new@x.test');
    await ask('New@x.test');
    expect(mail.sent).toEqual([{ kind: 'magic-link', msg: { to: 'new@x.test', url: expect.stringMatching(/^http:\/\/app\/api\/auth\/magic-link\/verify\?token=/) } }]);
    expect(await follow(lastLink())).toEqual({ to: '/', error: null, signedIn: true });
    expect(await userRow('new@x.test')).toMatchObject({ emailVerified: true });
    expect(await follow(lastLink())).toMatchObject({ to: '/sign-in', error: 'INVALID_TOKEN', signedIn: false });
  });

  it('follow the sign-up rules: nothing is sent to an address that could not sign up', async () => {
    await ask('stranger@x.test');
    expect(mail.sent).toEqual([]);
    vi.stubEnv('ALLOWED_USERS', 'admin@x.test,friend@x.test');
    await ask('stranger@x.test');
    expect(mail.sent).toEqual([]);
    await ask('friend@x.test');
    expect(await follow(lastLink())).toMatchObject({ to: '/', signedIn: true });
    expect(await userRow('friend@x.test')).toMatchObject({ role: 'user', emailVerified: true });
  });

  it("aren't sent to someone taken out of ALLOWED_USERS, and an old link doesn't sign them in", async () => {
    await ask('admin@x.test');
    const old = lastLink();
    vi.stubEnv('ALLOWED_USERS', 'someone-else@x.test');
    await ask('admin@x.test');
    expect(mail.sent).toHaveLength(1);
    expect(await sessionsOf('admin@x.test')).toHaveLength(1); // the one from beforeEach
    await auth.handler(new Request(old)).catch(() => null);
    expect(await sessionsOf('admin@x.test')).toHaveLength(1);
  });
});
