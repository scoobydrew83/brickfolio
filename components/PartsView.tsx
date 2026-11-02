'use client';
import { useEffect, useState, useTransition } from 'react';
import { searchAllParts } from '@/app/actions';
import type { PartSearchRow } from '@/lib/service/parts';
import { PartList } from './board/PartsDialog';
import { Button, Callout, EmptyState, SearchInput, Select } from './ui';

/** Every part of every set, like the sheet's Parts tab. Search runs on the server, 200 rows at a time. */
export default function PartsView({ types, first }: { types: string[]; first: { parts: PartSearchRow[]; total: number } }) {
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const [data, setData] = useState(first);
  const [pending, start] = useTransition();
  const [touched, setTouched] = useState(false);

  // Search 300 ms after typing stops.
  useEffect(() => {
    if (!touched) return;
    const t = setTimeout(() => start(async () => setData(await searchAllParts({ q, type }))), 300);
    return () => clearTimeout(t);
  }, [q, type, touched]);

  const more = () => start(async () => {
    const next = await searchAllParts({ q, type, offset: data.parts.length });
    setData({ parts: [...data.parts, ...next.parts], total: next.total });
  });

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex flex-wrap gap-3">
          <SearchInput value={q} onChange={(e) => { setQ(e.target.value); setTouched(true); }} placeholder="Search part #, name, color or set #…" aria-label="Search parts" />
          <Select aria-label="Type" value={type} onChange={(e) => { setType(e.target.value); setTouched(true); }} options={[['', 'All types'], ...types.map((t) => [t, t.replace('_', ' ').toLowerCase()])]} />
        </div>
        <p className="text-sm text-fg-3">
          {pending ? 'Searching…' : <>Showing <b className="text-fg tabular-nums">{data.parts.length.toLocaleString()}</b> of {data.total.toLocaleString()} part rows across your sets</>}
        </p>
      </div>

      {data.total === 0 && !q && !type ? (
        <EmptyState title="No parts lists yet">
          They&apos;re fetched from BrickLink when a set is added or synced, or import the sheet&apos;s Parts tab in Settings.
        </EmptyState>
      ) : (
        <Callout className="overflow-hidden">
          <PartList parts={data.parts} showSet />
        </Callout>
      )}
      {data.parts.length < data.total && (
        <Button onClick={more} loading={pending} className="w-full">
          Show {Math.min(200, data.total - data.parts.length)} more
        </Button>
      )}
    </div>
  );
}
