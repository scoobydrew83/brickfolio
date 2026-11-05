'use client';
import Link from 'next/link';
import { ClipboardList, LayoutGrid, Plus, RefreshCw, Rows3, ScanBarcode } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, useTransition } from 'react';
import { addSet, editSet, quickAddList, relookupSet, reload, removeSet, runSync, type Result } from '@/app/actions';
import type { SyncStatus } from '@/lib/service/sets';
import { dailyHistory, filterSets, groupTotals, STATUSES, STATUS_LABEL, totals, type Filters, type HistoryRow, type SetRow } from '@/lib/sets';
import { availability, collectionGain, retirement } from '@/lib/retail';
import { SetCard } from './board/SetCard';
import { PartsDialog } from './board/PartsDialog';
import { SetForm } from './board/SetForm';
import { QuickAdd } from './board/QuickAdd';
import { SetTable } from './board/SetTable';
import { ValueChart } from './board/ValueChart';
import { moneyIn } from './board/ui';
import { Banner, Button, EmptyState, FilterChip, SearchInput, Segmented, Select, buttonClass } from './ui';
import { PageHeader } from './shell/PageHeader';
import { CollectionTabs } from './shell/CollectionTabs';

// Filters and view live in the URL, so a reload or a shared link keeps them. Defaults are left out of the URL.
const DEFAULTS = { q: '', location: '', condition: '', status: '', theme: '', availability: '', sort: 'setNo', view: 'cards' } as const;
const SORTS: Filters['sort'][] = ['setNo', 'value', 'name', 'year'];
type View = 'cards' | 'table';
const noop = () => () => {};

type Props = { sets: SetRow[]; history: HistoryRow[]; sync: SyncStatus; locations: string[]; currency: string; readAt: string; user: string; priced: boolean };

