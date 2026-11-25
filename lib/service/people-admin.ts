// Settings → People for admins (#102): ban, delete, sessions, two-factor reset, and who may be impersonated.
//
// Plain database work on Better Auth's tables, so it needs no Better Auth instance (no BETTER_AUTH_SECRET) and works in
// every AUTH_MODE: in the proxy modes people have no sessions, but a ban or a deletion still applies (resolveAccess
// reads the ban). The same rules guard Better Auth's own /admin/* endpoints (lib/better-auth.ts, hooks.before):
//
// - Only admins (Brickfolio's: ADMIN_USERS, user.role, or everyone in a proxy mode without ADMIN_USERS).
// - Nobody bans, deletes or impersonates themselves, or an admin listed in ADMIN_USERS.
// - Nobody acting as someone else (impersonating) does any of it: they have that person's rights, not an admin's.
// - Only people who could sign in themselves are impersonated, and never an admin (as Better Auth's admin plugin).
//
// D1: no interactive transactions, so each statement here is safe on its own (a deletion that stops halfway leaves
// a person with fewer rows, never someone else's).
import { and, desc, eq, gt } from 'drizzle-orm';
import type { DB } from '../db/types';
import { apiTokens, authAccount, authApiKey, authInvitation, authMember, authPasskey, authSession, authTwoFactor, authUser } from '../db/schema';
import { allowed } from '../auth';
import type { Result } from './sets';
import { adminList, banActive, denied, ensureUser, everyoneAdmin, normLogin, type Access } from './permissions';

type Env = Record<string, string | undefined>;
export type AdminAct = 'ban' | 'delete' | 'impersonate';
/** A refused request, as a Result. */
export type Refusal = { ok: false; status: 400 | 403 | 404 | 409; error: string };
const VERB: Record<AdminAct, string> = { ban: 'ban', delete: 'delete', impersonate: 'act as' };

/** A Better Auth session, for the Sessions tab. Never its token: the id is enough to end it. */
export type SessionRow = { id: string; userAgent: string | null; ip: string | null; createdAt: string; updatedAt: string; expiresAt: string; impersonated: boolean; current: boolean };

const person = (db: DB, login: string) =>
  db.select({ id: authUser.id, email: authUser.email, role: authUser.role, emailVerified: authUser.emailVerified, banned: authUser.banned, banExpires: authUser.banExpires })
    .from(authUser).where(eq(authUser.email, login)).get();

const notFound = (login: string): Refusal => ({ ok: false, status: 404, error: `${login} isn't in People.` });
const hasAdminRole = (role: string | null | undefined) => !!role && role.split(',').map((r) => r.trim()).includes('admin');

/**
 * Why `actor` may not ban, delete or impersonate `raw`, or null when they may. Shared by the server actions and the
 * /admin/* gate, so calling Better Auth's endpoints directly can't get around it.
 */
export async function refusal(db: DB, actor: Access, raw: unknown, what: AdminAct, env: Env = process.env): Promise<Refusal | null> {
  const login = normLogin(raw);
  const a = adminRefusal(actor);
  if (a) return a;
  if (!login) return { ok: false, status: 400, error: 'Which person?' };
  if (login === actor.login) return { ok: false, status: 409, error: `You can't ${VERB[what]} yourself.` };
  if (everyoneAdmin(env) || adminList(env).includes(login)) return { ok: false, status: 409, error: `${login} is an admin through ADMIN_USERS, so you can't ${VERB[what]} them here.` };
  if (what !== 'impersonate') return null;
  const u = await person(db, login);
  if (!u) return notFound(login);
  if (hasAdminRole(u.role)) return { ok: false, status: 409, error: `${login} is an admin. Admins can't be acted as.` };
  if (banActive(u)) return { ok: false, status: 409, error: `${login} is banned. Unban them first.` };
  if (!u.emailVerified || !allowed(login)) return { ok: false, status: 409, error: `${login} can't sign in yet (no verified address, or not in ALLOWED_USERS), so there's nothing to see.` };
  return null;
}

/** Refusal unless `actor` is an admin who isn't acting as someone else, or null. */
export function adminRefusal(actor: Access): Refusal | null {
  if (actor.impersonated) return { ok: false, status: 403, error: "You're acting as someone else. Stop first." };
  return actor.admin ? null : { ok: false, status: 403, error: denied('admin') };
}

const MAX_REASON = 200;
const MAX_DAYS = 3650;

/**
 * Bans someone: until `until` (null: until unbanned), with a reason they're shown nowhere (admins see it). Their
 * sessions end at once, and sign-in by any method is refused until it ends (Better Auth's admin plugin checks every
 * new session; lib/better-auth.ts checks too). In the proxy modes resolveAccess gives them no rights.
 */
