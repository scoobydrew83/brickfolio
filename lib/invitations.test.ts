// #90 phase 2: invitations follow Brickfolio's rules (setRole) through the service and Better Auth's endpoints alike.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { openNodeDb } from './db/node';
import type { DB } from './db/types';
import { authInvitation, authUser } from './db/schema';
import { getAuth } from './better-auth';
import { addCollection } from './service/collections';
import * as perm from './service/permissions';
import * as inv from './service/invitations';

vi.mock('server-only', () => ({}));
const mail = vi.hoisted(() => ({ on: false, fail: false, sent: [] as { kind: string; msg: { to: string; url: string; inviter?: string; collection?: string } }[] }));
vi.mock('./email', () => ({
  emailConfigured: () => mail.on,
  sendAuthEmail: async (kind: string, msg: { to: string; url: string }) => { if (mail.fail) throw new Error('provider down'); mail.sent.push({ kind, msg }); },
}));
// Made up at run time, so secret scanners have no literal to flag.
const password = `${crypto.randomUUID()}`;
let db: DB;
let auth: ReturnType<typeof getAuth>;
let kids = 0, other = 0;
const ADMIN = () => ({ login: 'admin@x.test', admin: true, roles: new Map() }) as perm.Access;
const acc = (login: string) => perm.accessOf(db, login);

beforeEach(async () => {
  vi.stubEnv('AUTH_MODE', 'better-auth');
  vi.stubEnv('BETTER_AUTH_SECRET', crypto.randomUUID() + crypto.randomUUID());
  vi.stubEnv('BETTER_AUTH_URL', 'http://app');
  db = openNodeDb(':memory:').db;
  auth = getAuth(db);
  for (const [name, set] of [['Kids', (n: number) => (kids = n)], ['Other', (n: number) => (other = n)]] as const) {
    const r = await addCollection(db, name);
    if (!r.ok) throw new Error(r.error);
    set(r.collection.id);
  }
  await signUp('admin@x.test'); // the first account: the admin
  for (const e of ['owner@x.test', 'editor@x.test', 'viewer@x.test']) await addVerified(e);
  await perm.setRole(db, ADMIN(), kids, 'owner@x.test', 'owner');
  await perm.setRole(db, ADMIN(), kids, 'editor@x.test', 'editor');
  await perm.setRole(db, ADMIN(), kids, 'viewer@x.test', 'viewer');
});
afterEach(() => { vi.unstubAllEnvs(); mail.on = false; mail.fail = false; mail.sent = []; });

