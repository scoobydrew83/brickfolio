import { Suspense } from 'react';
import { connection } from 'next/server';
import ScanView from '@/components/ScanView';
import { PageSkeleton } from '@/components/ui';
import { getDb } from '@/lib/db';
import { isDemo } from '@/lib/demo';
import { listLocations } from '@/lib/service/sets';
import { cmfSeries } from '@/lib/service/minifigs';
import { ocrPaths } from '@/lib/barcode/ocr';
import { barcodeCaps, currentUser } from '@/lib/session';

export const metadata = { title: 'Scan barcodes' };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton tiles={1} />}>
      <Content />
    </Suspense>
  );
}

async function Content() {
  await connection();
  if (!(await currentUser())) return <p className="py-24 text-center text-fg-3">Not signed in.</p>;
  const caps = barcodeCaps();
  if (!caps.scanning) return <p className="py-24 text-center text-fg-3">Barcode scanning is turned off on this server (BARCODE_SCANNING=off).</p>;
  const db = await getDb();
  const [locations, series] = await Promise.all([listLocations(db), cmfSeries(db)]);
  return <ScanView locations={locations} caps={caps} demo={isDemo()} series={series} ocr={ocrPaths()} />;
}
