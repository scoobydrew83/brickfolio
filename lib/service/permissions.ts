// Users and per-collection permissions (#50). Identity still comes only from the proxy (Tailscale, Cloudflare Access)
// or an API token (lib/auth.ts); this decides what that identity may see and do.
//
// - Admins can do everything: Settings, sync, keys, locations, collections, people, and all data. ADMIN_USERS lists
//   them; when it's unset, everyone allowed in is an admin, which is how Brickfolio worked before (nothing changes for
//   an upgraded install). `users.admin` adds admins on top. The scheduler (cron), AUTH_MODE=none (`local`) and API
//   tokens from before #50 (no owner) are admins.
// - Everyone else sees only the collections they have a role in: viewer (read), editor (add, change, remove items),
//   owner (also its members and share links). Shared data (wishlist, Designer projects, layouts, loose parts, builds,
//   barcodes) is readable by any member and changeable by admins and anyone who is an editor or owner somewhere.
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { DB } from '../db/types';
import { collectionMembers, collections, ROLES, setCopies, sets, users } from '../db/schema';
import type { Identity } from '../auth';
import type { Result } from './sets';

export type Role = (typeof ROLES)[number];
export type Access = { login: string; admin: boolean; roles: Map<number, Role> };
/**
 * What an action needs: `member` = any role (or admin); `shared` = change shared data (admin, or editor/owner of any
 * collection); `admin`; or read/write/manage on one collection.
 */
export type Need = 'member' | 'shared' | 'admin' | { action: 'read' | 'write' | 'manage'; collectionId: number };

const RANK: Record<Role, number> = { viewer: 0, editor: 1, owner: 2 };
export const normLogin = (s: unknown) => String(s ?? '').trim().toLowerCase();

/** ADMIN_USERS, lowercased; empty means "everyone allowed in is an admin". */
export const adminList = (env: Record<string, string | undefined> = process.env) =>
  (env.ADMIN_USERS || '').split(',').map(normLogin).filter(Boolean);

/** Everything allowed: the scheduler, AUTH_MODE=none, and pre-#50 API tokens. */
const everything = (login: string): Access => ({ login, admin: true, roles: new Map() });

/** Whether a login is an admin: ADMIN_USERS (or everyone when it's unset), or `users.admin`. */
async function isAdmin(db: DB, login: string, env: Record<string, string | undefined>): Promise<boolean> {
  const list = adminList(env);
  if (!list.length || list.includes(login)) return true;
  return !!(await db.select({ a: users.admin }).from(users).where(eq(users.login, login)).get())?.a;
}

const SEEN_EVERY_MS = 60_000;
const seenAt = new Map<string, number>();

/** Records a login as seen (at most once a minute per process), creating the user the first time. */
async function touch(db: DB, login: string, now = Date.now()) {
  if ((seenAt.get(login) ?? 0) > now - SEEN_EVERY_MS) return;
  seenAt.set(login, now);
  const t = new Date(now).toISOString();
  await db.insert(users).values({ login, lastSeenAt: t }).onConflictDoUpdate({ target: users.login, set: { lastSeenAt: t } });
}

/** What an identity may do. Creates or touches its `users` row. */
export async function resolveAccess(db: DB, id: Identity, env: Record<string, string | undefined> = process.env): Promise<Access> {
  if (id.via === 'cron' || id.via === 'none') return everything(normLogin(id.user));
  // Tokens from before #50 (no owner) and ones made without a login (AUTH_MODE=none) act as admin.
  if (id.via === 'token' && (!id.owner || id.owner === 'local')) return everything(normLogin(id.user));
  const login = normLogin(id.via === 'token' ? id.owner : id.user);
  if (id.via !== 'token') await touch(db, login);
  if (await isAdmin(db, login, env)) return { login, admin: true, roles: new Map() };
  const rows = await db.select({ c: collectionMembers.collectionId, r: collectionMembers.role }).from(collectionMembers).where(eq(collectionMembers.login, login)).all();
  return { login, admin: false, roles: new Map(rows.map((r) => [r.c, r.r])) };
}

/**
 * Whether the person who made a share link may still make it (#50): an admin, or an owner of its collection. Links
 * from before #50 (no maker) and from AUTH_MODE=none ('local') always may. Checked on every view, so taking away
 * someone's role turns their links off too.
 */
export async function stillShares(db: DB, createdBy: string | null, collectionId: number | null, env: Record<string, string | undefined> = process.env): Promise<boolean> {
  if (!createdBy || createdBy === 'local') return true;
  const login = normLogin(createdBy);
  if (await isAdmin(db, login, env)) return true;
  if (collectionId == null) return false;
  const r = await db.select({ r: collectionMembers.role }).from(collectionMembers).where(and(eq(collectionMembers.login, login), eq(collectionMembers.collectionId, collectionId))).get();
  return r?.r === 'owner';
}

