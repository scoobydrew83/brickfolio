import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { openNodeDb } from '../db/node';
import type { DB } from '../db/types';
import { APP_VERSION, cachedUpdateStatus, checkForUpdate, compareVersions } from './updates';

let db: DB;
const NOW = new Date('2026-11-06T12:00:00Z');
const later = (h: number) => new Date(NOW.getTime() + h * 3_600_000);
const release = (tag: string) => vi.fn(async (_u: string | URL | Request, _i?: RequestInit) => Response.json({ tag_name: tag, html_url: `https://github.com/scoobydrew83/brickfolio/releases/tag/${tag}` }));
const bump = (v: string) => v.split('.').map((n, i) => (i === 1 ? Number(n) + 1 : i === 2 ? 0 : Number(n))).join('.');

beforeEach(() => { db = openNodeDb(':memory:').db; process.env.UPDATE_CHECK = 'on'; });
afterEach(() => { process.env.UPDATE_CHECK = 'off'; delete process.env.DEMO_MODE; });

it('compares versions', () => {
  expect(compareVersions('0.12.0', '0.12.1')).toBe(-1);
  expect(compareVersions('0.13.0', '0.12.9')).toBe(1);
  expect(compareVersions('v1.0', '1.0.0')).toBe(0);
  expect(compareVersions('0.10.0', '0.9.0')).toBe(1); // numbers, not text
  expect(compareVersions('1.2.3-beta.1', '1.2.3')).toBe(0);
});

it('asks GitHub at most once a day, and says when a newer release is out', async () => {
  const newer = bump(APP_VERSION);
  const f = release(`v${newer}`);
  const r = await checkForUpdate(db, { fetchImpl: f as unknown as typeof fetch, now: NOW });
  expect(r).toEqual({ current: APP_VERSION, enabled: true, latest: newer, updateAvailable: true, url: `https://github.com/scoobydrew83/brickfolio/releases/tag/v${newer}`, checkedAt: NOW.toISOString(), error: null });
  expect(String(f.mock.calls[0][0])).toBe('https://api.github.com/repos/scoobydrew83/brickfolio/releases/latest');
  expect((f.mock.calls[0][1]!.headers as Record<string, string>)['User-Agent']).toBe(`Brickfolio/${APP_VERSION}`);
  await checkForUpdate(db, { fetchImpl: f as unknown as typeof fetch, now: later(5) });
  expect(f).toHaveBeenCalledTimes(1); // still fresh
  expect((await cachedUpdateStatus(db)).updateAvailable).toBe(true);
  const same = release(`v${APP_VERSION}`);
  expect(await checkForUpdate(db, { fetchImpl: same as unknown as typeof fetch, now: later(25) })).toMatchObject({ latest: APP_VERSION, updateAvailable: false });
  expect(await checkForUpdate(db, { fetchImpl: release('v0.0.1') as unknown as typeof fetch, now: later(26), force: true })).toMatchObject({ updateAvailable: false }); // older
});

it('keeps the last answer when GitHub fails, and waits a day before asking again', async () => {
  await checkForUpdate(db, { fetchImpl: release(`v${bump(APP_VERSION)}`) as unknown as typeof fetch, now: NOW });
  const down = vi.fn(async () => new Response('nope', { status: 503 }));
  const r = await checkForUpdate(db, { fetchImpl: down as unknown as typeof fetch, now: later(25) });
  expect(r).toMatchObject({ updateAvailable: true, error: expect.stringContaining('503') });
  await checkForUpdate(db, { fetchImpl: down as unknown as typeof fetch, now: later(26) });
  expect(down).toHaveBeenCalledTimes(1);
  const junk = vi.fn(async () => Response.json({ tag_name: 'nightly' }));
  expect(await checkForUpdate(db, { fetchImpl: junk as unknown as typeof fetch, now: later(60) })).toMatchObject({ error: expect.stringContaining('no release version') });
});

it('makes no request when turned off or in demo mode', async () => {
  const f = release('v99.0.0');
  process.env.UPDATE_CHECK = 'off';
  expect(await checkForUpdate(db, { fetchImpl: f as unknown as typeof fetch, now: NOW, force: true })).toEqual({ current: APP_VERSION, enabled: false, latest: null, updateAvailable: false, url: null, checkedAt: null, error: null });
  process.env.UPDATE_CHECK = 'on';
  process.env.DEMO_MODE = 'on';
  expect((await checkForUpdate(db, { fetchImpl: f as unknown as typeof fetch, now: NOW, force: true })).enabled).toBe(false);
  expect(f).not.toHaveBeenCalled();
});
