import { api, csvBody, fromResult, json } from '@/lib/api';
import { importCsv } from '@/lib/service/csv';

/**
 * POST /api/v1/import – body is a CSV (text/csv): Brickfolio's Sets, History or Parts export, the old sheet, or a
 * Rebrickable, Brickset or BrickEconomy collection. Sets are matched by set number. `?dryRun=1` previews a
 * Rebrickable, Brickset or BrickEconomy file without saving.
 */
export const POST = api('admin', async (req, { db }) => {
  const text = await csvBody(req);
  if (text.length > 5_000_000) return json({ error: 'File is over 5 MB.' }, 413);
  const dryRun = ['1', 'true'].includes(new URL(req.url).searchParams.get('dryRun') ?? '');
  return fromResult(await importCsv(db, text, { dryRun }));
});