/** Signs up with email set up, then follows the verification link. */
async function signUp(email: string) {
  const was = mail.on;
  mail.on = true;
  try { await auth.api.signUpEmail({ body: { email, password, name: email } }); } finally { mail.on = was; }
  mail.sent = mail.sent.filter((m) => m.kind !== 'verify-email');
  await db.update(authUser).set({ emailVerified: true }).where(eq(authUser.email, email));
}
/** An account made while sign-up is open. */
async function addVerified(email: string) {
  vi.stubEnv('BETTER_AUTH_OPEN_SIGNUP', '1');
  try { await signUp(email); } finally { vi.stubEnv('BETTER_AUTH_OPEN_SIGNUP', ''); }
}
async function session(email: string): Promise<Headers> {
  const r = await auth.api.signInEmail({ body: { email, password }, returnHeaders: true });
  return new Headers({ cookie: r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ') });
}
const invite = async (actor: perm.Access, c: number, email: string, role: string) => inv.createInvite(db, actor, c, email, role);
const roleOf = async (email: string, c = kids) => (await acc(email)).roles.get(c);

describe('who may invite', () => {
  it('admins into any collection at any role; owners into theirs; viewers and editors not at all', async () => {
    for (const role of ['viewer', 'editor', 'owner']) expect(await invite(ADMIN(), other, `${role}-a@x.test`, role)).toMatchObject({ ok: true });
    const owner = await acc('owner@x.test');
    for (const role of ['viewer', 'editor', 'owner']) expect(await invite(owner, kids, `${role}-o@x.test`, role)).toMatchObject({ ok: true });
    expect(await invite(owner, other, 'n@x.test', 'viewer')).toMatchObject({ ok: false, status: 403 });
    expect(await invite(await acc('editor@x.test'), kids, 'n@x.test', 'viewer')).toMatchObject({ ok: false, status: 403 });
    expect(await invite(await acc('viewer@x.test'), kids, 'n@x.test', 'viewer')).toMatchObject({ ok: false, status: 403 });
  });

  it('refuses a role that does not exist, a bad address, yourself, a member, and someone ALLOWED_USERS keeps out', async () => {
    const owner = await acc('owner@x.test');
    expect(await invite(owner, kids, 'n@x.test', 'admin')).toMatchObject({ ok: false, status: 400, error: expect.stringMatching(/Role must be/) });
    expect(await invite(owner, kids, 'not-an-email', 'viewer')).toMatchObject({ ok: false, status: 400 });
    expect(await invite(owner, kids, 'owner@x.test', 'viewer')).toMatchObject({ ok: false, status: 409 });
    expect(await invite(owner, kids, 'Viewer@x.test', 'editor')).toMatchObject({ ok: false, status: 409, error: expect.stringMatching(/already has a role/) });
    vi.stubEnv('ALLOWED_USERS', 'admin@x.test,owner@x.test');
    expect(await invite(owner, kids, 'n@x.test', 'viewer')).toMatchObject({ ok: false, status: 409, error: expect.stringMatching(/ALLOWED_USERS/) });
    expect(await inv.listInvites(db, owner)).toEqual([]);
  });

  it('replaces an earlier invitation for the same address with a new link', async () => {
    const a = await invite(ADMIN(), kids, 'n@x.test', 'viewer');
    const b = await invite(ADMIN(), kids, 'N@x.test', 'editor');
    if (!a.ok || !b.ok) throw new Error('no invite');
    expect((await inv.getInvite(db, a.id))?.state).toBe('canceled');
    expect(await inv.listInvites(db, await acc('owner@x.test'))).toEqual([expect.objectContaining({ id: b.id, email: 'n@x.test', role: 'editor', collection: 'Kids', inviter: 'admin@x.test', url: `http://app/invite/${b.id}` })]);
    expect(await inv.listInvites(db, await acc('viewer@x.test'))).toEqual([]); // only for those who manage it
  });

  it('counts pending invitations against the 90-member cap', async () => {
    const n = perm.MEMBERSHIP_LIMIT - 3 - 1; // three members already, and one invitation below
    for (let i = 0; i < n; i++) await perm.setRole(db, ADMIN(), kids, `p${i}@x.test`, 'viewer');
    expect(await invite(ADMIN(), kids, 'last@x.test', 'viewer')).toMatchObject({ ok: true });
    expect(await invite(ADMIN(), kids, 'one-more@x.test', 'viewer')).toMatchObject({ ok: false, status: 409, error: expect.stringMatching(/90 members/) });
    expect(await invite(ADMIN(), kids, 'last@x.test', 'editor')).toMatchObject({ ok: true }); // replacing theirs is fine
  });
});

describe('sending', () => {
  it('mails the link when email is set up, else returns it to copy', async () => {
    const plain = await invite(ADMIN(), kids, 'n@x.test', 'viewer');
    expect(plain).toMatchObject({ ok: true, sent: false, url: expect.stringMatching(/^http:\/\/app\/invite\/[\w-]+$/) });
    expect(mail.sent).toEqual([]);
    mail.on = true;
    const r = await invite(await acc('owner@x.test'), kids, 'm@x.test', 'editor');
    if (!r.ok) throw new Error(r.error);
    expect(mail.sent).toEqual([{ kind: 'invitation', msg: { to: 'm@x.test', url: r.url, inviter: 'owner@x.test', collection: 'Kids' } }]);
    mail.fail = true;
    expect(await invite(ADMIN(), kids, 'k@x.test', 'viewer')).toMatchObject({ ok: true, sent: false, mailError: 'provider down', url: expect.any(String) });
  });
});

describe('accepting', () => {
  it('gives the role to the invited address once it is verified, through the service or Better Auth', async () => {
    const r = await invite(await acc('owner@x.test'), kids, 'new@x.test', 'editor');
    if (!r.ok) throw new Error(r.error);
    await addVerified('new@x.test');
    expect(await inv.acceptInvite(db, { email: 'new@x.test', emailVerified: false }, r.id)).toMatchObject({ ok: false, status: 403 });
    expect(await inv.acceptInvite(db, { email: 'viewer@x.test', emailVerified: true }, r.id)).toMatchObject({ ok: false, status: 403, error: expect.stringMatching(/for new@x.test/) });
    const res = await auth.api.acceptInvitation({ headers: await session('new@x.test'), body: { invitationId: r.id } });
    expect(res).toMatchObject({ invitation: { id: r.id, status: 'accepted' }, member: { role: 'editor', organizationId: perm.orgId(kids) } });
    expect(await roleOf('new@x.test')).toBe('editor');
    expect(await inv.acceptInvite(db, { email: 'new@x.test', emailVerified: true }, r.id)).toMatchObject({ ok: false, status: 409, error: expect.stringMatching(/already been accepted/) });
  });

  it('refuses expired, cancelled and declined invitations', async () => {
    await addVerified('new@x.test');
    const me = { email: 'new@x.test', emailVerified: true };
    const a = await invite(ADMIN(), kids, 'new@x.test', 'viewer');
    if (!a.ok) throw new Error(a.error);
    await db.update(authInvitation).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(authInvitation.id, a.id));
    expect(await inv.acceptInvite(db, me, a.id)).toMatchObject({ ok: false, error: expect.stringMatching(/expired/) });
    expect((await inv.getInvite(db, a.id))?.state).toBe('expired');
    const b = await invite(ADMIN(), kids, 'new@x.test', 'viewer');
    if (!b.ok) throw new Error(b.error);
    expect(await inv.cancelInvite(db, await acc('viewer@x.test'), b.id)).toMatchObject({ ok: false, status: 403 });
    expect(await inv.cancelInvite(db, await acc('owner@x.test'), b.id)).toEqual({ ok: true });
    expect(await inv.acceptInvite(db, me, b.id)).toMatchObject({ ok: false, error: expect.stringMatching(/cancelled/) });
    const c = await invite(ADMIN(), kids, 'new@x.test', 'viewer');
    if (!c.ok) throw new Error(c.error);
    await auth.api.rejectInvitation({ headers: await session('new@x.test'), body: { invitationId: c.id } });
    expect(await inv.acceptInvite(db, me, c.id)).toMatchObject({ ok: false, error: expect.stringMatching(/declined/) });
    expect(await inv.acceptInvite(db, me, 'nope')).toMatchObject({ ok: false, status: 404 });
    expect(await roleOf('new@x.test')).toBeUndefined();
  });

  it("uses the inviter's rights when it's accepted: an owner who lost the collection can't bring anyone in", async () => {
    const r = await invite(await acc('owner@x.test'), kids, 'new@x.test', 'owner');
    if (!r.ok) throw new Error(r.error);
    await perm.setRole(db, ADMIN(), kids, 'owner@x.test', 'viewer');
    await addVerified('new@x.test');
    expect(await inv.acceptInvite(db, { email: 'new@x.test', emailVerified: true }, r.id)).toMatchObject({ ok: false, status: 409, error: expect.stringMatching(/can no longer add people/) });
    expect(await roleOf('new@x.test')).toBeUndefined();
    expect((await inv.getInvite(db, r.id))?.state).toBe('pending'); // left for an admin to cancel
  });

  it('respects the 90-member cap when accepting', async () => {
    const r = await invite(ADMIN(), kids, 'new@x.test', 'viewer');
    if (!r.ok) throw new Error(r.error);
    for (let i = 0; perm.MEMBERSHIP_LIMIT - 3 > i; i++) await perm.setRole(db, ADMIN(), kids, `p${i}@x.test`, 'viewer');
    await addVerified('new@x.test');
    expect(await inv.acceptInvite(db, { email: 'new@x.test', emailVerified: true }, r.id)).toMatchObject({ ok: false, status: 409, error: expect.stringMatching(/90 members/) });
  });
});

describe('sign-up while it is closed', () => {
  it('lets the invited address sign up (with email, to prove it) and nobody else', async () => {
    mail.on = true;
    await expect(auth.api.signUpEmail({ body: { email: 'stranger@x.test', password, name: 'S' } })).rejects.toThrow(/Sign-up is closed/);
    const r = await invite(await acc('owner@x.test'), kids, 'friend@x.test', 'viewer');
    if (!r.ok) throw new Error(r.error);
    await expect(auth.api.signUpEmail({ body: { email: 'stranger@x.test', password, name: 'S' } })).rejects.toThrow(/Sign-up is closed/);
    await auth.api.signUpEmail({ body: { email: 'friend@x.test', password, name: 'F', callbackURL: `/invite/${r.id}` } });
    const verify = mail.sent.find((m) => m.kind === 'verify-email' && m.msg.to === 'friend@x.test');
    expect(verify?.msg.url).toContain(encodeURIComponent(`/invite/${r.id}`));
    // Not verified yet: can't sign in, so can't accept.
    await expect(auth.api.signInEmail({ body: { email: 'friend@x.test', password } })).rejects.toThrow();
    expect((await db.select().from(authUser).where(eq(authUser.email, 'friend@x.test')).get())?.emailVerified).toBe(false);
  });

  it("doesn't without email (a copied link proves nothing about the address), or once the invitation is cancelled", async () => {
    const r = await invite(ADMIN(), kids, 'friend@x.test', 'viewer');
    if (!r.ok) throw new Error(r.error);
    await expect(auth.api.signUpEmail({ body: { email: 'friend@x.test', password, name: 'F' } })).rejects.toThrow(/Sign-up is closed/);
    mail.on = true;
    await inv.cancelInvite(db, ADMIN(), r.id);
    await expect(auth.api.signUpEmail({ body: { email: 'friend@x.test', password, name: 'F' } })).rejects.toThrow(/Sign-up is closed/);
  });
});

describe("Better Auth's invitation endpoints follow the same rules", () => {
  const body = (email: string, role: string, c = kids) => ({ organizationId: perm.orgId(c), email, role: role as 'owner' });

  it("refuses a viewer or editor, and an owner outside their collection", async () => {
    await expect(auth.api.createInvitation({ headers: await session('viewer@x.test'), body: body('n@x.test', 'viewer') })).rejects.toThrow(/permission/);
    await expect(auth.api.createInvitation({ headers: await session('editor@x.test'), body: body('n@x.test', 'viewer') })).rejects.toThrow(/permission/);
    await expect(auth.api.createInvitation({ headers: await session('owner@x.test'), body: body('n@x.test', 'viewer', other) })).rejects.toThrow(/permission/);
    await expect(auth.api.createInvitation({ headers: await session('owner@x.test'), body: body('n@x.test', 'admin') })).rejects.toThrow(/Role must be/);
    expect(await db.select().from(authInvitation).all()).toEqual([]);
  });

  it('lets an owner invite and cancel, and an admin who is not a member invite anywhere', async () => {
    const h = await session('owner@x.test');
    const i = await auth.api.createInvitation({ headers: h, body: body('n@x.test', 'owner') });
    expect(i).toMatchObject({ email: 'n@x.test', role: 'owner', status: 'pending', organizationId: perm.orgId(kids) });
    expect(i!.expiresAt.getTime() - Date.now()).toBeGreaterThan(inv.INVITE_MS - 60_000);
    await expect(auth.api.cancelInvitation({ headers: await session('viewer@x.test'), body: { invitationId: i!.id } })).rejects.toThrow(/permission/);
    expect(await auth.api.cancelInvitation({ headers: h, body: { invitationId: i!.id } })).toMatchObject({ status: 'canceled' });
    expect(await auth.api.createInvitation({ headers: await session('admin@x.test'), body: body('n@x.test', 'editor', other) })).toMatchObject({ role: 'editor', organizationId: perm.orgId(other) });
  });
});
