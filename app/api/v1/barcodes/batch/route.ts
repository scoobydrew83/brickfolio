import { api, body, fromResult, json } from '@/lib/api';
import { addScanned, parseScanFigs, parseScanItems } from '@/lib/service/barcodes';
import { listLocations } from '@/lib/service/sets';
import { brickMinifig, bricklink } from '@/lib/session';

/**
 * POST /api/v1/barcodes/batch – { items: [{ setNo, qty?, target?, condition?, location? }], figs?: [{ rbFigNo, name, qty }] }
 * adds scanned sets to the collection (more copies of sets you own) or the wishlist, and scanned Collectible
 * Minifigures to Minifigures. Needs an Idempotency-Key header: sending the same
 * key again returns the first answer (with `replayed: true`) instead of adding twice.
 */
export const POST = api(async (req, { db }) => {
  const key = req.headers.get('idempotency-key')?.trim();
  if (!key || key.length > 100) return json({ error: 'Send an Idempotency-Key header (any unique string up to 100 characters).' }, 400);
  const b = await body(req);
  const p = parseScanItems(b?.items ?? [], await listLocations(db));
  if (!p.ok) return json({ error: p.error }, 400);
  const f = parseScanFigs(b?.figs);
  if (!f.ok) return json({ error: f.error }, 400);
  if (!p.items.length && !f.figs.length) return json({ error: 'Nothing to add.' }, 400);
  return fromResult(await addScanned(db, p.items, { key, lookup: bricklink(), minifig: brickMinifig(), figs: f.figs }), 201);
});
