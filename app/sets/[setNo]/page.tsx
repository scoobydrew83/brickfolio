import { Suspense } from 'react';
import { connection } from 'next/server';
import { notFound } from 'next/navigation';
import SetDetail from '@/components/SetDetail';
import { PageSkeleton } from '@/components/ui';
import { getDb } from '@/lib/db';
import { librarySource } from '@/lib/ldraw/library';
import { buildMatches } from '@/lib/service/builds';
import { getModel } from '@/lib/service/models';
import { listMissing } from '@/lib/service/missing';
import { modelAuthor } from '@/lib/ldraw/omr';
import { listSetParts } from '@/lib/service/parts';
import { getCurrency, getSet, listLocations, listSets, priceHistory } from '@/lib/service/sets';
import { displayNo, setNo } from '@/lib/sets';
import { bricklink, currentUser } from '@/lib/session';

export async function generateMetadata({ params }: PageProps<'/sets/[setNo]'>) {
  return { title: displayNo(setNo(decodeURIComponent((await params).setNo))) };
}

export default function Page({ params, searchParams }: PageProps<'/sets/[setNo]'>) {
  return (
    <Suspense fallback={<PageSkeleton tiles={2} />}>
      <Content params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Content({ params, searchParams }: Pick<PageProps<'/sets/[setNo]'>, 'params' | 'searchParams'>) {
  await connection();
  if (!(await currentUser())) return <p className="py-24 text-center text-fg-3">Not signed in.</p>;
  const no = setNo(decodeURIComponent((await params).setNo));
  const db = await getDb();
  const s = await getSet(db, no);
  if (!s) notFound();
  const [parts, prices, currency, locations, all, model, alternates, missing] = await Promise.all([listSetParts(db, s.id), priceHistory(db, s.id), getCurrency(db), listLocations(db), listSets(db), getModel(db, s.id), buildMatches(db, { sourceSetNo: s.setNo }), listMissing(db, s.id)]);
  const inUse = all.map((x) => x.location).filter((l): l is string => !!l);
  return (
    <SetDetail
      set={s}
      parts={parts}
      prices={prices.map((p) => ({ date: p.date, avgSold: p.avgSold }))}
      currency={currency}
      locations={[...new Set([...locations, ...inUse])]}
      priced={!!bricklink()}
      model={model ? { fileName: model.fileName, author: modelAuthor(model.content) } : null}
      library={!!librarySource()}
      builds={alternates.filter((b) => b.partsKnown).slice(0, 3)}
      view={(await searchParams).view === '3d' ? '3d' : undefined}
      missing={missing}
    />
  );
}
