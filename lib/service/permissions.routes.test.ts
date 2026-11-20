// #50 end to end: the REST routes and the MCP endpoint, called as different people (AUTH_MODE=tailscale, with
// ADMIN_USERS set), see and change only what each person's roles allow.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const { mkdtempSync } = await import('node:fs');
const { tmpdir } = await import('node:os');
process.env.DATABASE_PATH = `${mkdtempSync(`${tmpdir()}/brickfolio-perm-`)}/app.db`;
process.env.AUTH_MODE = 'tailscale';
process.env.ADMIN_USERS = 'admin@x';

const { nodeDb } = await import('../db/node');
const { addCollection } = await import('./collections');
const svc = await import('./sets');
const perm = await import('./permissions');
const { createToken } = await import('./tokens');
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
const admin = { login: 'admin@x', admin: true, roles: new Map() } as const;

type Handler<P> = (req: Request, ctx: { params: Promise<P> }) => Promise<Response>;
async function call<P extends object>(h: Handler<P>, as: string | { token: string }, opts: { method?: string; path?: string; body?: unknown; params?: P } = {}) {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (typeof as === 'string') headers.set('tailscale-user-login', as); else headers.set('authorization', `Bearer ${as.token}`);
  const req = new Request(`http://app${opts.path ?? '/api/v1/x'}`, { method: opts.method ?? 'GET', headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
  const res = await h(req, { params: Promise.resolve((opts.params ?? {}) as P) });
  return { status: res.status, body: await res.json().catch(() => null) };
}

beforeAll(async () => {
  const r = await addCollection(db, 'Kids');
  if (!r.ok) throw new Error(r.error);
  kids = r.collection.id;
  await svc.addSet(db, { setNo: '10497-1', name: 'Galaxy', condition: 'New' }, { lookup: null, collectionId: 1 });
  await svc.addSet(db, { setNo: '60337-1', name: 'Train', condition: 'Used' }, { lookup: null, collectionId: kids });
  await perm.setRole(db, admin, kids, 'viewer@x', 'viewer');
  await perm.setRole(db, admin, kids, 'editor@x', 'editor');
});
afterAll(() => { delete process.env.ADMIN_USERS; process.env.AUTH_MODE = 'none'; });

describe('reading', () => {
  it('gives someone with no collection nothing', async () => {
    expect((await call(sets.GET, 'nobody@x')).status).toBe(403);
    expect((await call(collections.GET, 'nobody@x')).status).toBe(403);
  });

  it('shows a viewer only their collection, and "all" means all of theirs', async () => {
    const r = await call(sets.GET, 'viewer@x');
    expect(r.status).toBe(200);
    expect(r.body.sets.map((s: { setNo: string }) => s.setNo)).toEqual(['60337-1']);
    expect((await call(sets.GET, 'viewer@x', { path: '/api/v1/sets?collection=1' })).status).toBe(403);
    expect((await call(oneSet.GET, 'viewer@x', { params: { setNo: '10497' } })).status).toBe(404);
    expect((await call(oneSet.GET, 'viewer@x', { params: { setNo: '60337' } })).status).toBe(200);
    expect((await call(collections.GET, 'viewer@x')).body.collections.map((c: { name: string; role: string }) => [c.name, c.role])).toEqual([['Kids', 'viewer']]);
    expect((await call(sets.GET, 'admin@x')).body.sets).toHaveLength(2);
  });

  it('keeps admin pages and settings to admins', async () => {
    expect((await call(store.GET, 'editor@x')).status).toBe(403);
    expect((await call(valueSource.PUT, 'editor@x', { method: 'PUT', body: { source: 'bricklink' } })).status).toBe(403);
    expect((await call(collections.POST, 'editor@x', { method: 'POST', body: { name: 'Mine' } })).status).toBe(403);
  });
});

describe('changing', () => {
  it('refuses a viewer every change', async () => {
    expect((await call(sets.POST, 'viewer@x', { method: 'POST', body: { setNo: '21325', name: 'Smith', condition: 'New' } })).status).toBe(403);
    expect((await call(wishlist.POST, 'viewer@x', { method: 'POST', body: { setNo: '10316' } })).status).toBe(403);
    const s = (await svc.getSet(db, '60337-1'))!;
    expect((await call(copy.DELETE, 'viewer@x', { method: 'DELETE', params: { setNo: '60337', id: String(s.copies[0].id) } })).status).toBe(403);
  });

  it('lets an editor add to their collection only, and change shared lists', async () => {
    const added = await call(sets.POST, 'editor@x', { method: 'POST', body: { setNo: '21325', name: 'Smith', condition: 'New' } });
    expect(added.status).toBe(201);
    expect((await svc.listSets(db, { collectionId: kids })).map((s) => s.setNo)).toContain('21325-1'); // their collection by default
    expect((await call(sets.POST, 'editor@x', { method: 'POST', path: '/api/v1/sets?collection=1', body: { setNo: '10305', name: 'Castle', condition: 'New' } })).status).toBe(403);
    expect((await call(copies.POST, 'editor@x', { method: 'POST', params: { setNo: '10497' }, body: { collectionId: 1 } })).status).toBe(403);
    expect((await call(minifigs.POST, 'editor@x', { method: 'POST', body: { figNo: 'sw0001' } })).status).toBe(201);
    expect((await call(wishlist.POST, 'editor@x', { method: 'POST', body: { setNo: '10316' } })).status).toBe(201);
  });

  it('needs write access to both collections to move a copy, and to every copy for a set-wide change', async () => {
    const s = (await svc.getSet(db, '60337-1'))!;
    const id = String(s.copies[0].id);
    expect((await call(copy.PATCH, 'editor@x', { method: 'PATCH', params: { setNo: '60337', id }, body: { collectionId: 1 } })).status).toBe(403);
    expect((await call(copy.PATCH, 'editor@x', { method: 'PATCH', params: { setNo: '60337', id }, body: { location: null } })).status).toBe(200);
    // 10497 has a copy in My collection: the editor can't rename it, even after adding a copy to Kids.
    await svc.addSet(db, { setNo: '10497-1', name: 'Galaxy' }, { lookup: null, another: true, collectionId: kids });
    expect((await call(oneSet.PATCH, 'editor@x', { method: 'PATCH', params: { setNo: '10497' }, body: { name: 'Renamed' } })).status).toBe(403);
  });

  it('lets only owners and admins make share links for a collection', async () => {
    expect((await call(shareLinks.POST, 'editor@x', { method: 'POST', body: { name: 'x', collectionId: kids } })).status).toBe(403);
    await perm.setRole(db, admin, kids, 'owner@x', 'owner');
    expect((await call(shareLinks.POST, 'owner@x', { method: 'POST', body: { name: 'x', collectionId: kids } })).status).toBe(201);
    expect((await call(shareLinks.POST, 'owner@x', { method: 'POST', body: { name: 'everything' } })).status).toBe(403);
    expect((await call(shareLinks.GET, 'owner@x')).body.shareLinks).toHaveLength(1);
  });
});

describe('tokens and MCP', () => {
  it("stops a token whose owner isn't in ALLOWED_USERS any more", async () => {
    const t = await createToken(db, 'gone', 'viewer@x');
    if (!t.ok) throw new Error(t.error);
    process.env.ALLOWED_USERS = 'admin@x';
    try {
      expect((await call(sets.GET, { token: t.token })).status).toBe(401);
    } finally { delete process.env.ALLOWED_USERS; }
  });

  it('a token acts as its owner; one from before #50 acts as admin', async () => {
    const t = await createToken(db, 'phone', 'viewer@x');
    if (!t.ok) throw new Error(t.error);
    // 10497 has a copy in each collection: the viewer's token sees only the Kids one.
    expect((await call(sets.GET, { token: t.token })).body.sets.find((s: { setNo: string }) => s.setNo === '10497-1').qty).toBe(1);
    expect((await call(sets.POST, { token: t.token }, { method: 'POST', body: { setNo: '10305', name: 'Castle', condition: 'New' } })).status).toBe(403);
    const old = await createToken(db, 'old', null);
    if (!old.ok) throw new Error(old.error);
    expect((await call(sets.GET, { token: old.token })).body.sets.find((s: { setNo: string }) => s.setNo === '10497-1').qty).toBe(2);
  });

  it('answers MCP tools from the caller\'s collections only', async () => {
    const rpc = (as: string, name: string, args: object = {}) => call(mcp.POST as unknown as Handler<object>, as, { method: 'POST', body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } } });
    const r = await rpc('viewer@x', 'search_sets');
    expect(r.body.result.structuredContent.sets.map((s: { setNo: string }) => s.setNo).sort()).toEqual(['10497', '21325', '60337']); // Kids now holds a 10497 copy
    const got = await rpc('viewer@x', 'get_set', { setNo: '10497' });
    expect(got.body.result.structuredContent.copyList).toHaveLength(1); // only the Kids copy
    expect((await rpc('viewer@x', 'search_sets', { collection: 'My collection' })).body.result.isError).toBe(true);
    expect((await rpc('nobody@x', 'search_sets')).status).toBe(403);
  });
});

