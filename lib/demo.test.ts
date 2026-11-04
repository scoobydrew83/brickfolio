import { afterEach, expect, it, vi } from 'vitest';
import { openNodeDb } from './db/node';
import { seedDemo } from './db/seed.mjs';
import { DEMO_ERROR, demoBlocks, isDemo } from './demo';
import { alertsFromEnv } from './service/alerts';

vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
const { api } = await import('./api');
const session = await import('./session');

afterEach(() => vi.unstubAllEnvs());

it('is off unless DEMO_MODE is on', () => {
  expect(isDemo()).toBe(false);
  vi.stubEnv('DEMO_MODE', 'on');
  expect(isDemo()).toBe(true);
  expect(demoBlocks('GET')).toBe(false);
  expect(demoBlocks('POST')).toBe(true);
  expect(demoBlocks('DELETE')).toBe(true);
});

it('refuses API writes in demo mode and still serves reads', async () => {
  vi.stubEnv('DEMO_MODE', 'on');
  vi.stubEnv('AUTH_MODE', 'none');
  const route = api(async () => Response.json({ ok: true }));
  const params = { params: Promise.resolve({}) };
  const post = await route(new Request('http://x/api/v1/sets', { method: 'POST' }), params);
  expect(post.status).toBe(403);
  expect(await post.json()).toEqual({ error: DEMO_ERROR });
  expect((await route(new Request('http://x/api/v1/sets'), params)).status).toBe(200);
});

it('switches off BrickLink, Rebrickable and alerts in demo mode', () => {
  vi.stubEnv('DEMO_MODE', 'on');
  vi.stubEnv('BRICKLINK_CONSUMER_KEY', 'a'); vi.stubEnv('BRICKLINK_CONSUMER_SECRET', 'b');
  vi.stubEnv('BRICKLINK_TOKEN', 'c'); vi.stubEnv('BRICKLINK_TOKEN_SECRET', 'd');
  vi.stubEnv('REBRICKABLE_API_KEY', 'k');
  vi.stubEnv('ALERT_WEBHOOK_URL', 'https://ntfy.sh/topic');
  expect(session.bricklink()).toBeNull();
  expect(session.brickStore()).toBeNull();
  expect(session.rebrickable()).toBeNull();
  expect(alertsFromEnv()).toBeNull();
});

it('seeds demo sets, themes, a wishlist, minifigs, part prices and barcodes', () => {
  const { sqlite } = openNodeDb(':memory:');
  expect(seedDemo(sqlite)).toBe(21);
  const count = (sql: string) => (sqlite.prepare(sql).get() as { n: number }).n;
  expect(count('SELECT count(*) AS n FROM sets WHERE theme_id IS NOT NULL')).toBe(21);
  expect(count('SELECT count(*) AS n FROM wishlist')).toBe(4);
  expect(count('SELECT count(*) AS n FROM history')).toBe(30);
  expect(count('SELECT count(*) AS n FROM minifigs')).toBe(4);
  expect(count('SELECT count(*) AS n FROM cmf_figs')).toBe(12);
  expect(count('SELECT count(*) AS n FROM part_prices')).toBe(6);
  expect(count('SELECT count(*) AS n FROM designer_projects')).toBe(3);
  expect(count("SELECT count(*) AS n FROM identifiers WHERE kind = 'set' AND scheme = 'gtin' AND source = 'user' AND verified = 1")).toBe(3);
});
