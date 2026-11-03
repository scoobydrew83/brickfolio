import { api, json } from '@/lib/api';
import { missingWantedList } from '@/lib/service/missing';
import { displayNo, setNo } from '@/lib/sets';

type P = { setNo: string };

/** GET /api/v1/sets/:setNo/missing/wanted.xml – the missing parts as a BrickLink Wanted List (Want → Upload). */
export const GET = api<P>(async (_req, { db, params }) => {
  const no = setNo(params.setNo);
  const w = await missingWantedList(db, no);
  if (!w) return json({ error: 'Set not found.' }, 404);
  return new Response(w.xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Content-Disposition': `attachment; filename="missing-${displayNo(no)}.xml"`, 'Cache-Control': 'no-store' } });
});
