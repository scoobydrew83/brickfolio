// The signed-in person's own account (/account, #90 phase 2): name, password, sessions and sign-in methods. Each
// function takes the request's headers, so it acts only on that session's user. Session tokens never leave the
// server: the page sees session ids.
import { and, eq, gt } from 'drizzle-orm';
import { APIError } from 'better-auth/api';
import type { DB } from './db/types';
import { authAccount, authSession } from './db/schema';
import { configuredProviders, getAuth, MIN_PASSWORD } from './better-auth';
import { invitesFor, type InviteInfo } from './service/invitations';
import type { Result } from './service/sets';

export type AccountSession = { id: string; current: boolean; userAgent: string | null; ipAddress: string | null; createdAt: string; updatedAt: string };
export type LinkedAccount = { id: string; providerId: string; createdAt: string; usable: boolean };
export type AccountInfo = { name: string; email: string; hasPassword: boolean; sessions: AccountSession[]; accounts: LinkedAccount[]; invitations: InviteInfo[] };

const fail = (e: unknown): Result => ({ ok: false, status: 400, error: e instanceof APIError ? (e.body?.message ?? e.message) : e instanceof Error ? e.message : String(e) });

async function me(db: DB, h: Headers) {
  const s = await getAuth(db).api.getSession({ headers: h });
  return s?.user.emailVerified ? s : null;
}
const NOT_SIGNED_IN: Result = { ok: false, status: 403, error: 'Not signed in.' };

/** Everything the account page shows, or null when nobody (verified) is signed in. */
export async function accountInfo(db: DB, h: Headers): Promise<AccountInfo | null> {
  const s = await me(db, h);
  if (!s) return null;
  const [sessions, accounts, invitations] = await Promise.all([
    db.select({ id: authSession.id, userAgent: authSession.userAgent, ipAddress: authSession.ipAddress, createdAt: authSession.createdAt, updatedAt: authSession.updatedAt })
      .from(authSession).where(and(eq(authSession.userId, s.user.id), gt(authSession.expiresAt, new Date()))).orderBy(authSession.updatedAt).all(),
    db.select({ id: authAccount.id, providerId: authAccount.providerId, createdAt: authAccount.createdAt, password: authAccount.password }).from(authAccount).where(eq(authAccount.userId, s.user.id)).all(),
    invitesFor(db, s.user.email),
  ]);
  return {
    name: s.user.name, email: s.user.email,
    hasPassword: accounts.some((a) => a.providerId === 'credential' && !!a.password),
    sessions: sessions.reverse().map((x) => ({ ...x, current: x.id === s.session.id, createdAt: x.createdAt.toISOString(), updatedAt: x.updatedAt.toISOString() })),
    accounts: accounts.map((a) => ({ id: a.id, providerId: a.providerId, createdAt: a.createdAt.toISOString(), usable: usable(a) })),
    invitations,
  };
}

/** Changes the display name. */
export async function changeName(db: DB, h: Headers, raw: unknown): Promise<Result> {
  const name = String(raw ?? '').trim();
  if (!name || name.length > 100) return { ok: false, status: 400, error: 'A name is 1–100 characters.' };
  if (!(await me(db, h))) return NOT_SIGNED_IN;
  try { await getAuth(db).api.updateUser({ headers: h, body: { name } }); return { ok: true }; } catch (e) { return fail(e); }
}

const pwLength = (pw: string): Result | null => (pw.length < MIN_PASSWORD || pw.length > 128 ? { ok: false, status: 400, error: `A password must be ${MIN_PASSWORD}–128 characters.` } : null);

/** Changes the password (the current one is needed) and signs out every other session. */
export async function changePassword(db: DB, h: Headers, current: unknown, next: unknown): Promise<Result> {
  const pw = String(next ?? '');
  const bad = pwLength(pw);
  if (bad) return bad;
  if (!(await me(db, h))) return NOT_SIGNED_IN;
  try {
    await getAuth(db).api.changePassword({ headers: h, body: { currentPassword: String(current ?? ''), newPassword: pw, revokeOtherSessions: true } });
    return { ok: true };
  } catch (e) {
    const r = fail(e);
    return !r.ok && /invalid password/i.test(r.error) ? { ok: false, status: 400, error: 'Your current password is wrong.' } : r;
  }
}

/** Adds a password to an account that signs in another way (Google, GitHub) and has none. */
export async function addPassword(db: DB, h: Headers, next: unknown): Promise<Result> {
  const pw = String(next ?? '');
  const bad = pwLength(pw);
  if (bad) return bad;
  if (!(await me(db, h))) return NOT_SIGNED_IN;
  try { await getAuth(db).api.setPassword({ headers: h, body: { newPassword: pw } }); return { ok: true }; } catch (e) { return fail(e); }
}

/** Signs out one of your other sessions (sign out of this one with Sign out). */
export async function revokeSession(db: DB, h: Headers, id: unknown): Promise<Result> {
  const s = await me(db, h);
  if (!s) return NOT_SIGNED_IN;
  if (String(id) === s.session.id) return { ok: false, status: 409, error: 'That is this session: use Sign out.' };
  const row = await db.select({ token: authSession.token }).from(authSession).where(and(eq(authSession.id, String(id ?? '')), eq(authSession.userId, s.user.id))).get();
  if (!row) return { ok: false, status: 404, error: 'That session has already ended.' };
  try { await getAuth(db).api.revokeSession({ headers: h, body: { token: row.token } }); return { ok: true }; } catch (e) { return fail(e); }
}

/** Signs out every session but this one. */
export async function revokeOtherSessions(db: DB, h: Headers): Promise<Result> {
  if (!(await me(db, h))) return NOT_SIGNED_IN;
  try { await getAuth(db).api.revokeOtherSessions({ headers: h }); return { ok: true }; } catch (e) { return fail(e); }
}

/**
 * Whether a linked method can sign anyone in now: a password that is set, or a provider whose keys this server has
 * (one whose keys were removed can't, so it isn't a way back in).
 */
const usable = (a: { providerId: string; password?: string | null }) =>
  a.providerId === 'credential' ? !!a.password : (configuredProviders() as string[]).includes(a.providerId);

/**
 * Removes a way of signing in (a password, Google, GitHub). Never the last one: you'd have no way back in. (Passkeys
 * aren't counted: a lost device would lock you out.)
 */
export async function unlinkAccount(db: DB, h: Headers, id: unknown): Promise<Result> {
  const s = await me(db, h);
  if (!s) return NOT_SIGNED_IN;
  const accounts = await db.select({ id: authAccount.id, providerId: authAccount.providerId, password: authAccount.password }).from(authAccount).where(eq(authAccount.userId, s.user.id)).all();
  const target = accounts.find((a) => a.id === String(id ?? ''));
  if (!target) return { ok: false, status: 404, error: "That sign-in method isn't linked to your account." };
  const others = accounts.filter((a) => a.id !== target.id && usable(a));
  if (!others.length) return { ok: false, status: 409, error: "That's your only way to sign in. Add another first." };
  try {
    await getAuth(db).api.unlinkAccount({ headers: h, body: { accountId: target.id } });
    return { ok: true };
  } catch (e) {
    const r = fail(e);
    return !r.ok && /fresh/i.test(r.error) ? { ok: false, status: 403, error: 'For safety, sign out and in again (within a day) before removing a sign-in method.' } : r;
  }
}
