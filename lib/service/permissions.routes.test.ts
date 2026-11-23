// #50 end to end: the REST routes and the MCP endpoint, called as different people (AUTH_MODE=tailscale, with
// ADMIN_USERS set), see and change only what each person's roles allow. permissions.routes.better-auth.test.ts runs
// the same tests signed in with Better Auth sessions instead (#90).
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const { mkdtempSync } = await import('node:fs');
const { tmpdir } = await import('node:os');
process.env.DATABASE_PATH = `${mkdtempSync(`${tmpdir()}/brickfolio-perm-`)}/app.db`;
if (process.env.AUTH_MODE !== 'better-auth') process.env.AUTH_MODE = 'tailscale';
process.env.ADMIN_USERS = 'admin@x.test';

const { nodeDb } = await import('../db/node');
const { addCollection } = await import('./collections');
const svc = await import('./sets');
const perm = await import('./permissions');
const { createToken, listTokens, revokeToken, sha256Hex } = await import('./tokens');
const { apiTokens } = await import('../db/schema');
// Test passwords are made up at run time, so secret scanners have no literal to flag.
const PASSWORDS: Record<string, string> = new Proxy({}, { get: (t: Record<string, string>, k: string) => (t[k] ??= `${crypto.randomUUID()}`) });
const sets = await import('../../app/api/v1/sets/route');
const oneSet = await import('../../app/api/v1/sets/[setNo]/route');
const copies = await import('../../app/api/v1/sets/[setNo]/copies/route');
const copy = await import('../../app/api/v1/sets/[setNo]/copies/[id]/route');
const minifigs = await import('../../app/api/v1/minifigs/route');
const collections = await import('../../app/api/v1/collections/route');
const valueSource = await import('../../app/api/v1/settings/value-source/route');
const wishlist = await import('../../app/api/v1/wishlist/route');
const store = await import('../../app/api/v1/store/route');
const shareLinks = await import('../../app/api/v1/share-links/route');
const layoutsApi = await import('../../app/api/v1/layouts/route');
const layoutItems = await import('../../app/api/v1/layouts/[id]/modules/[moduleId]/items/route');
const layoutOne = await import('../../app/api/v1/layouts/[id]/route');
const layoutNeedsApi = await import('../../app/api/v1/layouts/[id]/needs/route');
const L = await import('./layouts');
const share = await import('./share');
const mcp = await import('../../app/api/mcp/route');

const db = nodeDb().db;
let kids = 0;
const admin = { login: 'admin@x.test', admin: true, roles: new Map() } as const;

