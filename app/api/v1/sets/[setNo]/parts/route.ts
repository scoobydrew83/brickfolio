import { api, json } from '@/lib/api';
import { setNo } from '@/lib/sets';
import { ensureColors, listSetParts } from '@/lib/service/parts';
import { getSet } from '@/lib/service/sets';
import { brickColors } from '@/lib/session';

/** GET /api/v1/sets/:setNo/parts – the set's parts list with color names. */
export const GET = api<{ setNo: string }>(async (_req, { db, params }) => {
  const s = await getSet(db, setNo(params.setNo));
  if (!s) return json({ error: 'Not found' }, 404);
  await ensureColors(db, brickColors());
  return json({ parts: await listSetParts(db, s.id), pieces: s.pieces, partLots: s.partLots });
});
