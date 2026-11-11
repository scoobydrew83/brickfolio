import { Suspense } from 'react';
import { PageSkeleton } from '@/components/ui';
import { connection } from 'next/server';
import Link from 'next/link';
import { Boxes, Hammer, LayoutGrid } from 'lucide-react';
import { PageHeader } from '@/components/shell/PageHeader';
import { buttonClass } from '@/components/ui';
import PartsView from '@/components/PartsView';
import { getDb } from '@/lib/db';
import { ensureColors, partTypes, searchParts } from '@/lib/service/parts';
import { brickColors, currentUser } from '@/lib/session';

export const metadata = { title: 'Parts' };

export default function Page() {
  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <PageHeader title="Parts" actions={<>
        <Link href="/parts/lots" className={buttonClass('secondary')}><Boxes aria-hidden className="size-4" />Loose parts</Link>
        <Link href="/layouts" className={buttonClass('secondary')}><LayoutGrid aria-hidden className="size-4" />Layouts</Link>
        <Link href="/build" className={buttonClass('secondary')}><Hammer aria-hidden className="size-4" />What can I build?</Link>
      </>} />
      <Suspense fallback={<PageSkeleton />}>
        <Content />
      </Suspense>
    </div>
  );
}

async function Content() {
  await connection();
  if (!(await currentUser())) return <p className="py-24 text-center text-fg-3">Not signed in.</p>;
  const db = await getDb();
  await ensureColors(db, brickColors());
  const [types, first] = await Promise.all([partTypes(db), searchParts(db, { limit: 200 })]);
  return <PartsView types={types} first={first} />;
}
