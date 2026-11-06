import { api } from '@/lib/api';
import { imageStore } from '@/lib/images/cache';
import { valuationPdf } from '@/lib/report/pdf';
import { cachedImage } from '@/lib/service/images';
import { reportPhotos, valuation } from '@/lib/service/report';
import { today } from '@/lib/service/sets';

/**
 * GET /api/v1/report.pdf?owner=Name&photos=1 – an insurance / valuation report: every set and minifigure with its
 * value, condition, location, how many sales the price rests on and when it was fetched, grouped by location.
 * With photos=1, each line has its photo from the image cache (fetched once if missing; PNG and JPEG only).
 */
export const GET = api(async (req, { db }) => {
  const q = new URL(req.url).searchParams;
  const v = await valuation(db, { owner: q.get('owner') });
  let photos;
  if (q.get('photos') === '1' || q.get('photos') === 'on') {
    const store = await imageStore();
    photos = await reportPhotos(v.lines, async (kind, ref) => { const r = await cachedImage(db, store, kind, ref); return r.status === 'ok' ? r.image : null; });
  }
  const pdf = await valuationPdf(v, { photos });
  return new Response(pdf as BodyInit, {
    headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="valuation-${today()}.pdf"`, 'Cache-Control': 'no-store' },
  });
});
