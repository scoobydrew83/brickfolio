import { api, body, fromResult, json } from '@/lib/api';
import { rememberFigCode } from '@/lib/barcode/figcodes';

/**
 * POST /api/v1/barcodes/minifig/mappings – { code, name, series, rbFigNo? } saves "this box code is that figure" as
 * your own, confirmed code (for the box's factory and year).
 */
export const POST = api(async (req, { db }) => {
  const b = await body(req);
  if (!b) return json({ error: 'Send { "code": "6472866 444S3", "name": "…", "series": "Series 25" }.' }, 400);
  return fromResult(await rememberFigCode(db, b.code, { name: b.name, series: b.series, rbFigNo: b.rbFigNo }), 201);
});
