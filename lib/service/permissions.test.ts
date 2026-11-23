// Users and per-collection permissions (#50): who is an admin, what each role may do, and managing people.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openNodeDb } from '../db/node';
import type { DB } from '../db/types';
import { authUser } from '../db/schema';
import { addCollection } from './collections';
import * as perm from './permissions';
import { createToken, listTokens, revokeToken } from './tokens';

let db: DB;
let kids: number;
const env = (admins?: string) => (admins === undefined ? {} : { ADMIN_USERS: admins });
const tailscale = (user: string) => ({ user, via: 'tailscale' as const });

beforeEach(async () => {
  db = openNodeDb(':memory:').db;
  const r = await addCollection(db, 'Kids');
  if (!r.ok) throw new Error(r.error);
  kids = r.collection.id;
});
afterEach(() => { delete process.env.ADMIN_USERS; });

describe('who is an admin', () => {
  it('everyone allowed in, while ADMIN_USERS is unset: nothing changes for an upgraded install', async () => {
    const a = await perm.resolveAccess(db, tailscale('b@x'), env());
    expect(a).toMatchObject({ login: 'b@x', admin: true });
    expect(perm.can(a, 'admin')).toBe(true);
  });

  it('only ADMIN_USERS (and user.role admin) once it is set, case-insensitively', async () => {
    expect((await perm.resolveAccess(db, tailscale('A@X'), env('a@x, c@x'))).admin).toBe(true);
    expect((await perm.resolveAccess(db, tailscale('b@x'), env('a@x'))).admin).toBe(false);
    await db.insert(authUser).values({ id: 'b', name: 'b@x', email: 'b@x', role: 'admin' }).onConflictDoUpdate({ target: authUser.email, set: { role: 'admin' } }); // #90: Better Auth's admin role
    expect((await perm.resolveAccess(db, tailscale('b@x'), env('a@x'))).admin).toBe(true);
  });

  it('the scheduler, AUTH_MODE=none, and API tokens from before (or made without a login) act as admin', async () => {
    expect((await perm.resolveAccess(db, { user: 'cron', via: 'cron' }, env('a@x'))).admin).toBe(true);
    expect((await perm.resolveAccess(db, { user: 'local', via: 'none' }, env('a@x'))).admin).toBe(true);
    expect((await perm.resolveAccess(db, { user: 'token:old', via: 'token', owner: null }, env('a@x'))).admin).toBe(true);
    expect((await perm.resolveAccess(db, { user: 'token:cli', via: 'token', owner: 'local' }, env('a@x'))).admin).toBe(true);
  });

  it('a token acts as the person who made it', async () => {
    await perm.setRole(db, { login: 'a@x', admin: true, roles: new Map() }, kids, 'b@x', 'viewer');
    const a = await perm.resolveAccess(db, { user: 'token:phone', via: 'token', owner: 'b@x' }, env('a@x'));
    expect(a).toMatchObject({ login: 'b@x', admin: false });
    expect([...a.roles]).toEqual([[kids, 'viewer']]);
  });

  it('records a login the first time it is seen', async () => {
    await perm.resolveAccess(db, tailscale('new@x'), env('a@x'));
    const people = await perm.listPeople(db, env('a@x'));
    expect(people.find((p) => p.login === 'new@x')).toMatchObject({ admin: false, roles: [], lastSeenAt: expect.any(String) });
    expect(people.find((p) => p.login === 'a@x')).toMatchObject({ admin: true, fromEnv: true });
  });
});

