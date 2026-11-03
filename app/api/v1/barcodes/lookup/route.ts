import { api, body, json } from '@/lib/api';
import { formatHint } from '@/lib/barcode/gtin';
import { lookupLimit } from '@/lib/barcode/limit';
import { resolveBarcode } from '@/lib/barcode/resolve';
import { barcodeProviders } from '@/lib/session';

/**
 * POST /api/v1/barcodes/lookup – { barcode, format?, refresh? } finds the set for a UPC/EAN: saved barcodes first,
 * then the configured providers. `status` is matched, ambiguous (pick from `candidates`) or not_found.
 */
export const POST = api(async (req, { db }) => {
  const b = await body(req);
  if (!b || typeof b.barcode !== 'string') return json({ error: 'Send { "barcode": "673419264150" }.', code: 'INVALID_BARCODE' }, 400);
  if (!lookupLimit().take()) return json({ error: 'Too many lookups. Wait a minute.', code: 'RATE_LIMITED' }, 429);
  const r = await resolveBarcode(db, b.barcode, { providers: barcodeProviders(), hint: formatHint(b.format), refresh: b.refresh === true });
  if (r.status === 'invalid') return json({ error: r.error, code: r.code }, 400);
  return json(r);
});
