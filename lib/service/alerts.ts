// Alerts: one message when wishlist sets drop under your target price (and price swings, retirements, sync problems),
// sent to every channel you configure: a webhook (ntfy, Discord, or JSON for n8n and the like), email, Telegram,
// Pushover or Gotify. Off unless one is set (see alertChannels).
import { and, eq, isNotNull, isNull, lte, or, gt } from 'drizzle-orm';
import type { DB } from '../db/types';
import { wishlist } from '../db/schema';
import { displayNo, money } from '../sets';
import { getCurrency } from './sets';
import { bestOffers, type BestOffer } from './offers';
import { sourceLabel } from './prices';
import { isDemo } from '../demo';

export type AlertFormat = 'ntfy' | 'discord' | 'json';
/** One wish in an alert: under target on BrickLink's average sold price (`avgSold`) or on a retailer offer (`offer`). */
/** A price-swing item also has `from` (the price it's measured from) and `changePct` (signed, e.g. -12.5). */
export type AlertItem = { setNo: string; name: string; target: number; avgSold?: number; offer?: number; source?: string; url?: string | null; from?: number; changePct?: number };
export type Alert = { title: string; message: string; url: string | null; items: AlertItem[] };
export type Send = (alert: Alert) => Promise<void>;

/** ntfy and Discord are recognized by host; anything else gets JSON. ALERT_WEBHOOK_FORMAT overrides. */
export function alertFormat(url: string, override?: string): AlertFormat {
  if (override === 'ntfy' || override === 'discord' || override === 'json') return override;
  const host = new URL(url).hostname;
  if (host === 'ntfy.sh' || host.startsWith('ntfy.')) return 'ntfy';
  if (host === 'discord.com' || host.endsWith('.discord.com') || host === 'discordapp.com') return 'discord';
  return 'json';
}

/** The HTTP request for one alert in the given format. */
export function alertRequest(format: AlertFormat, a: Alert): { headers: Record<string, string>; body: string } {
  if (format === 'ntfy') {
    // Header values must be ASCII; the body carries the full text.
    const headers: Record<string, string> = { 'Content-Type': 'text/plain; charset=utf-8', Title: a.title.replace(/[^\x20-\x7e]/g, ''), Tags: 'moneybag' };
    if (a.url) headers.Click = a.url;
    return { headers, body: a.message };
  }
  if (format === 'discord') {
    return { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: `**${a.title}**\n${a.message}${a.url ? `\n${a.url}` : ''}`.slice(0, 2000) }) };
  }
  return { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(a) };
}

/** One place alerts go. `send` throws on failure; `name` labels it in errors and Settings. */
export type Channel = { name: string; send: (a: Alert) => Promise<void> };
/** Every configured channel at once. An alert counts as sent when at least one channel took it; the others' errors
 * are kept in `problems` (the sync shows them) so a broken channel can't make a working one repeat the alert. */
export type MultiSend = Send & { channels: string[]; problems: string[] };
type Env = Record<string, string | undefined>;

