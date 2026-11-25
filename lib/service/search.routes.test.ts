// GET /api/v1/search (#107) called as different people (AUTH_MODE=tailscale, with ADMIN_USERS set).
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const { mkdtempSync } = await import('node:fs');
const { tmpdir } = await import('node:os');
process.env.DATABASE_PATH = `${mkdtempSync(`${tmpdir()}/brickfolio-search-`)}/app.db`;
process.env.AUTH_MODE = 'tailscale';
process.env.ADMIN_USERS = 'admin@x.test';

const { nodeDb } = await import('../db/node');
const { addCollection } = await import('./collections');
const svc = await import('./sets');
const perm = await import('./permissions');
const { createToken } = await import('./tokens');
const search = await import('../../app/api/v1/search/route');

const db = nodeDb().db;
let kids = 0;
const admin = { login: 'admin@x.test', admin: true, roles: new Map() } as const;

async function get(path: string, as?: string | { token: string }) {
  const headers = new Headers();
  if (typeof as === 'string') headers.set('tailscale-user-login', as);
  else if (as) headers.set('authorization', `Bearer ${as.token}`);
  const res = await search.GET(new Request(`http://app${path}`, { headers }), { params: Promise.resolve({}) });
  return { status: res.status, body: await res.json() };
}
const found = (body: { results: { group: string; label: string }[] }) => body.results.map((r) => `${r.group}: ${r.label}`);

beforeAll(async () => {
  const r = await addCollection(db, 'Kids');
  if (!r.ok) throw new Error(r.error);
  kids = r.collection.id;
  await svc.addSet(db, { setNo: '10497-1', name: 'Galaxy Explorer', condition: 'New' }, { lookup: null, collectionId: 1 });
  await svc.addSet(db, { setNo: '60337-1', name: 'Express Train', condition: 'Used' }, { lookup: null, collectionId: kids });
  await perm.setRole(db, admin, kids, 'viewer@x.test', 'viewer');
});
afterAll(() => { delete process.env.ADMIN_USERS; process.env.AUTH_MODE = 'none'; });

describe('GET /api/v1/search', () => {
  it('answers 401 to nobody signed in, and to a wrong token', async () => {
    expect((await get('/api/v1/search?q=galaxy')).status).toBe(401);
    expect((await get('/api/v1/search?q=galaxy', { token: `bf_${crypto.randomUUID()}` })).status).toBe(401);
  });

  it("finds only the caller's collections' sets, and refuses a collection they can't read", async () => {
    expect(found((await get('/api/v1/search?q=ex', 'viewer@x.test')).body)).toEqual(['Sets: Express Train']);
    expect(found((await get('/api/v1/search?q=galaxy', 'viewer@x.test')).body)).toEqual([]);
    expect((await get('/api/v1/search?q=galaxy&collection=1', 'viewer@x.test')).status).toBe(403);
    expect(found((await get('/api/v1/search?q=galaxy', 'admin@x.test')).body)).toEqual(['Sets: Galaxy Explorer']);
    const t = await createToken(db, 'phone', 'viewer@x.test');
    if (!t.ok) throw new Error(t.error);
    expect(found((await get('/api/v1/search?q=galaxy', { token: t.token })).body)).toEqual([]); // a token acts as its owner
  });

  it('keeps Store and Orders from a viewer', async () => {
    expect(found((await get('/api/v1/search?q=store', 'viewer@x.test')).body)).toEqual([]);
    expect(found((await get('/api/v1/search?q=orders', 'viewer@x.test')).body)).toEqual([]);
    expect(found((await get('/api/v1/search?q=store', 'admin@x.test')).body)).toEqual(['Pages: Store']);
  });

  it('limits the query: nothing under 2 characters, 400 over 64', async () => {
    expect((await get('/api/v1/search?q=e', 'admin@x.test')).body).toEqual({ results: [] });
    expect((await get('/api/v1/search', 'admin@x.test')).body).toEqual({ results: [] });
    const long = await get(`/api/v1/search?q=${'x'.repeat(65)}`, 'admin@x.test');
    expect(long.status).toBe(400);
    expect(long.body.error).toMatch(/64/);
  });
});
