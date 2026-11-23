// Users and per-collection permissions (#50). Identity still comes only from the proxy (Tailscale, Cloudflare Access)
// or an API token (lib/auth.ts); this decides what that identity may see and do.
//
// - Admins can do everything: Settings, sync, keys, locations, collections, people, and all data. ADMIN_USERS lists
//   them; when it's unset, everyone allowed in is an admin, which is how Brickfolio worked before (nothing changes for
//   an upgraded install; not with AUTH_MODE=better-auth). Better Auth's `user.role = 'admin'` adds admins on top. The scheduler (cron), AUTH_MODE=none (`local`) and API
//   tokens from before #50 (no owner) are admins.
// - Everyone else sees only the collections they have a role in: viewer (read), editor (add, change, remove items),
//   owner (also its members and share links). Shared data (wishlist, Designer projects, layouts, loose parts, builds,
//   barcodes) is readable by any member and changeable by admins and anyone who is an editor or owner somewhere.
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { DB } from '../db/types';
import { authAccount, authInvitation, authMember, authOrganization, authUser, collections, ROLES, setCopies, sets } from '../db/schema';
import { roles as acRoles } from '../auth-ac';
import type { Identity } from '../auth';
import type { Result } from './sets';

// #90: people, admins and roles live in Better Auth's tables in every AUTH_MODE: a login is `user.email`, an admin is
// `user.role = 'admin'` (admin plugin), a collection is the organization `col_<id>` and a role is `member.role` there.
// What a role allows comes from Better Auth access control (lib/auth-ac.ts). Reads use one query across all of a
// person's organizations, so there's no "active organization": "All collections" works as before.

export type Role = (typeof ROLES)[number];
export type Access = { login: string; admin: boolean; roles: Map<number, Role> };
/**
 * What an action needs: `member` = any role (or admin); `shared` = change shared data (admin, or editor/owner of any
 * collection); `admin`; or read/write/manage on one collection.
 */
export type Need = 'member' | 'shared' | 'admin' | { action: 'read' | 'write' | 'manage'; collectionId: number };

export const normLogin = (s: unknown) => String(s ?? '').trim().toLowerCase();
type Env = Record<string, string | undefined>;

/** ADMIN_USERS, lowercased; empty means "everyone allowed in is an admin" (proxy modes only, see isAdmin). */
export const adminList = (env: Env = process.env) =>
  (env.ADMIN_USERS || '').split(',').map(normLogin).filter(Boolean);

/** With Better Auth accounts, an unset ADMIN_USERS doesn't make everyone an admin: the first account is one. */
const everyoneAdmin = (env: Env) => !adminList(env).length && env.AUTH_MODE !== 'better-auth';

/** Everything allowed: the scheduler, AUTH_MODE=none, and pre-#50 API tokens. */
const everything = (login: string): Access => ({ login, admin: true, roles: new Map() });

/** The Better Auth organization standing for a collection. */
export const orgId = (collectionId: number) => `col_${collectionId}`;

const hasAdminRole = (role: string | null | undefined) => !!role && role.split(',').map((r) => r.trim()).includes('admin');

/** Whether a login is an admin: ADMIN_USERS (or everyone when it's unset, outside better-auth), or `user.role`. */
async function isAdmin(db: DB, login: string, env: Env): Promise<boolean> {
  if (everyoneAdmin(env) || adminList(env).includes(login)) return true;
  return hasAdminRole((await db.select({ r: authUser.role }).from(authUser).where(eq(authUser.email, login)).get())?.r);
}

/** The Better Auth user for a login, created (no password, role `user`) when there's none yet. */
export async function ensureUser(db: DB, login: string, set: { lastSeenAt?: string; role?: string } = {}): Promise<string> {
  const now = new Date();
  await db.insert(authUser).values({ id: crypto.randomUUID(), name: login, email: login, emailVerified: false, createdAt: now, updatedAt: now, role: 'user', ...set })
    .onConflictDoUpdate({ target: authUser.email, set: Object.keys(set).length ? set : { email: login } });
  return (await db.select({ id: authUser.id }).from(authUser).where(eq(authUser.email, login)).get())!.id;
}

