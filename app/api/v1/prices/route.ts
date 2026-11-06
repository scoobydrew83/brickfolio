import { after } from 'next/server';
import { api, body, fromResult, json } from '@/lib/api';
import { alertsFromEnv, notifyUnderTarget } from '@/lib/service/alerts';
import { withIdempotency } from '@/lib/service/idempotency';
import { parsePriceInput, savePostedPrices } from '@/lib/service/offers';
import { listObservations, PRICE_TYPES, parseSource, type PriceType } from '@/lib/service/prices';
import { setNo } from '@/lib/sets';
import type { DB } from '@/lib/db';

/** One alert check at a time per server, so two quick posts can't both send the same deal. */
let alerting: Promise<unknown> = Promise.resolve();
const checkAlerts = (db: DB) => {
  const send = alertsFromEnv();
  if (!send) return;
  alerting = alerting.then(() => notifyUnderTarget(db, send)).catch(() => null);
  return alerting;
};

/**
 * POST /api/v1/prices – { observations: [{ kind?, id, scheme?, source: 'retailer:<name>'|'manual', type?: 'offer'|'retail',
 * condition?: 'N'|'U', currency, amount, url?, observedAt?, sampleSize?, sourceRef? }] }, at most 200. For your own
 * flows (n8n or a script) to post retailer offers; wishlist alerts follow within moments. Needs an Idempotency-Key
 * header: the same key again returns the first answer with `replayed: true`. Ids that don't resolve come back in
 * `unresolved`.
 */
export const POST = api(async (req, { db }) => {
  const key = req.headers.get('idempotency-key')?.trim();
  if (!key || key.length > 100) return json({ error: 'Send an Idempotency-Key header (any unique string up to 100 characters).' }, 400);
  const p = parsePriceInput(await body(req));
  if (!p.ok) return json({ error: p.error }, 400);
  const r = await withIdempotency(db, 'prices', key, async () => ({ ok: true as const, ...(await savePostedPrices(db, p.value)) }));
  if (r.ok && !r.replayed && r.saved) after(() => checkAlerts(db));
  return fromResult(r, 201);
});

/** GET /api/v1/prices?kind=set&id=75192-1&type=offer&source=retailer:lego&days=14 – stored rows for one item, newest first. */
export const GET = api(async (req, { db }) => {
  const q = new URL(req.url).searchParams;
  const kind = q.get('kind') === 'minifig' ? 'minifig' : 'set';
  const raw = q.get('id')?.trim();
  if (!raw) return json({ error: 'Send ?id= (a set or minifigure number).' }, 400);
  const id = kind === 'set' ? setNo(raw) : raw.toLowerCase();
  const type = q.get('type');
  if (type && !PRICE_TYPES.includes(type as PriceType)) return json({ error: `type must be one of ${PRICE_TYPES.join(', ')}.` }, 400);
  const source = q.get('source') ? parseSource(q.get('source')) : undefined;
  if (source === null) return json({ error: 'Unknown source.' }, 400);
  const days = Math.min(Math.max(Number(q.get('days')) || 14, 1), 365);
  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const rows = (await listObservations(db, kind, id, { type: (type as PriceType) || undefined, source })).filter((r) => r.observedOn >= since);
  return json({ observations: rows });
});
