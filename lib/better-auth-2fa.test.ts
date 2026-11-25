// #90 phase 2: passkeys and two-factor (TOTP + backup codes) in Better Auth. Password sign-in asks for the second
// factor, a passkey sign-in doesn't (it is one already), and both still pass ALLOWED_USERS and email verification.
// The passkey is a software authenticator made here (P-256, attestation "none"), so registration and sign-in run the
// real WebAuthn checks (@simplewebauthn/server). Keys, passwords and codes are all made at run time.
import { createHash, createHmac, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openNodeDb } from './db/node';
import type { DB } from './db/types';
import { authPasskey, authSession, authTwoFactor, authUser } from './db/schema';
import { getAuth } from './better-auth';
import { identify } from './auth';

vi.mock('server-only', () => ({}));
const links = vi.hoisted(() => [] as string[]);
vi.mock('./email', () => ({ emailConfigured: () => true, sendAuthEmail: async (_kind: string, msg: { url: string }) => { links.push(msg.url); } }));
const holder = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock('./db', () => ({ getDb: async () => holder.db }));

const password = crypto.randomUUID();
const ORIGIN = 'http://app';
let db: DB;
let auth: ReturnType<typeof getAuth>;

beforeEach(async () => {
  vi.stubEnv('AUTH_MODE', 'better-auth');
  vi.stubEnv('BETTER_AUTH_SECRET', crypto.randomUUID() + crypto.randomUUID());
  vi.stubEnv('BETTER_AUTH_URL', ORIGIN);
  db = openNodeDb(':memory:').db;
  holder.db = db;
  auth = getAuth(db);
  await auth.api.signUpEmail({ body: { email: 'me@x.test', password, name: 'Me' } }); // the first account: verified
});
afterEach(() => { vi.unstubAllEnvs(); });

const cookies = (...hs: Headers[]) => new Headers({ cookie: hs.flatMap((h) => h.getSetCookie()).filter((c) => !/max-age=0/i.test(c)).map((c) => c.split(';')[0]).join('; ') });
async function signIn() {
  const r = await auth.api.signInEmail({ body: { email: 'me@x.test', password }, returnHeaders: true });
  return { body: r.response as Record<string, unknown>, headers: cookies(r.headers) };
}

// ---- TOTP (RFC 6238), to act as the authenticator app ----
function base32(s: string) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const ch of s.replace(/=+$/, '').toUpperCase()) bits += A.indexOf(ch).toString(2).padStart(5, '0');
  return Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
}
function totp(uri: string, at = Date.now()) {
  const key = base32(new URL(uri).searchParams.get('secret')!);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(Math.floor(at / 30000)));
  const h = createHmac('sha1', key).update(msg).digest();
  const o = h[h.length - 1] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, '0');
}

const totpSetup = (r: { method: string; totpURI?: string; backupCodes?: string[] }) => ({ totpURI: r.totpURI!, backupCodes: r.backupCodes! });

/** Turns two-factor on for me@x.test: password → URI and backup codes → a code from the app. */
async function enable2fa() {
  const { headers } = await signIn();
  const r = totpSetup(await auth.api.enableTwoFactor({ body: { password }, headers }));
  expect(r.totpURI).toMatch(/^otpauth:\/\/totp\/Brickfolio:me%40x\.test\?.*issuer=Brickfolio/);
  expect(r.backupCodes).toHaveLength(10);
  const v = await auth.api.verifyTOTP({ body: { code: totp(r.totpURI!) }, headers, returnHeaders: true });
  return { uri: r.totpURI!, backupCodes: r.backupCodes, headers: cookies(v.headers) };
}