/**
 * The most members a collection can have. D1 allows 100 bound parameters per query and Better Auth lists an
 * organization's members' users with one `IN (…)`, so this stays under it (it's also the organization plugin's
 * `membershipLimit`).
 */
export const MEMBERSHIP_LIMIT = 90;
/** How many ids go in one `IN (…)` here (D1: 100 parameters per query, with room for the others). */
export const IN_CHUNK = 90;

/** `ids` in pieces of at most IN_CHUNK. */
export function chunks<T>(ids: T[], size = IN_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}

/** The organization for a collection, made with the collection (or the first time someone gets a role in it). */
async function ensureOrg(db: DB, collectionId: number, name: string) {
  await db.insert(authOrganization).values({ id: orgId(collectionId), name, slug: `collection-${collectionId}`, createdAt: new Date(), collectionId }).onConflictDoNothing();
}

/** Keeps a collection's organization in step with it: made if missing, renamed with it. */
export async function syncOrg(db: DB, collectionId: number, name: string) {
  await ensureOrg(db, collectionId, name);
  await db.update(authOrganization).set({ name }).where(eq(authOrganization.id, orgId(collectionId)));
}

/**
 * Makes `userId` an admin when nobody else is one: the first account (#90). One statement, so two sign-ups at the
 * same moment can't both win. Returns whether it did.
 */
export async function claimFirstAdmin(db: DB, userId: string): Promise<boolean> {
  const r = await db.update(authUser).set({ role: 'admin' }).where(and(eq(authUser.id, userId), sql`not exists (select 1 from ${authUser} as other where other.id <> ${userId} and (',' || replace(coalesce(other.role, ''), ' ', '') || ',') like '%,admin,%')`)).returning({ id: authUser.id }).all();
  return r.length > 0;
}

/** A login's roles in every collection (one query over all their organizations). */
async function rolesOf(db: DB, login: string, collectionId?: number): Promise<{ c: number; r: Role }[]> {
  const where = collectionId === undefined ? eq(authUser.email, login) : and(eq(authUser.email, login), eq(authOrganization.collectionId, collectionId));
  const rows = await db.select({ c: authOrganization.collectionId, r: authMember.role }).from(authMember)
    .innerJoin(authOrganization, eq(authOrganization.id, authMember.organizationId))
    .innerJoin(authUser, eq(authUser.id, authMember.userId)).where(where).all();
  return rows.filter((x): x is { c: number; r: Role } => (ROLES as readonly string[]).includes(x.r));
}

const SEEN_EVERY_MS = 60_000;
const seenAt = new Map<string, number>();

/** Records a login as seen (at most once a minute per process), creating the user the first time. */
async function touch(db: DB, login: string, now = Date.now()) {
  if ((seenAt.get(login) ?? 0) > now - SEEN_EVERY_MS) return;
  seenAt.set(login, now);
  await ensureUser(db, login, { lastSeenAt: new Date(now).toISOString() });
}

/** What an identity may do. Creates or touches its Better Auth user. */
export async function resolveAccess(db: DB, id: Identity, env: Env = process.env): Promise<Access> {
  if (id.via === 'cron' || id.via === 'none') return everything(normLogin(id.user));
  // Tokens from before #50 (no owner) and ones made without a login (AUTH_MODE=none) act as admin.
  if (id.via === 'token' && (!id.owner || id.owner === 'local')) return everything(normLogin(id.user));
  const login = normLogin(id.via === 'token' ? id.owner : id.user);
  if (id.via !== 'token') await touch(db, login);
  return accessOf(db, login, env);
}

/** What a login may do now, without counting it as a visit (e.g. the person who sent an invitation, when it's accepted). */
export async function accessOf(db: DB, raw: string, env: Env = process.env): Promise<Access> {
  const login = normLogin(raw);
  if (await isAdmin(db, login, env)) return { login, admin: true, roles: new Map() };
  return { login, admin: false, roles: new Map((await rolesOf(db, login)).map((r) => [r.c, r.r])) };
}