export default function Board({ sets, history, sync, locations, currency, readAt, user, priced }: Props) {
  const params = useSearchParams();
  const [filters, setFilters] = useState<Filters>(() => {
    const sort = params.get('sort') as Filters['sort'];
    return { q: params.get('q') ?? '', location: params.get('location') ?? '', condition: params.get('condition') ?? '', status: params.get('status') ?? '', theme: params.get('theme') ?? '', availability: params.get('availability') ?? '', sort: SORTS.includes(sort) ? sort : 'setNo' };
  });
  const [view, setView] = useState<View>(() => (params.get('view') === 'table' ? 'table' : 'cards'));
  const [editing, setEditing] = useState<SetRow | 'new' | null>(null);
  const [partsOf, setPartsOf] = useState<SetRow | null>(null);
  const [pasting, setPasting] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [dupe, setDupe] = useState<{ form: Record<string, unknown>; name: string; qty: number } | null>(null);
  const [pending, startTransition] = useTransition();
  const dupeForm = useRef<Record<string, unknown>>({});

  const money = useMemo(() => moneyIn(currency), [currency]);
  const shown = useMemo(() => filterSets(sets, filters), [sets, filters]);
  const all = useMemo(() => totals(sets), [sets]);
  const view_ = useMemo(() => totals(shown), [shown]);
  // Change since the first saved day, for the one-line value on phones (the chart shows it on wider screens).
  const trend = useMemo(() => {
    const d = dailyHistory(history);
    return d.length > 1 ? { change: d[d.length - 1].estValue - d[0].estValue, since: d[0].date } : null;
  }, [history]);
  const syncing = !!sync?.running;
  // The server renders in the container's timezone (UTC); only format times once in the browser.
  const inBrowser = useSyncExternalStore(noop, () => true, () => false);

  useEffect(() => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...filters, view })) if (v !== DEFAULTS[k as keyof typeof DEFAULTS]) p.set(k, v);
    window.history.replaceState(null, '', p.size ? `?${p}` : window.location.pathname);
  }, [filters, view]);

  // While a sync runs, pull fresh data every few seconds so progress and prices update.
  useEffect(() => {
    if (!syncing) return;
    const t = setInterval(() => startTransition(() => reload()), 3000);
    return () => clearInterval(t);
  }, [syncing]);

  const closeForm = () => { setEditing(null); setDupe(null); };
  const act = (fn: () => Promise<Result>, okText: string, after?: () => void) =>
    startTransition(async () => {
      const r = await fn();
      if (!r.ok && r.existing && editing === 'new') return setDupe({ form: dupeForm.current, ...r.existing }); // already in stock: ask
      if (!r.ok) return setMessage({ kind: 'error', text: r.error });
      setMessage({ kind: 'ok', text: okText });
      after?.();
    });

  const set = (k: keyof Filters) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setFilters({ ...filters, [k]: e.target.value });
  const toggle = (k: 'location' | 'condition' | 'status' | 'theme' | 'availability', v: string) => setFilters({ ...filters, [k]: filters[k] === v ? '' : v });
  const statusCounts = useMemo(() => STATUSES.map((st) => ({ status: st, n: sets.reduce((t, s) => t + s.copies.filter((c) => c.status === st).length, 0) })).filter((x) => x.n), [sets]);
  const themed = sets.some((s) => s.theme);
  const dated = sets.some((s) => availability(s));
  const gain = useMemo(() => collectionGain(sets, currency), [sets, currency]);
  const retiring = useMemo(() => sets.filter((s) => retirement(s)?.kind === 'retiring').length, [sets]);
  const remove = (s: SetRow) => act(() => removeSet(s.setNo), s.copies.length > 1 ? `Removed one ${s.name}. ${Math.max(0, s.qty - 1)} left.` : `Removed ${s.name}.`);
  const retry = (s: SetRow) => act(() => relookupSet(s.setNo), `Lookup worked for ${s.name}.`);
  const rowProps = { onEdit: setEditing, onParts: setPartsOf, onRemove: remove, onRetry: retry, pending, money, currency };

  return (
    <div className="space-y-6">
      <CollectionTabs />
      <PageHeader
        title="Sets"
        badge={<span className="text-sm text-fg-3 tabular-nums">{all.count} sets · {all.copies} copies{all.partedOut ? ` · parted out: ${all.partedOut}` : ''}</span>}
        actions={
          <span className="flex flex-wrap items-center gap-2" title={`Signed in as ${user}`}>
            {priced && (
              <Button icon={RefreshCw} loading={syncing} disabled={pending} onClick={() => act(runSync, 'Sync started. Prices update as it goes.')}>
                {syncing ? `Syncing… ${sync.processed}/${sync.total}` : 'Sync BrickLink'}
              </Button>
            )}
            <Link href="/scan" className={buttonClass()}><ScanBarcode aria-hidden className="size-4" />Scan</Link>
            <Button icon={ClipboardList} onClick={() => setPasting(true)}>Paste a list</Button>
            <Button variant="primary" icon={Plus} onClick={() => setEditing('new')}>Add set</Button>
          </span>
        }
      >
        <p>
          {priced ? 'Prices from BrickLink sold history. ' : ''}
          {themed && 'Themes and minifigs from Rebrickable. '}
          {dated && 'Retail prices and retirement dates from Brickset. '}
          Read {inBrowser ? new Date(readAt).toLocaleTimeString() : '…'}
          {sync && !syncing && sync.finishedAt && inBrowser && <> · Last sync {new Date(sync.finishedAt).toLocaleString()}{sync.errors ? ` (${sync.errors} errors)` : ''}</>}.
        </p>
        {sync && !syncing && sync.message && <p className="mt-1 text-danger">Last sync: {sync.message}</p>}
      </PageHeader>

      {message && <Banner kind={message.kind} onDismiss={() => setMessage(null)}>{message.text}</Banner>}
      {all.errors > 0 && <Banner kind="error">{all.errors} set{all.errors === 1 ? '' : 's'} could not be found on BrickLink. Use Retry lookup on the card.</Banner>}
      {retiring > 0 && (
        <p role="status" className="rounded-control bg-warn-soft px-4 py-3 text-sm text-warn">
          {retiring} of your sets {retiring === 1 ? 'is' : 'are'} expected to retire within six months (Brickset). <Link href="/radar" className="font-semibold underline">See the Retirement Radar</Link>
        </p>
      )}

      {/* Phones: one line, so search is reachable without scrolling. */}
      <p className="flex flex-wrap items-baseline gap-x-2 sm:hidden">
        <span className="text-sm text-fg-3">Est. Value</span>
        <span className="text-2xl font-extrabold tracking-tight tabular-nums [font-stretch:112%]">{money(all.estValue)}</span>
        {trend && (
          <span className="text-sm text-fg-3">
            <b className={trend.change >= 0 ? 'text-ok' : 'text-danger'}>{trend.change >= 0 ? '+' : '−'}{money(Math.abs(trend.change))}</b> since {trend.since}
          </span>
        )}
        {gain && <RetailGainLine gain={gain} money={money} className="basis-full text-sm" />}
      </p>
      <section aria-label="Collection value" className="hidden gap-8 sm:grid md:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
        <div>
          <p className="text-sm text-fg-3">Est. Value</p>
          <p className="text-6xl font-extrabold leading-none tracking-tight tabular-nums [font-stretch:115%]">{money(all.estValue)}</p>
          <p className="mt-3 max-w-sm text-sm text-fg-3">
            {priced
              ? 'BrickLink average sold price for each set’s condition, less missing pieces.'
              : 'From the BrickLink sold prices stored at the last sync, less missing pieces. Add BrickLink keys to keep them current.'}
          </p>
          {gain && <RetailGainLine gain={gain} money={money} className="mt-2 max-w-sm text-sm" />}
          {all.gain !== null && (
            <p className="mt-1 max-w-sm text-sm text-fg-3">
              Cost basis {money(all.costBasis)} · <b className={all.gain >= 0 ? 'text-ok' : 'text-danger'}>{all.gain >= 0 ? '+' : '−'}{money(Math.abs(all.gain))}</b> on the copies with a price paid and a value
            </p>
          )}
        </div>
        <ValueChart history={history} money={money} />
      </section>

      <div className="flex flex-wrap gap-3">
        <SearchInput value={filters.q} onChange={set('q')} placeholder="Search name, set #, theme, location…" aria-label="Search sets" />
        <Select label="Sort" value={filters.sort} onChange={set('sort')} options={[['setNo', 'Set #'], ['value', 'Est. Value'], ['name', 'Name'], ['year', 'Year']]} />
        <Segmented label="View" value={view} onChange={setView} options={[{ value: 'cards', label: 'Cards', icon: LayoutGrid }, { value: 'table', label: 'Table', icon: Rows3 }]} />
      </div>

      <section aria-label="Filters" className="space-y-2 text-sm">
        {(['location', 'condition', ...(themed ? ['theme'] as const : []), ...(dated ? ['availability'] as const : [])] as const).map((k) => (
          <div key={k} className="-mx-4 flex items-center gap-2 overflow-x-auto px-4 pb-1 [mask-image:linear-gradient(to_right,black_85%,transparent)] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0 sm:[mask-image:none]">
            <span className="w-20 shrink-0 text-sm capitalize text-fg-3">{k}</span>
            {groupTotals(sets, k).filter((g) => k !== 'availability' || g.label !== '(none)').map((g) => (
              <FilterChip key={g.label} active={filters[k] === g.label} onClick={() => toggle(k, g.label)}>
                {g.label} · {g.count} · <span className="tabular-nums">{money(g.estValue)}</span>
              </FilterChip>
            ))}
          </div>
        ))}
        {statusCounts.length > 1 && (
          <div className="-mx-4 flex items-center gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0">
            <span className="w-20 shrink-0 text-sm text-fg-3">Status</span>
            {statusCounts.map((x) => (
              <FilterChip key={x.status} active={filters.status === x.status} onClick={() => toggle('status', x.status)}>
                {STATUS_LABEL[x.status]} · <span className="tabular-nums">{x.n}</span>
              </FilterChip>
            ))}
          </div>
        )}
        {shown.length < all.count && (
          <p className="text-fg-3">
            Showing <b className="text-fg">{shown.length}</b> of {all.count} sets · <b className="text-fg tabular-nums">{money(view_.estValue)}</b>
            {' '}<Button variant="link" onClick={() => setFilters({ q: '', location: '', condition: '', status: '', theme: '', availability: '', sort: filters.sort })}>Clear filters</Button>
          </p>
        )}
      </section>

      {filters.location === 'Sell' && (
        <section className="rounded-card border border-warn-ring bg-warn-soft p-4 text-sm text-warn">
          <p className="font-semibold">Sell list: {view_.count} sets, {view_.copies} copies</p>
          <dl className="mt-2 grid grid-cols-2 gap-2 tabular-nums sm:grid-cols-4">
            <div><dt className="text-xs text-warn">At min sold</dt><dd className="font-semibold">{money(view_.minSold)}</dd></div>
            <div><dt className="text-xs text-warn">At avg sold</dt><dd className="font-semibold">{money(view_.avgSold)}</dd></div>
            <div><dt className="text-xs text-warn">At max sold</dt><dd className="font-semibold">{money(view_.maxSold)}</dd></div>
            <div><dt className="text-xs text-warn">Est. Value</dt><dd className="font-semibold">{money(view_.estValue)}</dd></div>
          </dl>
          <p className="mt-2 text-xs text-warn">Min/avg/max are full-set sold prices and ignore Missing %; Est. Value includes it.</p>
        </section>
      )}

      {sets.length === 0 && (
        <EmptyState title="Start your collection" action={<Button variant="primary" icon={Plus} onClick={() => setEditing('new')}>Add your first set</Button>}>
          <ol className="mt-1 space-y-1 text-left">
            <li className={priced ? 'text-ok' : ''}>1. {priced ? 'BrickLink keys are set.' : 'Add BrickLink API keys to the server env (see docs/install.md) so prices fill in.'}</li>
            <li>2. Add a set, or import a CSV in <Link href="/settings" className="text-link underline">Settings</Link>.</li>
            <li>3. Run <b>Sync BrickLink</b> to price everything. It also runs daily.</li>
          </ol>
        </EmptyState>
      )}

      {view === 'cards' ? (
        <section className="grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {shown.map((s) => <SetCard key={s.id} s={s} {...rowProps} />)}
        </section>
      ) : (
        <SetTable sets={shown} {...rowProps} />
      )}

      {partsOf && <PartsDialog set={partsOf} priced={priced} onClose={() => { setPartsOf(null); startTransition(() => reload()); }} />}

      {pasting && (
        <QuickAdd
          locations={locations}
          pending={pending}
          onClose={() => setPasting(false)}
          onSubmit={(text, location, condition) => startTransition(async () => {
            const r = await quickAddList(text, location, condition);
            setMessage(r.ok ? { kind: 'ok', text: r.message ?? 'Added.' } : { kind: 'error', text: r.error });
            if (r.ok) setPasting(false);
          })}
        />
      )}

      {editing && (
        <SetForm
          set={editing === 'new' ? null : editing}
          locations={[...new Set([...locations, ...sets.flatMap((x) => x.copies.map((c) => c.location)).filter((l): l is string => !!l)])]}
          pending={pending}
          dupe={dupe}
          money={money}
          onClose={closeForm}
          onAddAnother={() => dupe && act(() => addSet(dupe.form, true), `Added another. You now have ${dupe.qty + 1} of ${dupe.name}.`, closeForm)}
          onSubmit={(form) => {
            if (editing !== 'new') return act(() => editSet(form), 'Saved.', closeForm);
            dupeForm.current = form;
            act(() => addSet(form), 'Added.', closeForm);
          }}
        />
      )}
    </div>
  );
}

/** "Up 23% on retail across 18 sets": the collection against original retail prices from Brickset. */
function RetailGainLine({ gain, money, className }: { gain: { sets: number; retail: number; value: number; gainPct: number }; money: (v: unknown) => string; className?: string }) {
  const up = gain.gainPct >= 0;
  return (
    <span className={className} title={`Retail ${money(gain.retail)} → now ${money(gain.value)} (Brickset retail prices, BrickLink values)`}>
      <b className={up ? 'text-ok' : 'text-danger'}>{up ? 'Up' : 'Down'} {Math.abs(gain.gainPct)}%</b>
      <span className="text-fg-3"> on retail across {gain.sets} set{gain.sets === 1 ? '' : 's'} with a known retail price</span>
    </span>
  );
}