const post = async (fetchImpl: typeof fetch, url: string, headers: Record<string, string>, body: string, what: string) => {
  const res = await fetchImpl(url, { method: 'POST', headers, body, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`${what} answered ${res.status} ${res.statusText}`.trim());
};
const plain = (a: Alert) => `${a.message}${a.url ? `\n${a.url}` : ''}`;
const httpUrl = (u: string | undefined) => !!u && /^https?:\/\//.test(u);

/**
 * The alert channels set in the environment:
 * - ALERT_WEBHOOK_URL (ntfy, Discord, or JSON to any URL: n8n, Home Assistant, a script), ALERT_WEBHOOK_FORMAT
 * - ALERT_EMAIL_TO (comma-separated), through the email provider set for sign-in mail (EMAIL_PROVIDER, EMAIL_FROM)
 * - ALERT_TELEGRAM_BOT_TOKEN and ALERT_TELEGRAM_CHAT_ID
 * - ALERT_PUSHOVER_TOKEN and ALERT_PUSHOVER_USER
 * - ALERT_GOTIFY_URL and ALERT_GOTIFY_TOKEN
 */
export function alertChannels(env: Env = process.env, fetchImpl: typeof fetch = fetch): Channel[] {
  const out: Channel[] = [];
  const hook = env.ALERT_WEBHOOK_URL;
  if (httpUrl(hook)) {
    const format = alertFormat(hook!, env.ALERT_WEBHOOK_FORMAT);
    out.push({ name: format === 'json' ? 'Webhook' : format === 'ntfy' ? 'ntfy' : 'Discord', send: (a) => { const r = alertRequest(format, a); return post(fetchImpl, hook!, r.headers, r.body, 'Alert webhook'); } });
  }
  const to = (env.ALERT_EMAIL_TO ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  if (to.length) {
    out.push({ name: 'Email', send: async (a) => {
      const { sendEmail, emailConfigured } = await import('../email');
      if (!emailConfigured(env)) throw new Error('ALERT_EMAIL_TO is set but email isn\u2019t (EMAIL_PROVIDER and EMAIL_FROM)');
      const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const html = `<p><b>${esc(a.title)}</b></p><p>${esc(a.message).replace(/\n/g, '<br>')}</p>${a.url ? `<p><a href="${esc(a.url)}">${esc(a.url)}</a></p>` : ''}`;
      for (const addr of to) await sendEmail({ to: addr, subject: a.title, text: plain(a), html }, env);
    } });
  }
  if (env.ALERT_TELEGRAM_BOT_TOKEN && env.ALERT_TELEGRAM_CHAT_ID) {
    const url = `https://api.telegram.org/bot${env.ALERT_TELEGRAM_BOT_TOKEN}/sendMessage`;
    out.push({ name: 'Telegram', send: (a) => post(fetchImpl, url, { 'Content-Type': 'application/json' }, JSON.stringify({ chat_id: env.ALERT_TELEGRAM_CHAT_ID, text: `${a.title}\n${plain(a)}`.slice(0, 4096), disable_web_page_preview: true }), 'Telegram') });
  }
  if (env.ALERT_PUSHOVER_TOKEN && env.ALERT_PUSHOVER_USER) {
    out.push({ name: 'Pushover', send: (a) => post(fetchImpl, 'https://api.pushover.net/1/messages.json', { 'Content-Type': 'application/json' },
      JSON.stringify({ token: env.ALERT_PUSHOVER_TOKEN, user: env.ALERT_PUSHOVER_USER, title: a.title.slice(0, 250), message: a.message.slice(0, 1024), ...(a.url ? { url: a.url.slice(0, 512) } : {}) }), 'Pushover') });
  }
  if (httpUrl(env.ALERT_GOTIFY_URL) && env.ALERT_GOTIFY_TOKEN) {
    const url = `${env.ALERT_GOTIFY_URL!.replace(/\/$/, '')}/message`;
    out.push({ name: 'Gotify', send: (a) => post(fetchImpl, url, { 'Content-Type': 'application/json', 'X-Gotify-Key': env.ALERT_GOTIFY_TOKEN! },
      JSON.stringify({ title: a.title, message: plain(a), priority: 5, ...(a.url ? { extras: { 'client::notification': { click: { url: a.url } } } } : {}) }), 'Gotify') });
  }
  return out;
}

/** A sender for every configured channel, or null when none is set (or in the demo). */
export function alertsFromEnv(fetchImpl: typeof fetch = fetch, env: Env = process.env): MultiSend | null {
  const channels = isDemo() ? [] : alertChannels(env, fetchImpl);
  if (!channels.length) return null;
  const problems: string[] = [];
  const send = (async (a: Alert) => {
    const results = await Promise.allSettled(channels.map((c) => c.send(a)));
    const failed = results.flatMap((r, i) => (r.status === 'rejected' ? [`${channels[i].name}: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`.slice(0, 200)] : []));
    if (failed.length === channels.length) throw new Error(failed.join('; '));
    for (const f of failed) if (!problems.includes(f)) problems.push(f);
  }) as MultiSend;
  send.channels = channels.map((c) => c.name);
  send.problems = problems;
  return send;
}

const under = and(isNotNull(wishlist.target), isNotNull(wishlist.avgSold), isNull(wishlist.blError), lte(wishlist.avgSold, wishlist.target));
type Wish = typeof wishlist.$inferSelect;

/** Each wish's best recent offer in its own condition, in the collection currency, when it's at or under target. */
async function offersUnderTarget(db: DB, wishes: Wish[], currency: string, now = new Date()): Promise<Map<number, BestOffer>> {
  const withTarget = wishes.filter((w) => w.target != null);
  const best = await bestOffers(db, withTarget.map((w) => w.setNo), { currency, now });
  const out = new Map<number, BestOffer>();
  for (const w of withTarget) {
    const o = best.get(w.setNo)?.[w.condition === 'Used' ? 'U' : 'N'];
    if (o && o.amount <= w.target!) out.set(w.id, o);
  }
  return out;
}

/** How many wishes are under target right now, on BrickLink's average or a recent offer (for the nav badge). */
export async function underTargetCount(db: DB, now = new Date()): Promise<number> {
  const avg = new Set((await db.select({ id: wishlist.id }).from(wishlist).where(under).all()).map((r) => r.id));
  const offers = await offersUnderTarget(db, await db.select().from(wishlist).all(), await getCurrency(db), now);
  return new Set([...avg, ...offers.keys()]).size;
}

/**
 * Sends one alert for wishes that went under target since their last alert, and marks them: on BrickLink's average
 * sold price, or on a retailer offer from the last OFFER_MAX_AGE_DAYS (kept apart, so each alerts once). Wishes that
 * went back above target, lost their price or whose offer ran out are re-armed so a later drop alerts again.
 * Returns an error message instead of throwing, so a broken webhook never fails the sync.
 */
export async function notifyUnderTarget(db: DB, send: Send, now = new Date()): Promise<string | null> {
  await db.update(wishlist).set({ alertedAt: null })
    .where(and(isNotNull(wishlist.alertedAt), or(isNull(wishlist.target), isNull(wishlist.avgSold), gt(wishlist.avgSold, wishlist.target))));
  const currency = await getCurrency(db);
  const all = await db.select().from(wishlist).all();
  const offers = await offersUnderTarget(db, all, currency, now);
  for (const w of all) if (w.offerAlertedAt && !offers.has(w.id)) await db.update(wishlist).set({ offerAlertedAt: null }).where(eq(wishlist.id, w.id));

  const fresh = await db.select().from(wishlist).where(and(under, isNull(wishlist.alertedAt))).all();
  const freshOffers = all.filter((w) => offers.has(w.id) && !w.offerAlertedAt);
  if (!fresh.length && !freshOffers.length) return null;
  const name = (w: Wish) => w.name ?? displayNo(w.setNo);
  const items: AlertItem[] = [
    ...fresh.map((w): AlertItem => ({ setNo: displayNo(w.setNo), name: name(w), avgSold: w.avgSold!, target: w.target! })),
    ...freshOffers.map((w): AlertItem => { const o = offers.get(w.id)!; return { setNo: displayNo(w.setNo), name: name(w), offer: o.amount, source: o.source, url: o.url, target: w.target! }; }),
  ];
  const lines = items.map((i) => i.offer != null
    ? `${i.setNo} ${i.name}: ${sourceLabel(i.source!)} offer ${money(i.offer, currency)}, your target ${money(i.target, currency)}${i.url ? ` (${i.url})` : ''}`
    : `${i.setNo} ${i.name}: average sold ${money(i.avgSold!, currency)}, your target ${money(i.target, currency)}`);
  const base = process.env.APP_URL?.replace(/\/$/, '');
  const one = items.length === 1 ? items[0] : null;
  const alert: Alert = {
    title: one ? (one.offer != null ? `${one.name}: ${sourceLabel(one.source!)} offer under your target` : `${one.name} is under your target`) : `${items.length} wishlist sets are under your target`,
    message: lines.join('\n'),
    url: one?.url ?? (base ? `${base}/wishlist` : null),
    items,
  };
  try {
    await send(alert);
  } catch (e) {
    return `Wishlist alert not sent: ${e instanceof Error ? e.message : String(e)}`;
  }
  const at = now.toISOString();
  for (const w of fresh) await db.update(wishlist).set({ alertedAt: at }).where(eq(wishlist.id, w.id));
  for (const w of freshOffers) await db.update(wishlist).set({ offerAlertedAt: at }).where(eq(wishlist.id, w.id));
  return null;
}

/** PRICE_SWING_PCT (default 10; 0 turns it off): alert when a wish's average sold price moves this many percent. */
export const priceSwingPct = () => {
  const n = Number(process.env.PRICE_SWING_PCT ?? 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 1000) : 0;
};

/**
 * Sends one alert for wishes whose BrickLink average sold price moved `pct` percent or more, up or down, since the
 * price it's measured from, with or without a target. That price is the first one seen for the wish, then the price
 * at its last swing alert, so a slow drift alerts once it adds up and each swing alerts once. A wish with no price
 * (or a lookup error) is skipped and keeps its base; a new currency starts over. Returns an error message instead of
 * throwing; when sending fails the bases are kept, so the next sync tries again.
 */
export async function notifyPriceSwings(db: DB, send: Send, pct = priceSwingPct(), now = new Date()): Promise<string | null> {
  if (!pct) return null;
  const currency = await getCurrency(db);
  const at = now.toISOString();
  const swung: { w: Wish; changePct: number }[] = [];
  for (const w of await db.select().from(wishlist).where(and(isNotNull(wishlist.avgSold), isNull(wishlist.blError))).all()) {
    if (!(w.avgSold! > 0)) continue;
    if (w.swingBase == null || !(w.swingBase > 0) || w.swingCurrency !== currency) {
      await db.update(wishlist).set({ swingBase: w.avgSold, swingCurrency: currency, swingBaseAt: at }).where(eq(wishlist.id, w.id));
      continue;
    }
    const changePct = ((w.avgSold! - w.swingBase) / w.swingBase) * 100;
    // A hair under pct from rounding still counts (a 10.00% drop computed as 9.9999…).
    if (Math.abs(changePct) >= pct - 1e-9) swung.push({ w, changePct });
  }
  if (!swung.length) return null;
  swung.sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct));
  const name = (w: Wish) => w.name ?? displayNo(w.setNo);
  const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(1)}%`;
  const since = (iso: string | null) => (iso ? ` since ${iso.slice(0, 10)}` : '');
  const lines = swung.map(({ w, changePct }) => {
    const t = w.target != null ? `, your target ${money(w.target, currency)}` : '';
    return `${displayNo(w.setNo)} ${name(w)}: ${changePct < 0 ? 'down' : 'up'} ${signed(changePct)}${since(w.swingBaseAt)}, average sold ${money(w.swingBase!, currency)} → ${money(w.avgSold!, currency)}${t}`;
  });
  const base = process.env.APP_URL?.replace(/\/$/, '');
  const one = swung.length === 1 ? swung[0] : null;
  const allDown = swung.every((s) => s.changePct < 0);
  const allUp = swung.every((s) => s.changePct > 0);
  const alert: Alert = {
    title: one
      ? `${name(one.w)} is ${one.changePct < 0 ? 'down' : 'up'} ${signed(one.changePct)}`
      : `${swung.length} wishlist sets ${allDown ? 'dropped' : allUp ? 'went up' : 'moved'} ${pct}% or more`,
    message: lines.join('\n'),
    url: base ? `${base}/wishlist` : null,
    items: swung.map(({ w, changePct }) => ({
      setNo: displayNo(w.setNo), name: name(w), avgSold: w.avgSold!, target: w.target ?? 0, from: w.swingBase!, changePct: Math.round(changePct * 10) / 10,
    })),
  };
  try {
    await send(alert);
  } catch (e) {
    return `Price swing alert not sent: ${e instanceof Error ? e.message : String(e)}`;
  }
  for (const { w } of swung) await db.update(wishlist).set({ swingBase: w.avgSold, swingCurrency: currency, swingBaseAt: at }).where(eq(wishlist.id, w.id));
  return null;
}

/** SYNC_ALERT=off turns off the sync-problem alert (on whenever an alert channel is set). */
export const syncAlertOn = (env: Env = process.env) => env.SYNC_ALERT !== 'off';
const SYNC_ALERT_KEY = 'syncAlertLast';

/**
 * One alert when a sync fails or finishes with problems (set lookups that failed, steps that reported errors), and
 * one when the next sync is clean again. The same problem isn't repeated every night: the last alert's text is kept in
 * settings and only a change alerts. `problems` are the sync message's parts minus plain notes (daily limit, time limit).
 * Returns an error message instead of throwing.
 */
export async function notifySyncHealth(db: DB, send: Send, run: { failed: boolean; total: number; errors: number; problems: string[] }, env: Env = process.env): Promise<string | null> {
  if (!syncAlertOn(env)) return null;
  const { settings } = await import('../db/schema');
  const lines = [...(run.errors ? [`${run.errors} of ${run.total} set lookup${run.errors === 1 ? '' : 's'} failed`] : []), ...run.problems];
  const key = lines.length ? `${run.failed ? 'failed' : 'problems'}: ${lines.join('; ')}` : '';
  const last = (await db.select().from(settings).where(eq(settings.key, SYNC_ALERT_KEY)).get())?.value ?? '';
  if (key === last) return null;
  const base = env.APP_URL?.replace(/\/$/, '');
  const alert: Alert = key
    ? { title: run.failed ? 'Brickfolio sync failed' : 'Brickfolio sync finished with problems', message: lines.join('\n'), url: base ? `${base}/settings` : null, items: [] }
    : { title: 'Brickfolio sync is working again', message: 'The last sync finished without problems.', url: base ? `${base}/` : null, items: [] };
  try {
    await send(alert);
  } catch (e) {
    return `Sync alert not sent: ${e instanceof Error ? e.message : String(e)}`;
  }
  await db.insert(settings).values({ key: SYNC_ALERT_KEY, value: key }).onConflictDoUpdate({ target: settings.key, set: { value: key } });
  return null;
}
