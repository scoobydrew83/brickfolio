import { api, csvBody, fromResult, json } from '@/lib/api';
import { importCsv } from '@/lib/service/csv';

/** POST /api/v1/import – body is a Sets or History CSV (text/csv). Sets are matched by set number. */
export const POST = api(async (req, { db }) => {
  const text = await csvBody(req);
  if (text.length > 5_000_000) return json({ error: 'File is over 5 MB.' }, 413);
  return fromResult(await importCsv(db, text));
});
