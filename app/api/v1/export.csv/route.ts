import { api, scopeOf } from '@/lib/api';
import { setsCsv } from '@/lib/service/csv';
import { listSets, today } from '@/lib/service/sets';

/** GET /api/v1/export.csv[?collection=<id>] – every set (or one collection's) as CSV. The same file can be imported again. */
export const GET = api('member', async (req, { db, access }) =>
  new Response(setsCsv(await listSets(db, { collectionId: await scopeOf(req, db, access) })), {
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="sets-${today()}.csv"`, 'Cache-Control': 'no-store' },
  }),
);
