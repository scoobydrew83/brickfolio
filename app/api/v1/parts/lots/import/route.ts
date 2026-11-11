import { api, fromResult, json, partsFileBody } from '@/lib/api';
import { importLots } from '@/lib/service/lots';
import { listLocations } from '@/lib/service/sets';
import { rebrickable } from '@/lib/session';

/**
 * POST /api/v1/parts/lots/import?location=&mode=add|replace&approximate=1 – BrickLink XML (application/xml) or a
 * Rebrickable parts CSV (text/csv) into one location. Returns { batch, lots, pieces, merged, unmapped, skipped }.
 */
export const POST = api(async (req, { db }) => {
  const p = new URL(req.url).searchParams;
  const location = p.get('location')?.trim() || null;
  if (location && !(await listLocations(db)).includes(location)) return json({ error: `Unknown location "${location}".` }, 400);
  const mode = p.get('mode') ?? 'add';
  if (mode !== 'add' && mode !== 'replace') return json({ error: 'mode must be add or replace.' }, 400);
  const { kind, text } = await partsFileBody(req);
  return fromResult(await importLots(db, { kind, text, location, mode, approximate: p.get('approximate') === '1' || p.get('approximate') === 'true' }, { rebrickable: rebrickable() }), 201);
});
