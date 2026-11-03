import { api, body, json } from '@/lib/api';
import { resolveFigCode } from '@/lib/barcode/figcodes';
import { lookupLimit } from '@/lib/barcode/limit';

/**
 * POST /api/v1/barcodes/minifig – { code } finds the figure for a Collectible Minifigures box code (the text of the
 * square Data Matrix, e.g. "6472866 444S3"): your codes, then the community list, then the bundled L-Scan table.
 */
export const POST = api(async (req, { db }) => {
  const b = await body(req);
  if (!b || typeof b.code !== 'string') return json({ error: 'Send { "code": "6472866 444S3" }.', code: 'INVALID_CODE' }, 400);
  if (!lookupLimit().take()) return json({ error: 'Too many lookups. Wait a minute.', code: 'RATE_LIMITED' }, 429);
  const r = await resolveFigCode(db, b.code);
  if (r.status === 'invalid') return json({ error: r.error, code: 'INVALID_CODE' }, 400);
  return json(r);
});
