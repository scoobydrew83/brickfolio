import { api, body, fromResult, json } from '@/lib/api';
import { formatHint } from '@/lib/barcode/gtin';
import { forgetBarcode, rememberBarcode } from '@/lib/service/barcodes';

/** POST /api/v1/barcodes/mappings – { barcode, setNo, format? } saves "this barcode is that set" as your own. */
export const POST = api(async (req, { db }) => {
  const b = await body(req);
  if (!b) return json({ error: 'Send { "barcode": "673419264150", "setNo": "75192-1" }.' }, 400);
  return fromResult(await rememberBarcode(db, b.barcode, b.setNo, formatHint(b.format)), 201);
});

/** DELETE /api/v1/barcodes/mappings?barcode=…&setNo=… – forgets a wrong link (yours and any provider's). */
export const DELETE = api(async (req, { db }) => {
  const q = new URL(req.url).searchParams;
  return fromResult(await forgetBarcode(db, q.get('barcode'), q.get('setNo')));
});
