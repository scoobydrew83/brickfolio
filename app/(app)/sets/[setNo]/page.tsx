import { Suspense } from 'react';
import { connection } from 'next/server';
import { notFound } from 'next/navigation';
import SetDetail from '@/components/SetDetail';
import { PageSkeleton } from '@/components/ui';
import { getDb } from '@/lib/db';
import { librarySource } from '@/lib/ldraw/library';
import { buildMatches } from '@/lib/service/builds';
import { getModel } from '@/lib/service/models';
import { listMissing, pickCopy } from '@/lib/service/missing';
import { partout, unpricedLots } from '@/lib/service/partout';
import { modelAuthor } from '@/lib/ldraw/omr';
import { listSetParts } from '@/lib/service/parts';
import { brickLinkGuides, valueSourcesFor } from '@/lib/service/prices';
import { getCurrency, getSet, listLocations, listSets, priceHistory } from '@/lib/service/sets';
import { conditionGap, copyGuide, displayNo, setGuide, setNo } from '@/lib/sets';
import { brickPartPrice, bricklink, currentUser } from '@/lib/session';

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
  const sp = await searchParams;
  // The copy whose missing parts are shown: ?copy=<id>, else the only Partial one, else the first.
  const copy = pickCopy(s, /^\d+$/.test(String(sp.copy ?? '')) ? Number(sp.copy) : null, false) ?? pickCopy(s, null, false);
  const cond = copy ? (copyGuide(copy) === 'N' ? 'New' : 'Used') : null;
  const [parts, prices, currency, locations, all, model, alternates, missing] = await Promise.all([listSetParts(db, s.id), priceHistory(db, s.setNo), getCurrency(db), listLocations(db), listSets(db), getModel(db, s.id), buildMatches(db, { sourceSetNo: s.setNo }), listMissing(db, s.id, copy?.id ?? null)]);
  const [po, unpriced, sources, guides] = await Promise.all([partout(db, s.id, cond, currency, copy?.id ?? null), unpricedLots(db, s.id, cond, currency), valueSourcesFor(db, 'set', s.setNo, currency), brickLinkGuides(db, 'set', s.setNo, currency)]);
  const main = setGuide(s.copies); // the guide the set's lookups use; the other one is fetched weekly
  const inUse = all.flatMap((x) => x.copies.map((c) => c.location)).filter((l): l is string => !!l);
  return (
    <SetDetail
      set={s}
      parts={parts}
      // One line: the set's own guide (its current prices are in it).
      prices={prices.filter((p) => p.guide === main).map((p) => ({ date: p.date, avgSold: p.avgSold }))}
      guide={main}
      conditions={{ n: guides.N, u: guides.U, gap: conditionGap(guides.N, guides.U) }}
      currency={currency}
      locations={[...new Set([...locations, ...inUse])]}
      priced={!!bricklink()}
      model={model ? { fileName: model.fileName, author: modelAuthor(model.content) } : null}
      library={!!librarySource()}
      builds={alternates.filter((b) => b.partsKnown).slice(0, 3)}
      view={sp.view === '3d' ? '3d' : undefined}
      missing={missing}
      missingCopyId={copy?.id ?? null}
      partout={po.lots ? { ...po, unpriced } : null}
      partsPriced={!!brickPartPrice()}
      sources={sources}
    />
  );
}
