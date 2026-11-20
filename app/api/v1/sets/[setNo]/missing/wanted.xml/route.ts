import { api, json } from '@/lib/api';
import { readable } from '@/lib/service/permissions';
import { getSet } from '@/lib/service/sets';
import { pickCopy } from '@/lib/service/missing';
import { missingWantedList } from '@/lib/service/missing';
import { displayNo, setNo } from '@/lib/sets';

type P = { setNo: string };

/** GET /api/v1/sets/:setNo/missing/wanted.xml?copy=<id> – a copy's missing parts as a BrickLink Wanted List (Want → Upload). */
export const GET = api<P>('member', async (req, { db, access, params }) => {
  const no = setNo(params.setNo);
  const c = new URL(req.url).searchParams.get('copy');
  if (c && !/^\d+$/.test(c)) return json({ error: 'copy must be a copy id.' }, 400);
  // The copy among those you can see (#50).
  const s = await getSet(db, no, { collectionId: readable(access) });
  const copy = s && pickCopy(s, c ? Number(c) : null, false);
  if (!copy) return json({ error: 'Set not found.' }, 404);
  const w = await missingWantedList(db, no, copy.id);
  if (!w) return json({ error: 'Set not found.' }, 404);
  // X-Skipped-Lines: marked parts with no BrickLink number (from a Rebrickable parts list), left out of the file.
  return new Response(w.xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Content-Disposition': `attachment; filename="missing-${displayNo(no)}.xml"`, 'Cache-Control': 'no-store', 'X-Skipped-Lines': String(w.skipped) } });
});