describe('what a change shows back', () => {
  it('answers a copy change with only the copies the caller can see, and counts "already have" the same way', async () => {
    // 10497 has a copy in My collection and one in Kids by now.
    const r = await call(copies.POST, 'editor@x', { method: 'POST', params: { setNo: '10497' }, body: {} });
    expect(r.status).toBe(201);
    expect(r.body.set.copies.every((c: { collectionId: number }) => c.collectionId === kids)).toBe(true);
    // 10305 is only in My collection: the editor's add just adds a Kids copy rather than saying "you already have 1".
    await svc.addSet(db, { setNo: '10305-1', name: 'Castle', condition: 'New' }, { lookup: null, collectionId: 1 });
    const added = await call(sets.POST, 'editor@x', { method: 'POST', body: { setNo: '10305', name: 'Castle', condition: 'New' } });
    expect(added.status).toBe(201);
    expect(added.body.set.qty).toBe(1);
    expect((await call(sets.POST, 'editor@x', { method: 'POST', body: { setNo: '10305', name: 'Castle', condition: 'New' } })).body.existing).toEqual({ name: 'Castle', qty: 1 });
  });
});

describe('layouts', () => {
  it('hides copies in other collections, and keeps them when someone else saves the module', async () => {
    const made = await call(layoutsApi.POST, 'admin@x', { method: 'POST', body: { name: 'Town', cols: 2, rows: 1 } });
    expect(made.status).toBe(201);
    const id = made.body.layout.id;
    const m = await L.addModule(db, id, { x: 0, y: 0, kind: 'plain', name: 'Hill' });
    if (!m.ok) throw new Error(m.error);
    const galaxy = (await svc.getSet(db, '10497-1'))!;
    const mine = galaxy.copies.find((c) => (c.collectionId ?? 1) === 1)!, theirs = galaxy.copies.find((c) => c.collectionId === kids)!;
    await L.setModuleItems(db, m.id, { setCopyIds: [mine.id], buildIds: [] });

    const seen = await call(layoutOne.GET, 'viewer@x', { params: { id: String(id) } });
    expect(seen.body.layout.modules[0].items).toEqual([]);
    expect((await call(layoutNeedsApi.GET, 'viewer@x', { params: { id: String(id) } })).body.copies).toBe(0);
    const p = { id: String(id), moduleId: String(m.id) };
    expect((await call(layoutItems.PUT, 'editor@x', { method: 'PUT', params: p, body: { setCopyIds: [mine.id], buildIds: [] } })).status).toBe(400); // can't place it
    expect((await call(layoutItems.PUT, 'editor@x', { method: 'PUT', params: p, body: { setCopyIds: [theirs.id], buildIds: [] } })).status).toBe(200);
    expect((await L.getLayout(db, id))!.modules[0].items.map((i) => i.refId).sort()).toEqual([mine.id, theirs.id].sort()); // the hidden one stayed
  });
});

describe('share links', () => {
  it('stop working when their maker can no longer share the collection', async () => {
    const r = await share.createShareLink(db, { name: 'k', showValues: false, showLocations: false, showNotes: false, showMinifigs: true, expiresAt: null, collectionId: kids, createdBy: 'sharer@x' });
    if (!r.ok) throw new Error(r.error);
    await perm.setRole(db, admin, kids, 'sharer@x', 'owner');
    expect(await share.checkShareLink(db, r.token)).not.toBeNull();
    await perm.setRole(db, admin, kids, 'sharer@x', 'editor');
    expect(await share.checkShareLink(db, r.token)).toBeNull();
  });
});
