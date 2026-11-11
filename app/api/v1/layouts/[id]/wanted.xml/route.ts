import { api, json } from '@/lib/api';
import { layoutWantedListXml } from '@/lib/service/layouts';
import { idOf } from '../params';

/** GET /api/v1/layouts/:id/wanted.xml – the parts to buy for the layout, as a BrickLink Wanted List upload. */
export const GET = api<{ id: string }>(async (_req, { db, params }) => {
  const id = idOf(params.id);
  const w = id === null ? null : await layoutWantedListXml(db, id);
  if (!w) return json({ error: 'Layout not found.' }, 404);
  const file = w.name.replace(/[^A-Za-z0-9-]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || `layout-${id}`;
  return new Response(w.xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Content-Disposition': `attachment; filename="${file}-parts-to-buy.xml"`,
      'Cache-Control': 'no-store',
    },
  });
});
