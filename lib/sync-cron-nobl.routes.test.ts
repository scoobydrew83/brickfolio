// GET /api/v1/sync/cron without BrickLink keys (#94 follow-up): like the always-on scheduler, it still runs the
// Rebrickable and Brickset steps once a day, instead of answering 400.
import { afterAll, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const pending: (() => unknown)[] = [];
vi.mock('next/server', async (orig) => ({ ...(await orig<object>()), after: (fn: () => unknown) => { pending.push(fn); }, connection: async () => {} }));
const keys = vi.hoisted(() => ({ rb: true, bs: true }));
const ran = vi.hoisted(() => [] as string[]);
vi.mock('./session', async (orig) => ({
  ...(await orig<object>()),
  bricklink: () => null, brickStore: () => null, brickMinifig: () => null, brickPartPrice: () => null, brickPrice: () => null,
  rebrickable: () => (keys.rb ? {} : null), brickset: () => (keys.bs ? {} : null),
}));
vi.mock('./rebrickable/run', () => ({ startRebrickableSync: async () => { ran.push('rebrickable'); } }));
vi.mock('./service/retail', async (orig) => ({ ...(await orig<object>()), syncRetail: async () => { ran.push('brickset'); return []; } }));

const { mkdtempSync } = await import('node:fs');
const { tmpdir } = await import('node:os');
process.env.DATABASE_PATH = `${mkdtempSync(`${tmpdir()}/brickfolio-cron-nobl-`)}/app.db`;
process.env.AUTH_MODE = 'none';
const SECRET = `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll('-', '');
process.env.CRON_SECRET = SECRET;

const cron = await import('../app/api/v1/sync/cron/route');
const sync = await import('../app/api/v1/sync/route');
const call = () => cron.GET(new Request('http://app/api/v1/sync/cron', { headers: { authorization: `Bearer ${SECRET}` } }));
const run = async () => { while (pending.length) await pending.shift()!(); };
afterAll(() => { delete process.env.CRON_SECRET; });

describe('GET /api/v1/sync/cron without BrickLink keys', () => {
  it('runs Rebrickable and Brickset once a day (202, then 200)', async () => {
    const res = await call();
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ started: expect.stringMatching(/Rebrickable and Brickset/) });
    const status = async () => (await (await sync.GET(new Request('http://app/api/v1/sync', { headers: { authorization: `Bearer ${SECRET}` } }), { params: Promise.resolve({}) })).json());
    expect(await status()).toMatchObject({ sync: null, catalogOnly: { running: true, finishedAt: null } }); // what cron-trigger.mjs --wait follows
    await run();
    expect(ran).toEqual(['rebrickable', 'brickset']);
    expect(await status()).toMatchObject({ sync: null, catalogOnly: { running: false, finishedAt: expect.any(String), errors: [] } });
    const again = await call();
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ skipped: expect.stringMatching(/Already ran today/) });
    expect(pending).toHaveLength(0);
  });

  it('still answers 400 with nothing to sync, and POST /api/v1/sync is unchanged', async () => {
    keys.rb = false; keys.bs = false;
    expect((await call()).status).toBe(400);
    const post = await sync.POST(new Request('http://app/api/v1/sync', { method: 'POST', headers: { authorization: `Bearer ${SECRET}` } }), { params: Promise.resolve({}) });
    expect(post.status).toBe(400);
  });
});
