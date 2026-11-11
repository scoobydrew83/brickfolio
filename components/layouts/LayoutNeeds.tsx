'use client';
import Image from 'next/image';
import { useState, useTransition } from 'react';
import { Copy, Download, PackageCheck } from 'lucide-react';
import { reserveForLayout } from '@/app/actions';
import { itemImage, itemPage } from '@/lib/bricklink/links';
import type { LayoutModule, LayoutNeeds as Needs } from '@/lib/service/layouts';
import { Banner, Button, Callout, Count, EmptyState, FilterChip, buttonClass } from '../ui';
import { moduleName } from './LayoutGrid';

const PAGE = 100;

/** What the whole layout still needs: one line per part and colour, and the to-buy lines as a BrickLink Wanted List. */
export function LayoutNeeds({ layoutId, needs: n, modules }: { layoutId: number; needs: Needs; modules: LayoutModule[] }) {
  const [filter, setFilter] = useState<'all' | 'buy'>('all');
  const [all, setAll] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [pending, start] = useTransition();
  const wantedUrl = `/api/v1/layouts/${layoutId}/wanted.xml`;
  const names = new Map(modules.map((m) => [m.id, moduleName(m)]));
  const loose = n.totals.inLots > 0;
  const lines = filter === 'buy' ? n.lines.filter((l) => l.toBuy > 0) : n.lines;
  const shown = all ? lines : lines.slice(0, PAGE);

  const copyWanted = () => start(async () => {
    try {
      const res = await fetch(wantedUrl);
      if (!res.ok) throw new Error(`The server answered ${res.status}.`);
      await navigator.clipboard.writeText(await res.text());
      setMessage({ kind: 'ok', text: 'Wanted List XML copied. On BrickLink: Want → Upload → paste.' });
    } catch (e) {
      setMessage({ kind: 'error', text: `Couldn't copy the Wanted List: ${e instanceof Error ? e.message : String(e)}` });
    }
  });

  const reserve = () => start(async () => {
    const r = await reserveForLayout(layoutId);
    setMessage(r.ok ? { kind: 'ok', text: r.message ?? 'Reserved.' } : { kind: 'error', text: r.error });
  });

  if (!n.builds && !n.copies) {
    return <EmptyState title="Nothing linked yet">Link builds or sets to modules to see what&apos;s missing.</EmptyState>;
  }

  const notes = [
    n.unmapped ? `${n.unmapped} ${n.unmapped === 1 ? 'part' : 'parts'} can't be matched to BrickLink numbers, so ${n.unmapped === 1 ? "it isn't" : "they aren't"} counted` : null,
    n.buildsWithoutParts ? `${n.buildsWithoutParts} ${n.buildsWithoutParts === 1 ? 'build has' : 'builds have'} no parts list yet` : null,
  ].filter(Boolean);

  return (
    <div className="space-y-4">
      {message && <Banner kind={message.kind} onDismiss={() => setMessage(null)}>{message.text}</Banner>}
      <Callout className="space-y-3 p-4">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <div>
            <p className="text-sm text-fg-3">To buy</p>
            <p className="mt-1 text-2xl font-extrabold tracking-tight tabular-nums [font-stretch:112%]">
              <Count n={n.totals.toBuyPieces} /> <span className="text-base font-semibold text-fg-2">in {n.totals.toBuyLots} {n.totals.toBuyLots === 1 ? 'lot' : 'lots'}</span>
            </p>
            <p className="mt-0.5 text-xs text-fg-3">
              {[
                `From ${n.builds} ${n.builds === 1 ? 'build' : 'builds'} and ${n.copies} set ${n.copies === 1 ? 'copy' : 'copies'} on this layout`,
                loose ? `${n.totals.inLots}x could come from loose parts` : null,
                ...notes,
              ].filter(Boolean).join(' · ')}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {n.builds > 0 && <Button size="sm" icon={PackageCheck} loading={pending} onClick={reserve} title="Set aside the loose parts each build on the layout still needs">Reserve from loose parts for every build</Button>}
            {n.totals.toBuyLots > 0 && (
              <>
                <a href={wantedUrl} download className={buttonClass('secondary', 'sm')} title="Upload this in BrickLink under Want → Upload"><Download aria-hidden className="size-4" />Wanted List</a>
                <Button size="sm" icon={Copy} disabled={pending} onClick={copyWanted}>Copy XML</Button>
              </>
            )}
          </div>
        </div>
        <p className="border-t border-line pt-3 text-xs text-fg-3">
          Builds count their whole parts list, less loose parts reserved for them: the parts in your sets aren&apos;t taken off, because those sets stand on the layout too. That&apos;s unlike What can I build?, which asks whether you could build one. Set copies add the parts you&apos;ve marked missing from them.
        </p>
      </Callout>

      {n.lines.length === 0 ? (
        <EmptyState title="Nothing to buy">Every linked set copy is complete{n.builds ? ', and the builds have no parts list to count yet' : ''}.</EmptyState>
      ) : (
        <>
          {loose && (
            <div className="flex flex-wrap gap-2">
              <FilterChip active={filter === 'all'} onClick={() => setFilter('all')}>All</FilterChip>
              <FilterChip active={filter === 'buy'} onClick={() => setFilter('buy')}>To buy</FilterChip>
            </div>
          )}
          <Callout className="overflow-hidden">
            <ul className="divide-y divide-line">
              {shown.map((l) => (
                <li key={`${l.type}|${l.partNo}|${l.colorId}`} className="flex items-center gap-3 px-4 py-2">
                  <p className="w-14 shrink-0 text-right text-lg leading-none"><Count n={l.toBuy} /></p>
                  <a href={itemPage(l.type, l.partNo)} target="_blank" rel="noreferrer" className="flex size-12 shrink-0 items-center justify-center rounded-control bg-tile">
                    <Image src={itemImage(l.type, l.partNo, l.colorId)} alt="" width={48} height={48} className="max-h-12 w-auto object-contain" />
                  </a>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">
                      {l.rgb && <span className="mr-1.5 inline-block size-2.5 rounded-full ring-1 ring-line-strong" style={{ background: `#${l.rgb}` }} />}
                      {l.colorName && l.type === 'PART' ? `${l.colorName} ` : ''}{l.name}
                    </p>
                    <p className="truncate text-xs text-fg-3">
                      <span className="font-mono">{l.partNo}</span> · {l.type.toLowerCase()}
                      {loose && <> · need <b className="tabular-nums">{l.need}x</b>, <b className="tabular-nums">{l.inLots}x</b> in loose parts</>}
                      {' · '}for {l.modules.map((id) => names.get(id) ?? `module ${id}`).join(', ')}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </Callout>
          {lines.length > shown.length && <Button onClick={() => setAll(true)} className="w-full">Show all {lines.length.toLocaleString()} lines</Button>}
          <p className="text-xs text-fg-3">Parts lists from BrickLink (sets) and Rebrickable (builds).</p>
        </>
      )}
    </div>
  );
}
