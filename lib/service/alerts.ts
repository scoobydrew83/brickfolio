// Wishlist alerts: one message when sets drop under your target price, sent to a webhook you configure.
// ntfy (push to your phone), Discord, or any URL that accepts JSON. Off unless ALERT_WEBHOOK_URL is set.
import { and, eq, isNotNull, isNull, lte, or, gt, sql } from 'drizzle-orm';
import type { DB } from '../db/types';
import { wishlist } from '../db/schema';
import { displayNo, money } from '../sets';
import { getCurrency } from './sets';
import { isDemo } from '../demo';

export type AlertFormat = 'ntfy' | 'discord' | 'json';
export type AlertItem = { setNo: string; name: string; avgSold: number; target: number };
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

/** A sender built from ALERT_WEBHOOK_URL (and ALERT_WEBHOOK_FORMAT), or null when alerts are off. */
export function alertsFromEnv(fetchImpl: typeof fetch = fetch): Send | null {
  const url = process.env.ALERT_WEBHOOK_URL;
  if (isDemo() || !url || !/^https?:\/\//.test(url)) return null;
  const format = alertFormat(url, process.env.ALERT_WEBHOOK_FORMAT);
  return async (a) => {
    const { headers, body } = alertRequest(format, a);
    const res = await fetchImpl(url, { method: 'POST', headers, body, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`Alert webhook answered ${res.status} ${res.statusText}`.trim());
  };
}

const under = and(isNotNull(wishlist.target), isNotNull(wishlist.avgSold), isNull(wishlist.blError), lte(wishlist.avgSold, wishlist.target));

/** How many wishes are under target right now (for the nav badge). */
export async function underTargetCount(db: DB): Promise<number> {
  const [{ n }] = await db.select({ n: sql<number>`count(*)` }).from(wishlist).where(under).all();
  return Number(n);
}

/**
 * Sends one alert for wishes that dropped under target since the last alert, and marks them. Wishes that went
 * back above target (or lost their price) are re-armed so a later drop alerts again. Returns an error message
 * instead of throwing, so a broken webhook never fails the sync.
 */
export async function notifyUnderTarget(db: DB, send: Send): Promise<string | null> {
  await db.update(wishlist).set({ alertedAt: null })
    .where(and(isNotNull(wishlist.alertedAt), or(isNull(wishlist.target), isNull(wishlist.avgSold), gt(wishlist.avgSold, wishlist.target))));
  const fresh = await db.select().from(wishlist).where(and(under, isNull(wishlist.alertedAt))).all();
  if (!fresh.length) return null;
  const currency = await getCurrency(db);
  const items: AlertItem[] = fresh.map((w) => ({ setNo: displayNo(w.setNo), name: w.name ?? displayNo(w.setNo), avgSold: w.avgSold!, target: w.target! }));
  const lines = items.map((i) => `${i.setNo} ${i.name}: average sold ${money(i.avgSold, currency)}, your target ${money(i.target, currency)}`);
  const base = process.env.APP_URL?.replace(/\/$/, '');
  const alert: Alert = {
    title: items.length === 1 ? `${items[0].name} is under your target` : `${items.length} wishlist sets are under your target`,
    message: lines.join('\n'),
    url: base ? `${base}/wishlist` : null,
    items,
  };
  try {
    await send(alert);
  } catch (e) {
    return `Wishlist alert not sent: ${e instanceof Error ? e.message : String(e)}`;
  }
  const at = new Date().toISOString();
  for (const w of fresh) await db.update(wishlist).set({ alertedAt: at }).where(eq(wishlist.id, w.id));
  return null;
}
