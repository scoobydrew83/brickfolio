import { api, json } from '@/lib/api';
import { missingWantedList } from '@/lib/service/missing';
import { displayNo, setNo } from '@/lib/sets';

type P = { setNo: string };

/** GET /api/v1/sets/:setNo/missing/wanted.xml?copy=<id> – a copy's missing parts as a BrickLink Wanted List (Want → Upload). */
export const GET = api<P>(async (req, { db, params }) => {
  const no = setNo(params.setNo);
  const c = new URL(req.url).searchParams.get('copy');
  if (c && !/^\d+$/.test(c)) return json({ error: 'copy must be a copy id.' }, 400);
  const w = await missingWantedList(db, no, c ? Number(c) : null);
  if (!w) return json({ error: 'Set not found.' }, 404);
  return new Response(w.xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Content-Disposition': `attachment; filename="missing-${displayNo(no)}.xml"`, 'Cache-Control': 'no-store' } });
});
