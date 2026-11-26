import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { openNodeDb } from '../db/node';
import type { DB } from '../db/types';
import { wishlist } from '../db/schema';
import { alertChannels, alertFormat, alertRequest, alertsFromEnv, notifyPriceSwings, notifySyncHealth, notifyUnderTarget, priceSwingPct, underTargetCount, type Alert } from './alerts';

vi.mock('server-only', () => ({}));

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

it('alerts once on a retailer offer under target, separately from the BrickLink price, and re-arms when it runs out', async () => {
  const { recordPrice } = await import('./prices');
  const offer = (amount: number, observedAt: string, o: { condition?: 'N' | 'U'; currency?: string; source?: string } = {}) =>
    recordPrice(db, { itemKind: 'set', itemId: '75192-1', source: o.source ?? 'retailer:lego', type: 'offer', condition: o.condition ?? 'N', currency: o.currency ?? 'USD', amount, observedAt, url: 'https://www.lego.com/75192' });
  const day = (d: string) => new Date(`2026-11-${d}T12:00:00Z`);
  await wish('75192-1', 'Millennium Falcon', 650, 800); // BrickLink average stays above target
  await offer(700, '2026-11-05T09:00:00Z'); // above target
  await offer(500, '2026-11-05T09:00:00Z', { condition: 'U' }); // wrong condition for a New wish
  await offer(500, '2026-11-05T09:00:00Z', { currency: 'EUR' }); // other currency
  expect(await notifyUnderTarget(db, send, day('06'))).toBeNull();
  expect(sent).toHaveLength(0);

  await offer(599.99, '2026-11-06T09:00:00Z', { source: 'retailer:target' });
  expect(await underTargetCount(db, day('06'))).toBe(1);
  await notifyUnderTarget(db, send, day('06'));
  expect(sent).toHaveLength(1);
  expect(sent[0]).toMatchObject({ title: 'Millennium Falcon: Target offer under your target', url: 'https://www.lego.com/75192', items: [{ setNo: '75192', offer: 599.99, source: 'retailer:target', target: 650 }] });
  expect(sent[0].message).toBe('75192 Millennium Falcon: Target offer $599.99, your target $650.00 (https://www.lego.com/75192)');

  await offer(550, '2026-11-06T10:00:00Z'); // lower, same day: no second alert
  await notifyUnderTarget(db, send, day('06'));
  expect(sent).toHaveLength(1);

  // A BrickLink drop still alerts on its own.
  await setPrice('75192-1', 640);
  await notifyUnderTarget(db, send, day('06'));
  expect(sent).toHaveLength(2);
  expect(sent[1].items).toEqual([{ setNo: '75192', name: 'Millennium Falcon', avgSold: 640, target: 650 }]);

  // Four days on, the offers are too old: re-armed, so a new offer alerts again.
  await notifyUnderTarget(db, send, day('10'));
  expect((await db.select().from(wishlist).get())!.offerAlertedAt).toBeNull();
  await offer(620, '2026-11-10T09:00:00Z');
  await notifyUnderTarget(db, send, day('10'));
  expect(sent).toHaveLength(3);
});

