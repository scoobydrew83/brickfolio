import { afterEach, beforeEach, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { openNodeDb } from '../db/node';
import type { DB } from '../db/types';
import { wishlist } from '../db/schema';
import { alertFormat, alertRequest, alertsFromEnv, notifyUnderTarget, underTargetCount, type Alert } from './alerts';

let db: DB;
let sent: Alert[];
const send = async (a: Alert) => { sent.push(a); };
const wish = (setNo: string, name: string, target: number | null, avgSold: number | null) =>
  db.insert(wishlist).values({ setNo, name, condition: 'New', target, avgSold }).run();
const setPrice = (setNo: string, avgSold: number) => db.update(wishlist).set({ avgSold }).where(eq(wishlist.setNo, setNo)).run();

beforeEach(() => { db = openNodeDb(':memory:').db; sent = []; });
afterEach(() => { delete process.env.ALERT_WEBHOOK_URL; delete process.env.ALERT_WEBHOOK_FORMAT; delete process.env.APP_URL; });

it('recognizes ntfy and Discord, and falls back to JSON', () => {
  expect(alertFormat('https://ntfy.sh/my-bricks')).toBe('ntfy');
  expect(alertFormat('https://ntfy.example.com/topic')).toBe('ntfy');
  expect(alertFormat('https://discord.com/api/webhooks/1/abc')).toBe('discord');
  expect(alertFormat('https://hooks.example.com/x')).toBe('json');
  expect(alertFormat('https://hooks.example.com/x', 'ntfy')).toBe('ntfy');
});

it('builds a request per format', () => {
  const a: Alert = { title: 'Rivendell is under your target', message: '10316 Rivendell: average sold $418.00, your target $430.00', url: 'https://bricks.example/wishlist', items: [] };
  expect(alertRequest('ntfy', a)).toEqual({ headers: { 'Content-Type': 'text/plain; charset=utf-8', Title: 'Rivendell is under your target', Tags: 'moneybag', Click: 'https://bricks.example/wishlist' }, body: a.message });
  expect(JSON.parse(alertRequest('discord', a).body).content).toContain('**Rivendell is under your target**');
  expect(JSON.parse(alertRequest('json', a).body)).toEqual(a);
});

it('alerts once per drop, and again after the price goes back above target', async () => {
  wish('10316-1', 'Rivendell', 430, 418);
  wish('10307-1', 'Eiffel Tower', 520, 579);
  wish('10295-1', 'Porsche 911', null, 100);
  expect(await underTargetCount(db)).toBe(1);

  expect(await notifyUnderTarget(db, send)).toBeNull();
  expect(sent).toHaveLength(1);
  expect(sent[0].title).toBe('Rivendell is under your target');
  expect(sent[0].message).toBe('10316 Rivendell: average sold $418.00, your target $430.00');

  await notifyUnderTarget(db, send); // nothing new
  expect(sent).toHaveLength(1);

  setPrice('10307-1', 510); // Eiffel Tower drops under too
  await notifyUnderTarget(db, send);
  expect(sent[1].title).toBe('Eiffel Tower is under your target');

  setPrice('10316-1', 450); // back above: re-armed
  await notifyUnderTarget(db, send);
  setPrice('10316-1', 425);
  await notifyUnderTarget(db, send);
  expect(sent.map((a) => a.items.map((i) => i.setNo))).toEqual([['10316'], ['10307'], ['10316']]);
});

it('groups several sets in one message and reports a failing webhook without marking them', async () => {
  wish('10316-1', 'Rivendell', 430, 418);
  wish('10307-1', 'Eiffel Tower', 520, 500);
  const err = await notifyUnderTarget(db, async () => { throw new Error('Alert webhook answered 500'); });
  expect(err).toBe('Wishlist alert not sent: Alert webhook answered 500');
  await notifyUnderTarget(db, send);
  expect(sent[0].title).toBe('2 wishlist sets are under your target');
});

it('posts to the configured webhook', async () => {
  process.env.ALERT_WEBHOOK_URL = 'https://ntfy.sh/my-bricks';
  const calls: { url: string; init: RequestInit }[] = [];
  const s = alertsFromEnv(async (url, init) => { calls.push({ url: String(url), init: init! }); return new Response('ok'); });
  await s!({ title: 'T', message: 'M', url: null, items: [] });
  expect(calls[0].url).toBe('https://ntfy.sh/my-bricks');
  expect(calls[0].init.method).toBe('POST');
  expect(calls[0].init.body).toBe('M');
  process.env.ALERT_WEBHOOK_URL = 'not a url';
  expect(alertsFromEnv()).toBeNull();
});