describe('two-factor', () => {
  it('is off until a code from the app confirms it', async () => {
    const { headers } = await signIn();
    const r = totpSetup(await auth.api.enableTwoFactor({ body: { password }, headers }));
    expect((await db.select().from(authUser).get())!.twoFactorEnabled).toBe(false);
    expect((await signIn()).body).not.toHaveProperty('twoFactorRedirect'); // not confirmed yet: no second step
    await expect(auth.api.verifyTOTP({ body: { code: totp(r.totpURI!, Date.now() - 300_000) }, headers })).rejects.toThrow();
    await auth.api.verifyTOTP({ body: { code: totp(r.totpURI!) }, headers });
    expect((await db.select().from(authUser).get())!.twoFactorEnabled).toBe(true);
  });

  it('refuses to turn on without the password', async () => {
    const { headers } = await signIn();
    await expect(auth.api.enableTwoFactor({ body: { password: crypto.randomUUID() }, headers })).rejects.toThrow(/password/i);
  });

  it('makes password sign-in ask for a code, then gives a session that passes identify', async () => {
    const { uri } = await enable2fa();
    const first = await signIn();
    expect(first.body).toEqual({ twoFactorRedirect: true, twoFactorMethods: ['totp'] });
    expect(first.headers.get('cookie')).not.toMatch(/session_token/); // no session before the code
    expect(await identify(first.headers)).toBeNull();
    await expect(auth.api.verifyTOTP({ body: { code: '000000' === totp(uri) ? '111111' : '000000' }, headers: first.headers })).rejects.toThrow();
    const ok = await auth.api.verifyTOTP({ body: { code: totp(uri), trustDevice: false }, headers: first.headers, returnHeaders: true });
    expect(await identify(cookies(ok.headers))).toEqual({ user: 'me@x.test', via: 'better-auth' });
  });

  it('takes each backup code once', async () => {
    const { backupCodes } = await enable2fa();
    const a = await signIn();
    const ok = await auth.api.verifyBackupCode({ body: { code: backupCodes[0] }, headers: a.headers, returnHeaders: true });
    expect(await identify(cookies(ok.headers))).toMatchObject({ user: 'me@x.test' });
    const b = await signIn();
    await expect(auth.api.verifyBackupCode({ body: { code: backupCodes[0] }, headers: b.headers })).rejects.toThrow(/backup code/i);
    await auth.api.verifyBackupCode({ body: { code: backupCodes[1] }, headers: b.headers }); // the others still work
    // All of them are one encrypted value in one row (a single-row update on D1; no codes in the clear).
    const row = (await db.select().from(authTwoFactor).get())!;
    expect(row.backupCodes).not.toContain(backupCodes[2]);
  });

  it('regenerates backup codes (old ones stop working) and turns off with the password', async () => {
    const { headers, backupCodes, uri } = await enable2fa();
    const fresh = await auth.api.generateBackupCodes({ body: { password }, headers });
    expect(fresh.backupCodes).toHaveLength(10);
    const a = await signIn();
    await expect(auth.api.verifyBackupCode({ body: { code: backupCodes[0] }, headers: a.headers })).rejects.toThrow();
    await auth.api.verifyTOTP({ body: { code: totp(uri) }, headers: a.headers });
    const off = await auth.api.disableTwoFactor({ body: { password }, headers, returnHeaders: true });
    expect(off.response).toEqual({ status: true });
    expect(await db.select().from(authTwoFactor).all()).toEqual([]);
    const s = await signIn();
    expect(s.body).not.toHaveProperty('twoFactorRedirect');
    expect(await identify(s.headers)).toMatchObject({ user: 'me@x.test' });
  });

  it('refuses its settings to someone taken out of ALLOWED_USERS', async () => {
    const { headers } = await signIn();
    vi.stubEnv('ALLOWED_USERS', 'someone-else@x.test');
    await expect(auth.api.enableTwoFactor({ body: { password }, headers })).rejects.toThrow(/don't have access/);
  });
});

// ---- A software passkey ----
function cbor(v: unknown): Buffer {
  const head = (major: number, n: number) => n < 24 ? Buffer.from([major << 5 | n]) : n < 256 ? Buffer.from([major << 5 | 24, n]) : Buffer.from([major << 5 | 25, n >> 8, n & 255]);
  if (typeof v === 'number') return v >= 0 ? head(0, v) : head(1, -1 - v);
  if (typeof v === 'string') return Buffer.concat([head(3, Buffer.byteLength(v)), Buffer.from(v)]);
  if (Buffer.isBuffer(v)) return Buffer.concat([head(2, v.length), v]);
  const entries = v instanceof Map ? [...v] : Object.entries(v as object);
  return Buffer.concat([head(5, entries.length), ...entries.flatMap(([k, x]) => [cbor(k), cbor(x)])]);
}
const b64u = (b: Buffer) => b.toString('base64url');
const rpIdHash = () => createHash('sha256').update(new URL(ORIGIN).hostname).digest();
const clientData = (type: string, challenge: string) => Buffer.from(JSON.stringify({ type, challenge, origin: ORIGIN, crossOrigin: false }));

class FakeAuthenticator {
  id = randomBytes(16);
  key: { privateKey: KeyObject; publicKey: KeyObject } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  counter = 0;
  register(challenge: string) {
    const jwk = this.key.publicKey.export({ format: 'jwk' });
    const cose = cbor(new Map<number, unknown>([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x!, 'base64url')], [-3, Buffer.from(jwk.y!, 'base64url')]]));
    const len = Buffer.from([this.id.length >> 8, this.id.length & 255]);
    const authData = Buffer.concat([rpIdHash(), Buffer.from([0x45]), Buffer.alloc(4), Buffer.alloc(16), len, this.id, cose]);
    return {
      id: b64u(this.id), rawId: b64u(this.id), type: 'public-key' as const, clientExtensionResults: {}, authenticatorAttachment: 'platform' as const,
      response: { clientDataJSON: b64u(clientData('webauthn.create', challenge)), attestationObject: b64u(cbor({ fmt: 'none', attStmt: {}, authData })), transports: ['internal' as const] },
    };
  }
  authenticate(challenge: string) {
    const count = Buffer.alloc(4);
    count.writeUInt32BE(++this.counter);
    const authData = Buffer.concat([rpIdHash(), Buffer.from([0x05]), count]);
    const cd = clientData('webauthn.get', challenge);
    const signature = sign('sha256', Buffer.concat([authData, createHash('sha256').update(cd).digest()]), this.key.privateKey);
    return {
      id: b64u(this.id), rawId: b64u(this.id), type: 'public-key' as const, clientExtensionResults: {},
      response: { clientDataJSON: b64u(cd), authenticatorData: b64u(authData), signature: b64u(signature) },
    };
  }
}