/**
 * Whether the person who made a share link may still make it (#50): an admin, or an owner of its collection. Links
 * from before #50 (no maker) and from AUTH_MODE=none ('local') always may. Checked on every view, so taking away
 * someone's role turns their links off too.
 */
export async function stillShares(db: DB, createdBy: string | null, collectionId: number | null, env: Env = process.env): Promise<boolean> {
  if (!createdBy || createdBy === 'local') return true;
  const login = normLogin(createdBy);
  if (await isAdmin(db, login, env)) return true;
  if (collectionId == null) return false;
  return (await rolesOf(db, login, collectionId)).some((r) => allows(r.r, { collection: ['manage'] }));
}

/** Better Auth access control: whether a role's statements allow `request`. */
const allows = (role: Role, request: Parameters<(typeof acRoles)['owner']['authorize']>[0]) => !!acRoles[role]?.authorize(request).success;

/** Whether `a` may do `need`. */
export function can(a: Access, need: Need): boolean {
  if (a.admin) return true;
  if (need === 'admin') return false;
  // Across collections (Brickfolio's, not Better Auth's): any role / a role that may change shared lists, somewhere.
  if (need === 'member') return [...a.roles.values()].some((r) => allows(r, { collection: ['read'] }));
  if (need === 'shared') return [...a.roles.values()].some((r) => allows(r, { shared: ['write'] }));
  const r = a.roles.get(need.collectionId);
  return !!r && allows(r, { collection: [need.action] });
}

const WHAT: Record<string, string> = {
  member: 'see this', shared: 'change shared lists (wishlist, layouts, loose parts, builds)', admin: 'change this (admins only)',
  read: 'see that collection', write: 'change that collection', manage: 'manage that collection',
};
/** The refusal for `need`, in the same words everywhere. */
export const denied = (need: Need) => `You don't have permission to ${WHAT[typeof need === 'string' ? need : need.action]}.`;

/** `need`, as a Result: ok, or a 403 with the reason. */
export function check(a: Access, need: Need): Result {
  return can(a, need) ? { ok: true } : { ok: false, status: 403, error: denied(need) };
}

/** The collections `a` can read: 'all' for admins, else their ids. */
export const readable = (a: Access): 'all' | number[] => (a.admin ? 'all' : [...a.roles.keys()]);

/** The collections `a` can add to and change. */
export const writable = (a: Access): 'all' | number[] => (a.admin ? 'all' : [...a.roles].filter(([, r]) => allows(r, { collection: ['write'] })).map(([c]) => c));

/**
 * A requested scope cut down to what `a` may read: admins get what they asked; for anyone else "all" means all of
 * *their* collections, and a collection they can't read is null (refuse it).
 */
export function clampScope(a: Access, scope: number | 'all'): number | number[] | 'all' | null {
  if (a.admin) return scope;
  if (scope === 'all') return [...a.roles.keys()];
  return a.roles.has(scope) ? scope : null;
}

// ---- people (Settings → People) ----

export type Person = { login: string; name: string | null; admin: boolean; fromEnv: boolean; lastSeenAt: string | null; /** Has a Better Auth password (#90). */ password: boolean; roles: { collectionId: number; role: Role }[] };

/** Everyone seen or added, with their roles. Admins from ADMIN_USERS are marked `fromEnv` (they can't be demoted here). */
export async function listPeople(db: DB, env: Env = process.env): Promise<Person[]> {
  const list = adminList(env);
  const rows = await db.select({ login: authUser.email, name: authUser.name, role: authUser.role, lastSeenAt: authUser.lastSeenAt }).from(authUser).orderBy(authUser.email).all();
  const members = await allMembers(db);
  const withPassword = new Set((await db.select({ login: authUser.email }).from(authAccount).innerJoin(authUser, eq(authUser.id, authAccount.userId)).where(eq(authAccount.providerId, 'credential')).all()).map((r) => r.login));
  const logins = new Set([...rows.map((r) => r.login), ...members.map((m) => m.login), ...list]);
  return [...logins].sort().map((login) => {
    const u = rows.find((r) => r.login === login);
    const fromEnv = everyoneAdmin(env) || list.includes(login);
    return {
      login, name: u && u.name !== login ? u.name : null, admin: fromEnv || hasAdminRole(u?.role), fromEnv, lastSeenAt: u?.lastSeenAt ?? null, password: withPassword.has(login),
      roles: members.filter((m) => m.login === login).map((m) => ({ collectionId: m.collectionId, role: m.role })),
    };
  });
}