type Handler<P> = (req: Request, ctx: { params: Promise<P> }) => Promise<Response>;
async function call<P extends object>(h: Handler<P>, as: string | { token: string; header?: 'x-api-key' }, opts: { method?: string; path?: string; body?: unknown; params?: P } = {}) {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (typeof as !== 'string') headers.set(as.header ?? 'authorization', as.header ? as.token : `Bearer ${as.token}`);
  else if (process.env.AUTH_MODE === 'better-auth') headers.set('cookie', await signedIn(as));
  else headers.set('tailscale-user-login', as);
  const req = new Request(`http://app${opts.path ?? '/api/v1/x'}`, { method: opts.method ?? 'GET', headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
  const res = await h(req, { params: Promise.resolve((opts.params ?? {}) as P) });
  return { status: res.status, body: await res.json().catch(() => null) };
}

/** #90: a Better Auth session cookie for `login`, giving them a password first if they have none (as an admin would). */
const cookies = new Map<string, string>();
async function signedIn(login: string): Promise<string> {
  if (cookies.has(login)) return cookies.get(login)!;
  const { getAuth } = await import('../better-auth');
  const auth = getAuth(db), ctx = await auth.$context, password = PASSWORDS['correct horse battery'];
  const u = await ctx.internalAdapter.findUserByEmail(login, { includeAccounts: true });
  if (!u) await perm.addPerson(db, login);
  if (!u?.accounts.some((a) => a.providerId === 'credential')) {
    const r = await (await import('../better-auth')).setPassword(db, login, password); // as an admin would (verifies the address)
    if (!r.ok) throw new Error(r.error);
  }
  const r = await auth.api.signInEmail({ body: { email: login, password }, returnHeaders: true });
  const c = r.headers.getSetCookie().map((x) => x.split(';')[0]).join('; ');
  cookies.set(login, c);
  return c;
}

/** #90: tokens as the code before it made them (rows in `api_tokens`, hex SHA-256), there before this process starts. */
const legacy: Record<string, string> = {};
async function legacyToken(name: string, owner: string | null) {
  const token = 'bf_' + btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  await db.insert(apiTokens).values({ name, hash: await sha256Hex(token), prefix: token.slice(0, 8), owner });
  legacy[name] = token;
}

beforeAll(async () => {
  await legacyToken('old-viewer', 'viewer@x.test');
  await legacyToken('old-ownerless', null);
  await legacyToken('old-local', 'local');
  const r = await addCollection(db, 'Kids');
  if (!r.ok) throw new Error(r.error);
  kids = r.collection.id;
  await svc.addSet(db, { setNo: '10497-1', name: 'Galaxy', condition: 'New' }, { lookup: null, collectionId: 1 });
  await svc.addSet(db, { setNo: '60337-1', name: 'Train', condition: 'Used' }, { lookup: null, collectionId: kids });
  await perm.setRole(db, admin, kids, 'viewer@x.test', 'viewer');
  await perm.setRole(db, admin, kids, 'editor@x.test', 'editor');
});
afterAll(() => { delete process.env.ADMIN_USERS; process.env.AUTH_MODE = 'none'; });

describe('reading', () => {
  it('gives someone with no collection nothing', async () => {
    expect((await call(sets.GET, 'nobody@x.test')).status).toBe(403);
    expect((await call(collections.GET, 'nobody@x.test')).status).toBe(403);
  });

  it('shows a viewer only their collection, and "all" means all of theirs', async () => {
    const r = await call(sets.GET, 'viewer@x.test');
    expect(r.status).toBe(200);
    expect(r.body.sets.map((s: { setNo: string }) => s.setNo)).toEqual(['60337-1']);
    expect((await call(sets.GET, 'viewer@x.test', { path: '/api/v1/sets?collection=1' })).status).toBe(403);
    expect((await call(oneSet.GET, 'viewer@x.test', { params: { setNo: '10497' } })).status).toBe(404);
    expect((await call(oneSet.GET, 'viewer@x.test', { params: { setNo: '60337' } })).status).toBe(200);
    expect((await call(collections.GET, 'viewer@x.test')).body.collections.map((c: { name: string; role: string }) => [c.name, c.role])).toEqual([['Kids', 'viewer']]);
    expect((await call(sets.GET, 'admin@x.test')).body.sets).toHaveLength(2);
  });

  it('keeps admin pages and settings to admins', async () => {
    expect((await call(store.GET, 'editor@x.test')).status).toBe(403);
    expect((await call(valueSource.PUT, 'editor@x.test', { method: 'PUT', body: { source: 'bricklink' } })).status).toBe(403);
    expect((await call(collections.POST, 'editor@x.test', { method: 'POST', body: { name: 'Mine' } })).status).toBe(403);
  });
});

describe('changing', () => {
  it('refuses a viewer every change', async () => {
    expect((await call(sets.POST, 'viewer@x.test', { method: 'POST', body: { setNo: '21325', name: 'Smith', condition: 'New' } })).status).toBe(403);
    expect((await call(wishlist.POST, 'viewer@x.test', { method: 'POST', body: { setNo: '10316' } })).status).toBe(403);
    const s = (await svc.getSet(db, '60337-1'))!;
    expect((await call(copy.DELETE, 'viewer@x.test', { method: 'DELETE', params: { setNo: '60337', id: String(s.copies[0].id) } })).status).toBe(403);
  });

  it('lets an editor add to their collection only, and change shared lists', async () => {
    const added = await call(sets.POST, 'editor@x.test', { method: 'POST', body: { setNo: '21325', name: 'Smith', condition: 'New' } });
    expect(added.status).toBe(201);
    expect((await svc.listSets(db, { collectionId: kids })).map((s) => s.setNo)).toContain('21325-1'); // their collection by default
    expect((await call(sets.POST, 'editor@x.test', { method: 'POST', path: '/api/v1/sets?collection=1', body: { setNo: '10305', name: 'Castle', condition: 'New' } })).status).toBe(403);
    expect((await call(copies.POST, 'editor@x.test', { method: 'POST', params: { setNo: '10497' }, body: { collectionId: 1 } })).status).toBe(403);
    expect((await call(minifigs.POST, 'editor@x.test', { method: 'POST', body: { figNo: 'sw0001' } })).status).toBe(201);
    expect((await call(wishlist.POST, 'editor@x.test', { method: 'POST', body: { setNo: '10316' } })).status).toBe(201);
  });

  it('needs write access to both collections to move a copy, and to every copy for a set-wide change', async () => {
    const s = (await svc.getSet(db, '60337-1'))!;
    const id = String(s.copies[0].id);
    expect((await call(copy.PATCH, 'editor@x.test', { method: 'PATCH', params: { setNo: '60337', id }, body: { collectionId: 1 } })).status).toBe(403);
    expect((await call(copy.PATCH, 'editor@x.test', { method: 'PATCH', params: { setNo: '60337', id }, body: { location: null } })).status).toBe(200);
    // 10497 has a copy in My collection: the editor can't rename it, even after adding a copy to Kids.
    await svc.addSet(db, { setNo: '10497-1', name: 'Galaxy' }, { lookup: null, another: true, collectionId: kids });
    expect((await call(oneSet.PATCH, 'editor@x.test', { method: 'PATCH', params: { setNo: '10497' }, body: { name: 'Renamed' } })).status).toBe(403);
  });

  it('lets only owners and admins make share links for a collection', async () => {
    expect((await call(shareLinks.POST, 'editor@x.test', { method: 'POST', body: { name: 'x', collectionId: kids } })).status).toBe(403);
    await perm.setRole(db, admin, kids, 'owner@x.test', 'owner');
    expect((await call(shareLinks.POST, 'owner@x.test', { method: 'POST', body: { name: 'x', collectionId: kids } })).status).toBe(201);
    expect((await call(shareLinks.POST, 'owner@x.test', { method: 'POST', body: { name: 'everything' } })).status).toBe(403);
    expect((await call(shareLinks.GET, 'owner@x.test')).body.shareLinks).toHaveLength(1);
  });
});

describe('tokens and MCP', () => {
  it("stops a token whose owner isn't in ALLOWED_USERS any more", async () => {
    const t = await createToken(db, 'gone', 'viewer@x.test');
    if (!t.ok) throw new Error(t.error);
    process.env.ALLOWED_USERS = 'admin@x.test';
    try {
      expect((await call(sets.GET, { token: t.token })).status).toBe(401);
    } finally { delete process.env.ALLOWED_USERS; }
  });

  it('a token acts as its owner; one from before #50 acts as admin', async () => {
    const t = await createToken(db, 'phone', 'viewer@x.test');
    if (!t.ok) throw new Error(t.error);
    // 10497 has a copy in each collection: the viewer's token sees only the Kids one.
    expect((await call(sets.GET, { token: t.token })).body.sets.find((s: { setNo: string }) => s.setNo === '10497-1').qty).toBe(1);
    expect((await call(sets.POST, { token: t.token }, { method: 'POST', body: { setNo: '10305', name: 'Castle', condition: 'New' } })).status).toBe(403);
    const old = await createToken(db, 'old', null);
    if (!old.ok) throw new Error(old.error);
    expect((await call(sets.GET, { token: old.token })).body.sets.find((s: { setNo: string }) => s.setNo === '10497-1').qty).toBe(2);
  });

  it('keeps tokens from before #90 working: same secret, owner and permissions, as Bearer or x-api-key', async () => {
    const qty = async (as: { token: string; header?: 'x-api-key' }) => (await call(sets.GET, as)).body.sets.find((s: { setNo: string }) => s.setNo === '10497-1').qty;
    for (const header of [undefined, 'x-api-key'] as const) {
      expect(await qty({ token: legacy['old-viewer'], header })).toBe(1); // the viewer's: only the Kids copy
      expect(await qty({ token: legacy['old-ownerless'], header })).toBe(2); // no owner: admin
      expect(await qty({ token: legacy['old-local'], header })).toBe(2); // AUTH_MODE=none's: admin
    }
    expect((await call(sets.POST, { token: legacy['old-viewer'] }, { method: 'POST', body: { setNo: '10305', name: 'Castle', condition: 'New' } })).status).toBe(403);
    expect((await call(sets.GET, { token: legacy['old-viewer'] + 'x' })).status).toBe(401);
    process.env.ALLOWED_USERS = 'admin@x.test';
    try {
      expect((await call(sets.GET, { token: legacy['old-viewer'] })).status).toBe(401);
      expect((await call(sets.GET, { token: legacy['old-ownerless'] })).status).toBe(200); // nobody to take out
    } finally { delete process.env.ALLOWED_USERS; }
  });

  it('revokes a token at once, old or new', async () => {
    const t = await createToken(db, 'short-lived', 'viewer@x.test');
    if (!t.ok) throw new Error(t.error);
    await legacyToken('old-revoked', 'viewer@x.test');
    const { moveLegacyTokens } = await import('./tokens');
    await moveLegacyTokens(db); // this process copied the old table already; a new token there is picked up on restart
    for (const [name, token] of [['short-lived', t.token], ['old-revoked', legacy['old-revoked']]]) {
      expect((await call(sets.GET, { token })).status).toBe(200);
      await revokeToken(db, (await listTokens(db, 'viewer@x.test')).find((x) => x.name === name)!.id, 'viewer@x.test');
      expect((await call(sets.GET, { token })).status).toBe(401);
    }
  });

  it('takes CRON_SECRET as a Bearer token only, as before', async () => {
    process.env.CRON_SECRET = crypto.randomUUID();
    try {
      expect((await call(sets.GET, { token: process.env.CRON_SECRET })).status).toBe(200);
      expect((await call(sets.GET, { token: process.env.CRON_SECRET, header: 'x-api-key' })).status).toBe(401);
    } finally { delete process.env.CRON_SECRET; }
  });

  it('answers MCP with a token from before #90 as its owner', async () => {
    const rpc = (token: string) => call(mcp.POST as unknown as Handler<object>, { token }, { method: 'POST', body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_set', arguments: { setNo: '10497' } } } });
    expect((await rpc(legacy['old-viewer'])).body.result.structuredContent.copyList).toHaveLength(1);
    expect((await rpc(legacy['old-ownerless'])).body.result.structuredContent.copyList).toHaveLength(2);
    expect((await rpc(legacy['old-viewer'] + 'x')).status).toBe(401);
  });

  it('answers MCP tools from the caller\'s collections only', async () => {
    const rpc = (as: string, name: string, args: object = {}) => call(mcp.POST as unknown as Handler<object>, as, { method: 'POST', body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } } });
    const r = await rpc('viewer@x.test', 'search_sets');
    expect(r.body.result.structuredContent.sets.map((s: { setNo: string }) => s.setNo).sort()).toEqual(['10497', '21325', '60337']); // Kids now holds a 10497 copy
    const got = await rpc('viewer@x.test', 'get_set', { setNo: '10497' });
    expect(got.body.result.structuredContent.copyList).toHaveLength(1); // only the Kids copy
    expect((await rpc('viewer@x.test', 'search_sets', { collection: 'My collection' })).body.result.isError).toBe(true);
    expect((await rpc('nobody@x.test', 'search_sets')).status).toBe(403);
  });
});

describe('what a change shows back', () => {
  it('answers a copy change with only the copies the caller can see, and counts "already have" the same way', async () => {
    // 10497 has a copy in My collection and one in Kids by now.
    const r = await call(copies.POST, 'editor@x.test', { method: 'POST', params: { setNo: '10497' }, body: {} });
    expect(r.status).toBe(201);
    expect(r.body.set.copies.every((c: { collectionId: number }) => c.collectionId === kids)).toBe(true);
    // 10305 is only in My collection: the editor's add just adds a Kids copy rather than saying "you already have 1".
    await svc.addSet(db, { setNo: '10305-1', name: 'Castle', condition: 'New' }, { lookup: null, collectionId: 1 });
    const added = await call(sets.POST, 'editor@x.test', { method: 'POST', body: { setNo: '10305', name: 'Castle', condition: 'New' } });
    expect(added.status).toBe(201);
    expect(added.body.set.qty).toBe(1);
    expect((await call(sets.POST, 'editor@x.test', { method: 'POST', body: { setNo: '10305', name: 'Castle', condition: 'New' } })).body.existing).toEqual({ name: 'Castle', qty: 1 });
  });
});

describe('layouts', () => {
  it('hides copies in other collections, and keeps them when someone else saves the module', async () => {
    const made = await call(layoutsApi.POST, 'admin@x.test', { method: 'POST', body: { name: 'Town', cols: 2, rows: 1 } });
    expect(made.status).toBe(201);
    const id = made.body.layout.id;
    const m = await L.addModule(db, id, { x: 0, y: 0, kind: 'plain', name: 'Hill' });
    if (!m.ok) throw new Error(m.error);
    const galaxy = (await svc.getSet(db, '10497-1'))!;
    const mine = galaxy.copies.find((c) => (c.collectionId ?? 1) === 1)!, theirs = galaxy.copies.find((c) => c.collectionId === kids)!;
    await L.setModuleItems(db, m.id, { setCopyIds: [mine.id], buildIds: [] });

    const seen = await call(layoutOne.GET, 'viewer@x.test', { params: { id: String(id) } });
    expect(seen.body.layout.modules[0].items).toEqual([]);
    expect((await call(layoutNeedsApi.GET, 'viewer@x.test', { params: { id: String(id) } })).body.copies).toBe(0);
    const p = { id: String(id), moduleId: String(m.id) };
    expect((await call(layoutItems.PUT, 'editor@x.test', { method: 'PUT', params: p, body: { setCopyIds: [mine.id], buildIds: [] } })).status).toBe(400); // can't place it
    expect((await call(layoutItems.PUT, 'editor@x.test', { method: 'PUT', params: p, body: { setCopyIds: [theirs.id], buildIds: [] } })).status).toBe(200);
    expect((await L.getLayout(db, id))!.modules[0].items.map((i) => i.refId).sort()).toEqual([mine.id, theirs.id].sort()); // the hidden one stayed
  });
});

describe('share links', () => {
  it('stop working when their maker can no longer share the collection', async () => {
    const r = await share.createShareLink(db, { name: 'k', showValues: false, showLocations: false, showNotes: false, showMinifigs: true, expiresAt: null, collectionId: kids, createdBy: 'sharer@x.test' });
    if (!r.ok) throw new Error(r.error);
    await perm.setRole(db, admin, kids, 'sharer@x.test', 'owner');
    expect(await share.checkShareLink(db, r.token)).not.toBeNull();
    await perm.setRole(db, admin, kids, 'sharer@x.test', 'editor');
    expect(await share.checkShareLink(db, r.token)).toBeNull();
  });
});