describe('price swings', () => {
  const day = (d: number) => new Date(Date.UTC(2026, 10, d));
  const swingSend = async (a: Alert) => { sent.push(a); };

  it('measures from the first price, then alerts once per swing either way', async () => {
    wish('10316-1', 'Rivendell', null, 500);
    wish('10307-1', 'Eiffel Tower', 520, 600);
    expect(await notifyPriceSwings(db, swingSend, 10, day(1))).toBeNull();
    expect(sent).toHaveLength(0); // first prices only set the base

    setPrice('10316-1', 460); // −8%: not yet
    setPrice('10307-1', 660); // +10%
    await notifyPriceSwings(db, swingSend, 10, day(2));
    expect(sent).toHaveLength(1);
    expect(sent[0].title).toBe('Eiffel Tower is up +10.0%');
    expect(sent[0].message).toContain('up +10.0% since 2026-11-01');
    expect(sent[0].message).toContain('your target');
    expect(sent[0].items[0]).toMatchObject({ setNo: '10307', from: 600, avgSold: 660, changePct: 10 });

    setPrice('10316-1', 440); // drift adds up: −12% from 500
    await notifyPriceSwings(db, swingSend, 10, day(3));
    expect(sent).toHaveLength(2);
    expect(sent[1].title).toBe('Rivendell is down −12.0%');

    await notifyPriceSwings(db, swingSend, 10, day(4)); // nothing moved since
    expect(sent).toHaveLength(2);
  });

  it('groups several swings, skips errors, and keeps the base when sending fails', async () => {
    wish('10316-1', 'Rivendell', null, 500);
    wish('10307-1', 'Eiffel Tower', null, 600);
    await notifyPriceSwings(db, swingSend, 10, day(1));
    setPrice('10316-1', 400);
    setPrice('10307-1', 500);
    expect(await notifyPriceSwings(db, async () => { throw new Error('boom'); }, 10, day(2))).toBe('Price swing alert not sent: boom');
    await notifyPriceSwings(db, swingSend, 10, day(3));
    expect(sent).toHaveLength(1);
    expect(sent[0].title).toBe('2 wishlist sets dropped 10% or more');
    expect(sent[0].items.map((i) => i.setNo)).toEqual(['10316', '10307']); // biggest move first

    db.update(wishlist).set({ avgSold: 100, blError: 'lookup failed' }).where(eq(wishlist.setNo, '10316-1')).run();
    await notifyPriceSwings(db, swingSend, 10, day(4));
    expect(sent).toHaveLength(1);
  });

  it('is off at 0 and reads PRICE_SWING_PCT', async () => {
    wish('10316-1', 'Rivendell', null, 500);
    expect(await notifyPriceSwings(db, swingSend, 0)).toBeNull();
    expect((await db.select().from(wishlist).all())[0].swingBase).toBeNull();
    expect(priceSwingPct()).toBe(10);
    process.env.PRICE_SWING_PCT = '0';
    expect(priceSwingPct()).toBe(0);
    process.env.PRICE_SWING_PCT = '25';
    expect(priceSwingPct()).toBe(25);
    delete process.env.PRICE_SWING_PCT;
  });
});

