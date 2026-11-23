// GET /api/v1/sync/cron (Vercel Cron, curl from Render or any scheduler) next to the existing /api/v1/sync routes.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Lookup } from './bricklink/client';

vi.mock('server-only', () => ({}));
// after() needs a request scope; collect the callbacks and run them by hand. connection() is a no-op here.
const pending: (() => unknown)[] = [];
vi.mock('next/server', async (orig) => ({ ...(await orig<object>()), after: (fn: () => unknown) => { pending.push(fn); }, connection: async () => {} }));
const lookup: Lookup = async (no) => ({ blName: `BL ${no}`, year: 2021, categoryId: 1, imageUrl: null, avgSold: 20, minSold: 10, maxSold: 30, qtySold: 4 });
vi.mock('./session', async (orig) => ({
  ...(await orig<object>()),
  bricklink: () => lookup, brickStore: () => null, brickMinifig: () => null, brickPartPrice: () => null, brickPrice: () => null, rebrickable: () => null, brickset: () => null,
}));

const { mkdtempSync } = await import('node:fs');
const { tmpdir } = await import('node:os');
process.env.DATABASE_PATH = `${mkdtempSync(`${tmpdir()}/brickfolio-cron-`)}/app.db`;
process.env.AUTH_MODE = 'none';
process.env.IMAGE_CACHE = 'off';
// Made up at run time, so secret scanners have no literal to flag.
const SECRET = `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll('-', '');
process.env.CRON_SECRET = SECRET;

const { nodeDb } = await import('./db/node');
const svc = await import('./service/sets');
const cron = await import('../app/api/v1/sync/cron/route');
const sync = await import('../app/api/v1/sync/route');
const db = nodeDb().db;

const req = (method: string, auth?: string, path = '/api/v1/sync/cron') =>
  new Request(`http://app${path}`, { method, headers: auth === undefined ? {} : { authorization: auth } });
const run = async () => { while (pending.length) await pending.shift()!(); };
const ctx = { params: Promise.resolve({}) };

beforeAll(async () => { await svc.addSet(db, { setNo: '10497-1', name: 'Galaxy', condition: 'New' }, { lookup: null, collectionId: 1 }); });
afterAll(() => { delete process.env.CRON_SECRET; delete process.env.IMAGE_CACHE; });

describe('GET /api/v1/sync/cron', () => {
  it('refuses requests without the CRON_SECRET bearer', async () => {
    for (const auth of [undefined, '', SECRET, `Bearer ${SECRET}x`, `Bearer ${SECRET.slice(1)}`, `Basic ${SECRET}`]) {
      expect((await cron.GET(req('GET', auth))).status).toBe(401);
    }
    expect(pending).toHaveLength(0);
    expect(await svc.syncStatus(db)).toBeNull(); // nothing started
  });

  it('refuses everyone when CRON_SECRET is unset', async () => {
    delete process.env.CRON_SECRET;
    try {
      expect((await cron.GET(req('GET', 'Bearer '))).status).toBe(401);
      expect((await cron.GET(req('GET', `Bearer ${SECRET}`))).status).toBe(401);
    } finally { process.env.CRON_SECRET = SECRET; }
  });

  it('starts the sync with the secret (202), then does nothing more that day (200)', async () => {
    const res = await cron.GET(req('GET', `Bearer ${SECRET}`));
    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({ runId: expect.any(Number) });
    expect((await cron.GET(req('GET', `Bearer ${SECRET}`))).status).toBe(409); // still running
    await run();
    expect(await svc.syncStatus(db)).toMatchObject({ running: false, processed: 1, errors: 0, message: null });
    const again = await cron.GET(req('GET', `Bearer ${SECRET}`));
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ skipped: expect.stringContaining('Already synced today') });
    expect(pending).toHaveLength(0);
  });

  it('leaves GET /api/v1/sync (status) and POST /api/v1/sync (start, any time) as they were', async () => {
    const status = await sync.GET(req('GET', `Bearer ${SECRET}`, '/api/v1/sync'), ctx);
    expect(status.status).toBe(200);
    expect(await status.json()).toEqual({ sync: expect.objectContaining({ running: false, processed: 1 }), catalogOnly: null });
    const post = await sync.POST(req('POST', `Bearer ${SECRET}`, '/api/v1/sync'), ctx);
    expect(post.status).toBe(202); // a manual sync isn't limited to once a day
    await run();
  });
});
