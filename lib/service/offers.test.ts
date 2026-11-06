import { beforeEach, expect, it } from 'vitest';
import { openNodeDb } from '../db/node';
import type { DB } from '../db/types';
import { remember } from '../identifiers/resolve';
import { bestOffers, parsePriceInput, savePostedPrices } from './offers';
import { listObservations, setPrimarySource, valueSources } from './prices';
import { refreshEstValues } from './copies';

let db: DB;
const NOW = new Date('2026-11-06T12:00:00Z');
const row = (o: Record<string, unknown> = {}) => ({ id: '75192', source: 'retailer:lego', currency: 'USD', amount: 599.99, ...o });
const parse = (...rows: Record<string, unknown>[]) => parsePriceInput({ observations: rows }, NOW);
beforeEach(() => { db = openNodeDb(':memory:').db; });

it('accepts offers from retailers and manual, with sensible defaults', () => {
  expect(parse(row({ url: 'https://www.lego.com/x', observedAt: '2026-11-05T10:00:00Z' }))).toEqual({ ok: true, value: [{
    kind: 'set', id: '75192', scheme: null, source: 'retailer:lego', type: 'offer', condition: 'N', currency: 'USD', amount: 599.99,
    url: 'https://www.lego.com/x', observedAt: '2026-11-05T10:00:00.000Z', sampleSize: null, sourceRef: null,
  }] });
  expect(parse(row({ source: 'manual', type: 'retail', condition: 'Used', currency: 'eur' }))).toMatchObject({ ok: true, value: [{ source: 'manual', type: 'retail', condition: 'U', currency: 'EUR' }] });
});

it('refuses first-party sources and bad rows, naming the row', () => {
  for (const source of ['bricklink', 'BrickOwl', 'brickeconomy', 'brickset']) expect(parse(row({ source }))).toMatchObject({ ok: false, error: expect.stringContaining("app's own sync") });
  expect(parse(row(), row({ source: 'retailer:' }))).toMatchObject({ ok: false, error: expect.stringContaining('observations[1].source') });
  expect(parse(row({ type: 'asking' })).ok).toBe(false); // offers and retail prices only: never a value source
  expect(parse(row({ amount: 0 })).ok).toBe(false);
  expect(parse(row({ amount: 2_000_000 })).ok).toBe(false);
  expect(parse(row({ currency: 'dollars' })).ok).toBe(false);
  expect(parse(row({ url: 'http://lego.com' })).ok).toBe(false);
  expect(parse(row({ url: `https://x.com/${'a'.repeat(500)}` })).ok).toBe(false);
  expect(parse(row({ observedAt: '2026-11-07T12:00:00Z' })).ok).toBe(false); // future
  expect(parse(row({ observedAt: '2026-09-01T00:00:00Z' })).ok).toBe(false); // over 30 days
  expect(parse(row({ condition: 'mint' })).ok).toBe(false);
  expect(parse(row({ scheme: 'ldraw' })).ok).toBe(false);
  expect(parsePriceInput({}, NOW).ok).toBe(false);
  expect(parsePriceInput({ observations: Array.from({ length: 201 }, () => row()) }, NOW).ok).toBe(false);
});

it('resolves set numbers, barcodes and Brickset ids, and reports the rest', async () => {
  await remember(db, [
    { kind: 'set', scheme: 'gtin', value: '673419264150', canonical: '75192-1', source: 'user', verified: true },
    { kind: 'set', scheme: 'brickset', value: '26725', canonical: '75192-1', source: 'brickset' },
  ]);
  const p = parse(row({ id: '75192' }), row({ id: '75192-1', amount: 590 }), row({ id: '673419264150', amount: 580 }), row({ id: '26725', scheme: 'brickset', amount: 570 }), row({ id: '00000000000000' }));
  if (!p.ok) throw new Error(p.error);
  expect(await savePostedPrices(db, p.value)).toEqual({ saved: 4, unresolved: [{ index: 4, id: '00000000000000' }] });
  const rows = await listObservations(db, 'set', '75192-1', { type: 'offer' });
  expect(rows).toHaveLength(1); // one row per source, condition, currency and day: the last write wins
  expect(rows[0]).toMatchObject({ source: 'retailer:lego', amount: 570, observedOn: '2026-11-06' });
});

it('finds the lowest recent offer per condition in one currency, and offers never become a value source', async () => {
  const save = async (o: Record<string, unknown>) => { const p = parse(row(o)); if (!p.ok) throw new Error(p.error); await savePostedPrices(db, p.value); };
  await save({ source: 'retailer:lego', amount: 650, observedAt: '2026-11-06T08:00:00Z' });
  await save({ source: 'retailer:target', amount: 610, observedAt: '2026-11-05T08:00:00Z' });
  await save({ source: 'retailer:walmart', amount: 500, observedAt: '2026-10-25T08:00:00Z' }); // too old
  await save({ source: 'retailer:amazon-de', amount: 400, currency: 'EUR' }); // other currency
  await save({ source: 'retailer:ebay', amount: 300, condition: 'U' }); // used
  const best = await bestOffers(db, ['75192-1', '10280-1'], { currency: 'USD', days: 3, now: NOW });
  expect(best.get('75192-1')).toEqual({
    N: { amount: 610, source: 'retailer:target', url: null, observedAt: '2026-11-05T08:00:00.000Z' },
    U: { amount: 300, source: 'retailer:ebay', url: null, observedAt: expect.any(String) },
  });
  expect(best.has('10280-1')).toBe(false);
  expect(await valueSources(db)).toEqual(['bricklink']);
  expect(await setPrimarySource(db, 'retailer:lego', refreshEstValues)).toMatchObject({ ok: false, status: 400 });
});