describe('alert channels', () => {
  // Made at run time so no token-shaped literal is committed.
  const token = () => crypto.randomUUID();
  const alert: Alert = { title: 'Eiffel Tower is under your target', message: '10307 Eiffel Tower: average sold $500.00', url: 'https://bricks.example/wishlist', items: [] };
  const recorder = () => {
    const calls: { url: string; headers: Record<string, string>; body: string }[] = [];
    const f = (async (url: string, init: RequestInit) => { calls.push({ url: String(url), headers: init.headers as Record<string, string>, body: String(init.body) }); return new Response('ok'); }) as unknown as typeof fetch;
    return { calls, f };
  };

  it('finds every configured channel and none when nothing is set', () => {
    expect(alertChannels({})).toEqual([]);
    const env = { ALERT_WEBHOOK_URL: 'https://n8n.example/webhook/bricks', ALERT_EMAIL_TO: 'me@example.com', ALERT_TELEGRAM_BOT_TOKEN: token(), ALERT_TELEGRAM_CHAT_ID: '42', ALERT_PUSHOVER_TOKEN: token(), ALERT_PUSHOVER_USER: token(), ALERT_GOTIFY_URL: 'https://gotify.example/', ALERT_GOTIFY_TOKEN: token() };
    expect(alertChannels(env).map((c) => c.name)).toEqual(['Webhook', 'Email', 'Telegram', 'Pushover', 'Gotify']);
    // Half-configured channels are left out.
    expect(alertChannels({ ALERT_TELEGRAM_BOT_TOKEN: token(), ALERT_GOTIFY_URL: 'https://gotify.example' })).toEqual([]);
  });

  it('posts Telegram, Pushover and Gotify messages in their formats', async () => {
    const { calls, f } = recorder();
    const tg = token(), po = token(), user = token(), go = token();
    const env = { ALERT_TELEGRAM_BOT_TOKEN: tg, ALERT_TELEGRAM_CHAT_ID: '42', ALERT_PUSHOVER_TOKEN: po, ALERT_PUSHOVER_USER: user, ALERT_GOTIFY_URL: 'https://gotify.example/', ALERT_GOTIFY_TOKEN: go };
    for (const c of alertChannels(env, f)) await c.send(alert);
    expect(calls[0].url).toBe(`https://api.telegram.org/bot${tg}/sendMessage`);
    expect(JSON.parse(calls[0].body)).toMatchObject({ chat_id: '42', text: `${alert.title}\n${alert.message}\n${alert.url}` });
    expect(calls[1].url).toBe('https://api.pushover.net/1/messages.json');
    expect(JSON.parse(calls[1].body)).toMatchObject({ token: po, user, title: alert.title, message: alert.message, url: alert.url });
    expect(calls[2].url).toBe('https://gotify.example/message');
    expect(calls[2].headers['X-Gotify-Key']).toBe(go);
    expect(JSON.parse(calls[2].body)).toMatchObject({ title: alert.title, priority: 5 });
  });

  it('counts an alert as sent when one channel works, and keeps the others’ errors', async () => {
    let n = 0;
    const f = (async () => (n++ === 0 ? new Response('no', { status: 500, statusText: 'Server Error' }) : new Response('ok'))) as unknown as typeof fetch;
    const s = alertsFromEnv(f, { ALERT_WEBHOOK_URL: 'https://ntfy.sh/x', ALERT_PUSHOVER_TOKEN: token(), ALERT_PUSHOVER_USER: token() })!;
    expect(s.channels).toEqual(['ntfy', 'Pushover']);
    await s(alert);
    expect(s.problems).toEqual(['ntfy: Alert webhook answered 500 Server Error']);
    const down = alertsFromEnv((async () => new Response('no', { status: 503 })) as unknown as typeof fetch, { ALERT_WEBHOOK_URL: 'https://ntfy.sh/x' })!;
    await expect(down(alert)).rejects.toThrow('ntfy: Alert webhook answered 503');
  });

  it('says so when ALERT_EMAIL_TO is set without an email provider', async () => {
    const [email] = alertChannels({ ALERT_EMAIL_TO: 'me@example.com' });
    await expect(email.send(alert)).rejects.toThrow(/EMAIL_PROVIDER/);
  });
});

describe('sync health alerts', () => {
  const run = (o: Partial<{ failed: boolean; total: number; errors: number; problems: string[] }> = {}) => ({ failed: false, total: 80, errors: 0, problems: [], ...o });

  it('alerts on problems once, again when they change, and once when the sync is clean again', async () => {
    expect(await notifySyncHealth(db, send, run())).toBeNull();
    expect(sent).toHaveLength(0); // clean from the start: nothing to say
    await notifySyncHealth(db, send, run({ errors: 2, problems: ['Image cache: EACCES'] }));
    expect(sent[0]).toMatchObject({ title: 'Brickfolio sync finished with problems', message: '2 of 80 set lookups failed\nImage cache: EACCES' });
    await notifySyncHealth(db, send, run({ errors: 2, problems: ['Image cache: EACCES'] }));
    expect(sent).toHaveLength(1); // the same problem the next night
    await notifySyncHealth(db, send, run({ failed: true, problems: ['database is locked'] }));
    expect(sent[1].title).toBe('Brickfolio sync failed');
    await notifySyncHealth(db, send, run());
    expect(sent[2].title).toBe('Brickfolio sync is working again');
    await notifySyncHealth(db, send, run());
    expect(sent).toHaveLength(3);
  });

  it('is off with SYNC_ALERT=off, and retries after a failed send', async () => {
    expect(await notifySyncHealth(db, send, run({ errors: 1 }), { SYNC_ALERT: 'off' })).toBeNull();
    expect(sent).toHaveLength(0);
    expect(await notifySyncHealth(db, async () => { throw new Error('down'); }, run({ errors: 1 }))).toBe('Sync alert not sent: down');
    await notifySyncHealth(db, send, run({ errors: 1 }));
    expect(sent).toHaveLength(1);
  });
});
