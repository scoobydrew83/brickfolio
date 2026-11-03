import { api } from '@/lib/api';
import { valuationPdf } from '@/lib/report/pdf';
import { valuation } from '@/lib/service/report';
import { today } from '@/lib/service/sets';

/**
 * GET /api/v1/report.pdf?owner=Name – an insurance / valuation report: every set and minifigure with its value,
 * condition, location, how many sales the price rests on and when it was fetched, grouped by location.
 */
export const GET = api(async (req, { db }) => {
  const owner = new URL(req.url).searchParams.get('owner');
  const pdf = await valuationPdf(await valuation(db, { owner }));
  return new Response(pdf as BodyInit, {
    headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="valuation-${today()}.pdf"`, 'Cache-Control': 'no-store' },
  });
});
