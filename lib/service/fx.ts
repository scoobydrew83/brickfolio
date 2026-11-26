// Exchange rates for a purchase paid in another currency: the European Central Bank's daily reference rate for the
// purchase date, from frankfurter.dev (free, no key; works on Docker and Workers). A date with no rate (a weekend, a
// holiday) gets the last working day's. Rates are kept in settings (`fx:<date>:<from>:<to>`), so each date and pair is
// fetched once. Not used for anything else: values still come from the price sources in the collection currency.
import { eq } from 'drizzle-orm';
import { settings } from '../db/schema';
import type { DB } from '../db/types';

import { FX_CURRENCIES } from '../currencies';

const API = 'https://api.frankfurter.dev/v1';
export { FX_CURRENCIES };
export class FxError extends Error {}

export type Rate = { rate: number; on: string };

/** The ECB rate to turn 1 `from` into `to` on `date` (YYYY-MM-DD; a future date gets the latest). Throws FxError. */
export async function rateOn(db: DB, date: string, from: string, to: string, fetchImpl: typeof fetch = fetch): Promise<Rate> {
  if (from === to) return { rate: 1, on: date };
  for (const c of [from, to]) if (!(FX_CURRENCIES as readonly string[]).includes(c)) throw new FxError(`No exchange rate for ${c}: the ECB publishes rates for ${FX_CURRENCIES.join(', ')}.`);
  if (date < '1999-01-04') throw new FxError('Exchange rates start on 1999-01-04.');
  const day = date > new Date().toISOString().slice(0, 10) ? new Date().toISOString().slice(0, 10) : date;
  const key = `fx:${day}:${from}:${to}`;
  const kept = (await db.select({ value: settings.value }).from(settings).where(eq(settings.key, key)).get())?.value;
  if (kept) {
    const [rate, on] = kept.split('|');
    if (Number(rate) > 0) return { rate: Number(rate), on };
  }
  let body: { date?: string; rates?: Record<string, number> } | null;
  try {
    const res = await fetchImpl(`${API}/${day}?${new URLSearchParams({ base: from, symbols: to })}`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new FxError(`the rate service answered ${res.status}`);
    body = await res.json();
  } catch (e) {
    throw new FxError(`Couldn't get the ${from}→${to} exchange rate for ${day} (${e instanceof Error ? e.message : String(e)}). Try again, or enter the price in your collection currency.`);
  }
  const rate = body?.rates?.[to];
  if (!(typeof rate === 'number' && rate > 0)) throw new FxError(`No ${from}→${to} exchange rate for ${day}.`);
  const on = typeof body?.date === 'string' ? body.date.slice(0, 10) : day;
  await db.insert(settings).values({ key, value: `${rate}|${on}` }).onConflictDoUpdate({ target: settings.key, set: { value: `${rate}|${on}` } });
  return { rate, on };
}