/** Every membership, as login + collection + role. */
async function allMembers(db: DB, ids?: number[]): Promise<{ collectionId: number; login: string; role: Role }[]> {
  const q = () => db.select({ collectionId: authOrganization.collectionId, login: authUser.email, role: authMember.role }).from(authMember)
    .innerJoin(authOrganization, eq(authOrganization.id, authMember.organizationId))
    .innerJoin(authUser, eq(authUser.id, authMember.userId));
  let rows: { collectionId: number; login: string; role: string }[];
  if (!ids) rows = await q().orderBy(authUser.email).all();
  else {
    rows = [];
    for (const c of chunks(ids)) rows.push(...(await q().where(inArray(authOrganization.collectionId, c)).all()));
    rows.sort((a, b) => (a.login < b.login ? -1 : a.login > b.login ? 1 : 0));
  }
  return rows.filter((x): x is { collectionId: number; login: string; role: Role } => (ROLES as readonly string[]).includes(x.role));
}

const LOGIN = /^[^\s,]{1,200}$/;

/** Adds a login before its first visit (a Tailscale login, Access email, or the email of a Better Auth account). */
export async function addPerson(db: DB, raw: unknown): Promise<Result> {
  const login = normLogin(raw);
  if (!LOGIN.test(login) || login === 'local' || login === 'cron' || login.startsWith('token:')) return { ok: false, status: 400, error: 'Enter their Tailscale login or Access email.' };
  await ensureUser(db, login);
  return { ok: true };
}

/** Makes a login an admin or not. Admins from ADMIN_USERS stay admins; you can't take away your own admin. */
export async function setAdmin(db: DB, actor: Access, raw: unknown, admin: boolean, env: Env = process.env): Promise<Result> {
  const login = normLogin(raw);
  if (!login) return { ok: false, status: 400, error: 'Which login?' };
  if (!admin && login === actor.login) return { ok: false, status: 409, error: "You can't remove your own admin." };
  if (!admin && (everyoneAdmin(env) || adminList(env).includes(login))) return { ok: false, status: 409, error: `${login} is an admin through ADMIN_USERS. Change it in the server's settings.` };
  await ensureUser(db, login, { role: admin ? 'admin' : 'user' });
  return { ok: true };
}

/** Gives a login a role in a collection, or takes it away (`role` null). Admins can, and that collection's owners. */
export async function setRole(db: DB, actor: Access, collectionId: number, raw: unknown, role: Role | null): Promise<Result> {
  const login = normLogin(raw);
  if (!login || !LOGIN.test(login)) return { ok: false, status: 400, error: 'Enter their Tailscale login or Access email.' };
  if (role !== null && !ROLES.includes(role)) return { ok: false, status: 400, error: `Role must be one of: ${ROLES.join(', ')}.` };
  const col = await db.select({ id: collections.id, name: collections.name }).from(collections).where(eq(collections.id, collectionId)).get();
  if (!col) return { ok: false, status: 404, error: `Collection ${collectionId} doesn't exist.` };
  const c = check(actor, { action: 'manage', collectionId });
  if (!c.ok) return c;
  // An owner who isn't an admin can't lock themselves out of managing it.
  if (!actor.admin && login === actor.login && role !== 'owner') return { ok: false, status: 409, error: "You can't change your own role here. Ask an admin." };
  const userId = await ensureUser(db, login);
  if (role === null) {
    await db.delete(authMember).where(and(eq(authMember.organizationId, orgId(collectionId)), eq(authMember.userId, userId)));
    return { ok: true };
  }
  await ensureOrg(db, collectionId, col.name);
  const has = await db.select({ id: authMember.id }).from(authMember).where(and(eq(authMember.organizationId, orgId(collectionId)), eq(authMember.userId, userId))).get();
  if (!has) {
    const [{ n }] = await db.select({ n: sql<number>`count(*)` }).from(authMember).where(eq(authMember.organizationId, orgId(collectionId))).all();
    if (Number(n) >= MEMBERSHIP_LIMIT) return { ok: false, status: 409, error: `${col.name} already has ${MEMBERSHIP_LIMIT} members, the most a collection can have.` };
  }
  await db.insert(authMember).values({ id: crypto.randomUUID(), organizationId: orgId(collectionId), userId, role, createdAt: new Date() })
    .onConflictDoUpdate({ target: [authMember.organizationId, authMember.userId], set: { role } });
  return { ok: true };
}

