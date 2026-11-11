import { Suspense } from 'react';
import { connection } from 'next/server';
import { notFound } from 'next/navigation';
import { LayoutEditor } from '@/components/layouts/LayoutEditor';
import { PageSkeleton } from '@/components/ui';
import { getDb } from '@/lib/db';
import { getLayout, layoutNeeds } from '@/lib/service/layouts';
import { ensureColors } from '@/lib/service/parts';
import { brickColors, currentUser } from '@/lib/session';

const idOf = (s: string) => (/^\d+$/.test(s) ? Number(s) : null);

export async function generateMetadata({ params }: PageProps<'/layouts/[id]'>) {
  const id = idOf((await params).id);
  if (id === null || !(await currentUser())) return { title: 'Layout' };
  return { title: (await getLayout(await getDb(), id))?.name ?? 'Layout' };
}

export default function Page({ params }: PageProps<'/layouts/[id]'>) {
  return (
    <div className="mx-auto w-full max-w-6xl">
      <Suspense fallback={<PageSkeleton tiles={2} />}>
        <Content params={params} />
      </Suspense>
    </div>
  );
}

async function Content({ params }: Pick<PageProps<'/layouts/[id]'>, 'params'>) {
  await connection();
  if (!(await currentUser())) return <p className="py-24 text-center text-fg-3">Not signed in.</p>;
  const id = idOf((await params).id);
  const db = await getDb();
  const layout = id === null ? undefined : await getLayout(db, id);
  if (!layout) notFound();
  await ensureColors(db, brickColors());
  const needs = (await layoutNeeds(db, layout.id))!;
  return <LayoutEditor layout={layout} needs={needs} />;
}
