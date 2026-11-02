import { api, json } from '@/lib/api';
import { wantedListXml } from '@/lib/service/builds';

/** GET /api/v1/builds/:mocNo/wanted.xml – the parts you're missing, as a BrickLink Wanted List upload. */
export const GET = api<{ mocNo: string }>(async (_req, { db, params }) => {
  const w = await wantedListXml(db, params.mocNo);
  if (!w) return json({ error: 'Unknown build.' }, 404);
  return new Response(w.xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Content-Disposition': `attachment; filename="${params.mocNo.replace(/[^A-Za-z0-9-]/g, '')}-missing-parts.xml"`,
      'Cache-Control': 'no-store',
    },
  });
});