describe('what each role may do', () => {
  const access = (roles: [number, perm.Role][]): perm.Access => ({ login: 'b@x', admin: false, roles: new Map(roles) });

  it('follows the role matrix', () => {
    const none = access([]), viewer = access([[kids, 'viewer']]), editor = access([[kids, 'editor']]), owner = access([[kids, 'owner']]);
    const on = (action: 'read' | 'write' | 'manage') => ({ action, collectionId: kids });
    expect([none, viewer, editor, owner].map((a) => perm.can(a, 'member'))).toEqual([false, true, true, true]);
    expect([none, viewer, editor, owner].map((a) => perm.can(a, 'shared'))).toEqual([false, false, true, true]);
    expect([none, viewer, editor, owner].map((a) => perm.can(a, 'admin'))).toEqual([false, false, false, false]);
    expect([viewer, editor, owner].map((a) => perm.can(a, on('read')))).toEqual([true, true, true]);
    expect([viewer, editor, owner].map((a) => perm.can(a, on('write')))).toEqual([false, true, true]);
    expect([viewer, editor, owner].map((a) => perm.can(a, on('manage')))).toEqual([false, false, true]);
    expect(perm.can(owner, { action: 'read', collectionId: 1 })).toBe(false);
    expect(perm.check(viewer, on('write'))).toEqual({ ok: false, status: 403, error: "You don't have permission to change that collection." });
  });

  it('cuts scopes down to what someone can read', () => {
    const a = access([[kids, 'viewer']]);
    expect(perm.clampScope(a, 'all')).toEqual([kids]);
    expect(perm.clampScope(a, kids)).toBe(kids);
    expect(perm.clampScope(a, 1)).toBeNull();
    expect(perm.clampScope({ ...a, admin: true }, 1)).toBe(1);
    expect(perm.writable(access([[kids, 'viewer'], [1, 'editor']]))).toEqual([1]);
    expect(perm.shareNeed(null)).toBe('admin');
    expect(perm.shareNeed(kids)).toEqual({ action: 'manage', collectionId: kids });
  });

  it('decides set-wide changes from the collections of every copy', () => {
    const a = access([[kids, 'editor'], [1, 'viewer']]);
    expect(perm.canWriteAll(a, [kids])).toBe(true);
    expect(perm.canWriteAll(a, [kids, 1])).toBe(false);
    expect(perm.canWriteAny(a, [kids, 1])).toBe(true);
    expect(perm.setRefusal(a, [1], false)).toMatchObject({ status: 403 });
    expect(perm.setRefusal(access([]), [1], false)).toMatchObject({ status: 403, error: 'Not found.' });
  });
});

describe('managing people', () => {
  const admin: perm.Access = { login: 'a@x', admin: true, roles: new Map() };

  it('admins add people, give and take roles, and make admins; owners manage their own collection only', async () => {
    expect(await perm.addPerson(db, 'C@X')).toEqual({ ok: true });
    expect(await perm.addPerson(db, 'not a login')).toMatchObject({ ok: false, status: 400 });
    expect(await perm.setRole(db, admin, kids, 'c@x', 'owner')).toEqual({ ok: true });
    const owner = await perm.resolveAccess(db, tailscale('c@x'), env('a@x'));
    expect(await perm.setRole(db, owner, kids, 'd@x', 'editor')).toEqual({ ok: true });
    expect(await perm.setRole(db, owner, 1, 'd@x', 'editor')).toMatchObject({ ok: false, status: 403 });
    expect(await perm.setRole(db, owner, kids, 'c@x', 'viewer')).toMatchObject({ ok: false, status: 409 }); // not their own
    expect(await perm.setRole(db, admin, kids, 'd@x', null)).toEqual({ ok: true });
    expect(await perm.setRole(db, admin, 99, 'd@x', 'viewer')).toMatchObject({ ok: false, status: 404 });
    expect((await perm.membersOf(db, [kids])).map((m) => [m.login, m.role])).toEqual([['c@x', 'owner']]);

    expect(await perm.setAdmin(db, admin, 'c@x', true, env('a@x'))).toEqual({ ok: true });
    expect((await perm.resolveAccess(db, tailscale('c@x'), env('a@x'))).admin).toBe(true);
    expect(await perm.setAdmin(db, admin, 'a@x', false, env('a@x, z@x'))).toMatchObject({ ok: false, status: 409 }); // yourself
    expect(await perm.setAdmin(db, admin, 'z@x', false, env('a@x, z@x'))).toMatchObject({ ok: false, status: 409, error: expect.stringContaining('ADMIN_USERS') });
  });

  it('keeps each person to their own tokens', async () => {
    await createToken(db, 'mine', 'b@x');
    await createToken(db, 'theirs', 'a@x');
    const mine = await listTokens(db, 'b@x');
    expect(mine.map((t) => t.name)).toEqual(['mine']);
    const theirs = (await listTokens(db)).find((t) => t.name === 'theirs')!;
    await revokeToken(db, theirs.id, 'b@x'); // not b's: nothing happens
    expect(await listTokens(db)).toHaveLength(2);
    await revokeToken(db, theirs.id);
    expect(await listTokens(db)).toHaveLength(1);
  });
});
