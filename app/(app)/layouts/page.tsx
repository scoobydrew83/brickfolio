import { Suspense } from 'react';
import { connection } from 'next/server';
import LayoutsView from '@/components/LayoutsView';
import { PageSkeleton } from '@/components/ui';
import { getDb } from '@/lib/db';
import { listLayouts } from '@/lib/service/layouts';
import { currentUser } from '@/lib/session';

export const metadata = { title: 'Layouts' };

export default function Page() {
  return (
    <div className="mx-auto w-full max-w-5xl">
      <Suspense fallback={<PageSkeleton tiles={3} />}>
        <Content />
      </Suspense>
    </div>
  );
}

async function Content() {
  await connection();
  if (!(await currentUser())) return <p className="py-24 text-center text-fg-3">Not signed in.</p>;
  return <LayoutsView layouts={await listLayouts(await getDb())} />;
}