/** Whether `a` may do `need`. */
export function can(a: Access, need: Need): boolean {
  if (a.admin) return true;
  if (need === 'admin') return false;
  if (need === 'member') return a.roles.size > 0;
  if (need === 'shared') return [...a.roles.values()].some((r) => RANK[r] >= RANK.editor);
  const r = a.roles.get(need.collectionId);
  if (!r) return false;
  return need.action === 'read' || (need.action === 'write' ? RANK[r] >= RANK.editor : r === 'owner');
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
export const writable = (a: Access): 'all' | number[] => (a.admin ? 'all' : [...a.roles].filter(([, r]) => RANK[r] >= RANK.editor).map(([c]) => c));

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

export type Person = { login: string; name: string | null; admin: boolean; fromEnv: boolean; lastSeenAt: string | null; roles: { collectionId: number; role: Role }[] };

/** Everyone seen or added, with their roles. Admins from ADMIN_USERS are marked `fromEnv` (they can't be demoted here). */
export async function listPeople(db: DB, env: Record<string, string | undefined> = process.env): Promise<Person[]> {
  const list = adminList(env);
  const rows = await db.select().from(users).orderBy(users.login).all();
  const members = await db.select().from(collectionMembers).all();
  const logins = new Set([...rows.map((r) => r.login), ...members.map((m) => m.login), ...list]);
  return [...logins].sort().map((login) => {
    const u = rows.find((r) => r.login === login);
    const fromEnv = !list.length || list.includes(login);
    return {
      login, name: u?.name ?? null, admin: fromEnv || !!u?.admin, fromEnv, lastSeenAt: u?.lastSeenAt ?? null,
      roles: members.filter((m) => m.login === login).map((m) => ({ collectionId: m.collectionId, role: m.role })),
    };
  });
}

const LOGIN = /^[^\s,]{1,200}$/;

/** Adds a login before its first visit (a Tailscale login or Access email). */
export async function addPerson(db: DB, raw: unknown): Promise<Result> {
  const login = normLogin(raw);
  if (!LOGIN.test(login) || login === 'local' || login === 'cron' || login.startsWith('token:')) return { ok: false, status: 400, error: 'Enter their Tailscale login or Access email.' };
  await db.insert(users).values({ login }).onConflictDoNothing();
  return { ok: true };
}

/** Makes a login an admin or not. Admins from ADMIN_USERS stay admins; you can't take away your own admin. */
export async function setAdmin(db: DB, actor: Access, raw: unknown, admin: boolean, env: Record<string, string | undefined> = process.env): Promise<Result> {
  const login = normLogin(raw);
  if (!login) return { ok: false, status: 400, error: 'Which login?' };
  if (!admin && login === actor.login) return { ok: false, status: 409, error: "You can't remove your own admin." };
  const list = adminList(env);
  if (!admin && (!list.length || list.includes(login))) return { ok: false, status: 409, error: `${login} is an admin through ADMIN_USERS. Change it in the server's settings.` };
  await db.insert(users).values({ login, admin }).onConflictDoUpdate({ target: users.login, set: { admin } });
  return { ok: true };
}

/** Gives a login a role in a collection, or takes it away (`role` null). Admins can, and that collection's owners. */
export async function setRole(db: DB, actor: Access, collectionId: number, raw: unknown, role: Role | null): Promise<Result> {
  const login = normLogin(raw);
  if (!login || !LOGIN.test(login)) return { ok: false, status: 400, error: 'Enter their Tailscale login or Access email.' };
  if (role !== null && !ROLES.includes(role)) return { ok: false, status: 400, error: `Role must be one of: ${ROLES.join(', ')}.` };
  if (!(await db.select({ id: collections.id }).from(collections).where(eq(collections.id, collectionId)).get())) return { ok: false, status: 404, error: `Collection ${collectionId} doesn't exist.` };
  const c = check(actor, { action: 'manage', collectionId });
  if (!c.ok) return c;
  // An owner who isn't an admin can't lock themselves out of managing it.
  if (!actor.admin && login === actor.login && role !== 'owner') return { ok: false, status: 409, error: "You can't change your own role here. Ask an admin." };
  if (role === null) {
    await db.delete(collectionMembers).where(and(eq(collectionMembers.collectionId, collectionId), eq(collectionMembers.login, login)));
    return { ok: true };
  }
  await db.insert(users).values({ login }).onConflictDoNothing();
  await db.insert(collectionMembers).values({ collectionId, login, role }).onConflictDoUpdate({ target: [collectionMembers.collectionId, collectionMembers.login], set: { role } });
  return { ok: true };
}

/** Members of the given collections, for owners managing them. */
export async function membersOf(db: DB, ids: number[]): Promise<{ collectionId: number; login: string; role: Role }[]> {
  if (!ids.length) return [];
  return db.select().from(collectionMembers).where(inArray(collectionMembers.collectionId, ids)).orderBy(collectionMembers.login).all();
}

/** Removes every membership of a deleted collection. */
export async function dropMembers(db: DB, collectionId: number) {
  await db.delete(collectionMembers).where(eq(collectionMembers.collectionId, collectionId));
}

/** How many people are signed up (for Settings: whether permissions are in use at all). */
export async function peopleCount(db: DB): Promise<number> {
  return Number((await db.select({ n: sql<number>`count(*)` }).from(users).all())[0].n);
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