/** Members of the given collections, for owners managing them. */
export async function membersOf(db: DB, ids: number[]): Promise<{ collectionId: number; login: string; role: Role }[]> {
  return ids.length ? allMembers(db, ids) : [];
}

/** Removes every membership and invitation of a deleted collection, and its organization. */
export async function dropMembers(db: DB, collectionId: number) {
  await db.delete(authInvitation).where(eq(authInvitation.organizationId, orgId(collectionId)));
  await db.delete(authMember).where(eq(authMember.organizationId, orgId(collectionId)));
  await db.delete(authOrganization).where(eq(authOrganization.id, orgId(collectionId)));
}

/** How many people are signed up (for Settings: whether permissions are in use at all). */
export async function peopleCount(db: DB): Promise<number> {
  return Number((await db.select({ n: sql<number>`count(*)` }).from(authUser).all())[0].n);
}

// ---- what an item belongs to ----

/** The collections a set has copies in (an unknown set has none). */
export async function setCollections(db: DB, setNo: string): Promise<number[]> {
  const rows = await db.selectDistinct({ c: setCopies.collectionId }).from(setCopies).innerJoin(sets, eq(sets.id, setCopies.setId)).where(eq(sets.setNo, setNo)).all();
  return rows.map((r) => r.c ?? 1);
}

/** Whether `a` can see a set: any of its copies in a collection they can read. */
export const canReadSet = (a: Access, cols: number[]) => a.admin || cols.some((c) => a.roles.has(c));
/** Whether `a` can change every copy of a set (set-wide edits: name, notes, removing copies). */
export const canWriteAll = (a: Access, cols: number[]) => a.admin || (cols.length > 0 && cols.every((c) => can(a, { action: 'write', collectionId: c })));
/** Whether `a` can change at least one copy (price lookups, parts lists, 3D model: set facts, not copies). */
export const canWriteAny = (a: Access, cols: number[]) => a.admin || cols.some((c) => can(a, { action: 'write', collectionId: c }));

/** The collection a copy is in, or null when there's no such copy (or it isn't a copy of `setNo`, when given). */
export async function copyCollection(db: DB, copyId: number, setNo?: string): Promise<number | null> {
  const r = await db.select({ c: setCopies.collectionId, no: sets.setNo }).from(setCopies).innerJoin(sets, eq(sets.id, setCopies.setId)).where(eq(setCopies.id, copyId)).get();
  if (!r || (setNo !== undefined && r.no !== setNo)) return null;
  return r.c ?? 1;
}

/** Refusal for a set-wide change `a` can't make, or null when allowed. */
export function setRefusal(a: Access, cols: number[], all: boolean): Result | null {
  // No copies: an unknown set (the service answers 404 to admins), or one only an admin can see.
  if (!cols.length) return a.admin ? null : { ok: false, status: 404, error: 'Not found.' };
  if (all ? canWriteAll(a, cols) : canWriteAny(a, cols)) return null;
  return { ok: false, status: 403, error: canReadSet(a, cols) ? (all ? "You don't have permission to change this set: some of its copies are in collections you can't change." : denied({ action: 'write', collectionId: cols[0] })) : 'Not found.' };
}

/** Who may create or revoke a share link: admins for links showing every collection, owners for one collection's. */
export const shareNeed = (collectionId: number | null | undefined): Need => (collectionId == null ? 'admin' : { action: 'manage', collectionId });