async function addPasskey(device: FakeAuthenticator, headers: Headers, name = 'Laptop') {
  const o = await auth.api.generatePasskeyRegistrationOptions({ headers, returnHeaders: true });
  expect(o.response).toMatchObject({ rp: { id: 'app', name: 'Brickfolio' }, user: { name: 'me@x.test' } });
  const h = new Headers({ cookie: `${headers.get('cookie')}; ${cookies(o.headers).get('cookie')}` });
  return auth.api.verifyPasskeyRegistration({ body: { response: device.register(o.response.challenge), name }, headers: h });
}
async function passkeySignIn(device: FakeAuthenticator) {
  const o = await auth.api.generatePasskeyAuthenticationOptions({ returnHeaders: true });
  expect(o.response).toMatchObject({ rpId: 'app' });
  const r = await auth.api.verifyPasskeyAuthentication({ body: { response: device.authenticate(o.response.challenge) }, headers: cookies(o.headers), returnHeaders: true });
  return cookies(r.headers);
}

describe('passkeys', () => {
  it('registers only for someone signed in', async () => {
    await expect(auth.api.generatePasskeyRegistrationOptions({ headers: new Headers() })).rejects.toThrow();
    await expect(auth.api.verifyPasskeyRegistration({ body: { response: new FakeAuthenticator().register('x') }, headers: new Headers() })).rejects.toThrow();
    expect(await db.select().from(authPasskey).all()).toEqual([]);
  });

  it('registers, signs in without asking for two-factor, and can be renamed and deleted', async () => {
    const device = new FakeAuthenticator();
    const { headers } = await enable2fa();
    const pk = await addPasskey(device, headers);
    expect(pk).toMatchObject({ name: 'Laptop', credentialID: b64u(device.id) });
    const s = await passkeySignIn(device);
    expect(await identify(s)).toEqual({ user: 'me@x.test', via: 'better-auth' });
    await auth.api.updatePasskey({ body: { id: pk.id, name: 'Phone' }, headers: s });
    expect((await auth.api.listPasskeys({ headers: s })).map((p) => p.name)).toEqual(['Phone']);
    await auth.api.deletePasskey({ body: { id: pk.id }, headers: s });
    await expect(passkeySignIn(device)).rejects.toThrow();
  });

  it('refuses a signature from another key', async () => {
    const device = new FakeAuthenticator();
    await addPasskey(device, (await signIn()).headers);
    device.key = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    await expect(passkeySignIn(device)).rejects.toThrow();
  });

  it('gives no access to someone taken out of ALLOWED_USERS, nor to an unverified address', async () => {
    const device = new FakeAuthenticator();
    await addPasskey(device, (await signIn()).headers);
    const s = await passkeySignIn(device);
    vi.stubEnv('ALLOWED_USERS', 'someone-else@x.test');
    expect(await identify(s)).toBeNull(); // an existing passkey session stops working
    await expect(passkeySignIn(device)).rejects.toThrow(/don't have access/); // and no new one is made
    await expect(auth.api.listPasskeys({ headers: s })).rejects.toThrow(/don't have access/);
    vi.stubEnv('ALLOWED_USERS', '');
    await db.update(authUser).set({ emailVerified: false });
    await expect(passkeySignIn(device)).rejects.toThrow(/don't have access/);
  });
});

describe('bans (#102)', () => {
  it('refuse passkey sign-in too, and an ended ban lets the passkey back in', async () => {
    const device = new FakeAuthenticator();
    await addPasskey(device, (await signIn()).headers);
    const s = await passkeySignIn(device);
    await db.update(authUser).set({ banned: true, banExpires: new Date(Date.now() + 60_000) });
    await db.delete(authSession); // what banPerson does with the ban
    expect(await identify(s)).toBeNull();
    await expect(passkeySignIn(device)).rejects.toThrow(/banned/);
    await db.update(authUser).set({ banExpires: new Date(Date.now() - 1000) });
    expect(await identify(await passkeySignIn(device))).toEqual({ user: 'me@x.test', via: 'better-auth' });
  });
});

describe('emailed sign-in links with two-factor on (#94 follow-up)', () => {
  const setCookies = (res: Response) => res.headers.getSetCookie().filter((c) => !/max-age=0/i.test(c)).map((c) => c.split(';')[0]);
  async function follow(extra: string[] = []) {
    links.length = 0;
    await auth.api.signInMagicLink({ body: { email: 'me@x.test', callbackURL: '/' }, headers: new Headers() });
    const res = await auth.handler(new Request(links.at(-1)!, { headers: { cookie: extra.join('; ') } }));
    return { to: new URL(res.headers.get('location')!, ORIGIN).pathname, cookies: setCookies(res) };
  }

  it('signs straight in while two-factor is off', async () => {
    const r = await follow();
    expect(r.to).toBe('/');
    expect(r.cookies.some((c) => c.includes('session_token='))).toBe(true);
  });

  it('asks for the code instead of signing in, then the code finishes it; a trusted device is not asked again', async () => {
    const { uri } = await enable2fa();
    const r = await follow();
    expect(r.to).toBe('/sign-in/two-factor');
    expect(r.cookies.some((c) => c.includes('session_token='))).toBe(false);
    const pending = r.cookies.filter((c) => c.includes('two_factor='));
    expect(pending).toHaveLength(1);
    const v = await auth.api.verifyTOTP({ body: { code: totp(uri, Date.now() + 30_000), trustDevice: true }, headers: new Headers({ cookie: pending.join('; ') }), returnHeaders: true });
    const after = v.headers.getSetCookie().map((c) => c.split(';')[0]);
    expect(after.some((c) => c.includes('session_token='))).toBe(true);
    const trust = after.filter((c) => c.includes('trust_device='));
    expect(trust).toHaveLength(1);
    expect((await follow(trust)).to).toBe('/'); // "don't ask again for 30 days"
  });
});
