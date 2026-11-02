import { api } from '@/lib/api';
import { setsCsv } from '@/lib/service/csv';
import { listSets, today } from '@/lib/service/sets';

/** GET /api/v1/export.csv – every set as CSV. The same file can be imported again. */
export const GET = api(async (_req, { db }) =>
  new Response(setsCsv(await listSets(db)), {
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="sets-${today()}.csv"`, 'Cache-Control': 'no-store' },
  }),
);
