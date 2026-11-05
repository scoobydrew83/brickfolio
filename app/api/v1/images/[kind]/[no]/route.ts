import { api, json } from '@/lib/api';
import { imageStore } from '@/lib/images/cache';
import { cachedImage, imageResponse, isImageKind } from '@/lib/service/images';
import { setNo } from '@/lib/sets';

/** GET /api/v1/images/:kind/:no – a set's or minifigure's photo, from the image cache (fetched and kept on first use). */
export const GET = api<{ kind: string; no: string }>(async (_req, { db, params }) => {
  if (!isImageKind(params.kind)) return json({ error: 'Not found' }, 404);
  const no = decodeURIComponent(params.no);
  return imageResponse(await cachedImage(db, await imageStore(), params.kind, params.kind === 'set' ? setNo(no) : no));
});