export async function banPerson(db: DB, actor: Access, raw: unknown, opts: { reason?: unknown; until?: Date | null }, env: Env = process.env, now = new Date()): Promise<Result> {
  const r = await refusal(db, actor, raw, 'ban', env);
  if (r) return r;
  const login = normLogin(raw);
  const until = opts.until ?? null;
  if (until && (Number.isNaN(until.getTime()) || until.getTime() <= now.getTime())) return { ok: false, status: 400, error: 'The ban has to end in the future.' };
  if (until && until.getTime() - now.getTime() > MAX_DAYS * 86_400_000) return { ok: false, status: 400, error: `A ban with an end date can last at most ${MAX_DAYS} days. Choose "never" instead.` };
  const reason = String(opts.reason ?? '').trim().slice(0, MAX_REASON) || null;
  const id = await ensureUser(db, login);
  await db.update(authUser).set({ banned: true, banReason: reason, banExpires: until, updatedAt: now }).where(eq(authUser.id, id));
  await db.delete(authSession).where(eq(authSession.userId, id));
  return { ok: true };
}

export async function unbanPerson(db: DB, actor: Access, raw: unknown): Promise<Result> {
  const a = adminRefusal(actor);
  if (a) return a;
  const u = await person(db, normLogin(raw));
  if (!u) return notFound(normLogin(raw));
  await db.update(authUser).set({ banned: false, banReason: null, banExpires: null, updatedAt: new Date() }).where(eq(authUser.id, u.id));
  return { ok: true };
}

/**
 * What goes with a person besides what Better Auth's remove-user deletes (their sessions, accounts and user row):
 * their collection roles, invitations to their address and the ones they sent, API keys (and old api_tokens rows,
 * so a rollback can't bring them back), passkeys and two-factor. Also run before Better Auth deletes a user.
 */
export async function cleanupPerson(db: DB, userId: string, email: string) {
  await db.delete(authApiKey).where(eq(authApiKey.referenceId, userId));
  await db.delete(apiTokens).where(eq(apiTokens.owner, email));
  await db.delete(authMember).where(eq(authMember.userId, userId));
  await db.delete(authInvitation).where(eq(authInvitation.email, email));
  await db.delete(authInvitation).where(eq(authInvitation.inviterId, userId));
  await db.delete(authPasskey).where(eq(authPasskey.userId, userId));
  await db.delete(authTwoFactor).where(eq(authTwoFactor.userId, userId));
}

/**
 * Deletes someone and everything that gives them access. In a proxy mode a deleted login that the proxy still lets
 * in comes back as a new person with no roles on their next visit: ban them, or take them out of ALLOWED_USERS.
 */
export async function deletePerson(db: DB, actor: Access, raw: unknown, env: Env = process.env): Promise<Result> {
  const r = await refusal(db, actor, raw, 'delete', env);
  if (r) return r;
  const login = normLogin(raw);
  const u = await person(db, login);
  if (!u) return notFound(login);
  await db.delete(authSession).where(eq(authSession.userId, u.id));
  await cleanupPerson(db, u.id, u.email);
  await db.delete(authAccount).where(eq(authAccount.userId, u.id));
  await db.delete(authUser).where(eq(authUser.id, u.id));
  return { ok: true };
}

/** Someone's sessions that haven't expired, most recently active first. `current`: the caller's own session id. */
export async function listSessions(db: DB, raw: unknown, current?: string | null, now = new Date()): Promise<SessionRow[]> {
  const u = await person(db, normLogin(raw));
  if (!u) return [];
  const rows = await db.select().from(authSession).where(and(eq(authSession.userId, u.id), gt(authSession.expiresAt, now))).orderBy(desc(authSession.updatedAt)).all();
  return rows.map((s) => ({
    id: s.id, userAgent: s.userAgent || null, ip: s.ipAddress || null, createdAt: s.createdAt.toISOString(), updatedAt: s.updatedAt.toISOString(),
    expiresAt: s.expiresAt.toISOString(), impersonated: !!s.impersonatedBy, current: !!current && s.id === current,
  }));
}

/** Ends one of someone's sessions (`id` from listSessions), or all of them (`id` undefined). */
export async function endSessions(db: DB, raw: unknown, id?: string): Promise<Result> {
  const login = normLogin(raw);
  const u = await person(db, login);
  if (!u) return notFound(login);
  if (id === undefined) await db.delete(authSession).where(eq(authSession.userId, u.id));
  else if (!(await db.delete(authSession).where(and(eq(authSession.userId, u.id), eq(authSession.id, String(id)))).returning({ id: authSession.id }).all()).length) return { ok: false, status: 404, error: 'That session has already ended.' };
  return { ok: true };
}

/**
 * Turns someone's two-factor off (they lost their phone and their backup codes) and signs them out everywhere. They
 * sign in with their password alone and can set it up again under Account.
 */
export async function resetTwoFactor(db: DB, raw: unknown): Promise<Result> {
  const login = normLogin(raw);
  const u = await person(db, login);
  if (!u) return notFound(login);
  await db.update(authUser).set({ twoFactorEnabled: false, updatedAt: new Date() }).where(eq(authUser.id, u.id));
  await db.delete(authTwoFactor).where(eq(authTwoFactor.userId, u.id));
  await db.delete(authSession).where(eq(authSession.userId, u.id));
  return { ok: true };
}
