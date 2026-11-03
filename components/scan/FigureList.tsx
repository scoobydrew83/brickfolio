'use client';
// Many-in-a-row scanning for Collectible Minifigures boxes: each square code becomes a row naming the figure inside,
// from your codes, the community list or the fan-made L-Scan table. Sealed boxes are a guess until opened, so a code
// is only remembered as yours when you pick the figure by hand ("I opened it").
import { Check, CircleHelp, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { cmfChecklistFor } from '@/app/actions';
import type { FigCandidate, FigCode } from '@/lib/barcode/figcodes';
import type { CmfFig, CmfSeries } from '@/lib/service/minifigs';
import { Button, Chip, IconButton, cx, field } from '../ui';
import type { FigLookup } from './useScanNetwork';

export type FigRow = {
  id: string; code: FigCode; status: 'looking' | 'matched' | 'ambiguous' | 'not_found' | 'offline' | 'error';
  candidates: FigCandidate[]; chosen: FigCandidate | null; picked: boolean; remember: boolean; qty: number; message?: string;
};

const KEY = 'brickfolio-scan-figs';
const uid = () => (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`);
const SOURCE: Record<FigCandidate['source'], string> = { user: 'your code', community: 'community list', lscan: 'L-Scan (fan-collected)' };

/** The figure rows of a session, kept in sessionStorage like the set list. */
export function useFigSession(lookupFig: (text: string) => Promise<FigLookup>, feedback: (ok: boolean) => void, announce: (s: string) => void) {
  const [rows, setRowsRaw] = useState<FigRow[]>([]);
  const ref = useRef(rows);
  useEffect(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(KEY) ?? '[]') as FigRow[];
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (saved.length) setRowsRaw(saved.map((r) => (r.status === 'looking' ? { ...r, status: 'offline' } : r)));
    } catch {}
  }, []);
  useEffect(() => { ref.current = rows; }, [rows]);
  const setRows = useCallback((fn: (r: FigRow[]) => FigRow[]) => setRowsRaw((prev) => {
    const next = fn(prev);
    try { sessionStorage.setItem(KEY, JSON.stringify(next)); } catch {}
    return next;
  }), []);

  const lookup = useCallback(async (id: string, code: FigCode) => {
    const r = await lookupFig(code.raw);
    setRows((rs) => rs.map((x) => {
      if (x.id !== id) return x;
      if (r.status === 'offline') return { ...x, status: 'offline' };
      if (r.status === 'error') return { ...x, status: 'error', message: r.error };
      if (r.status === 'invalid') return { ...x, status: 'error', message: r.error };
      return { ...x, status: r.status, candidates: r.candidates, chosen: r.status === 'matched' ? r.candidates[0] : null };
    }));
    const ok = r.status === 'matched';
    feedback(ok);
    announce(ok ? `${r.candidates[0].name}.` : r.status === 'offline' ? 'Offline: kept to look up later.' : 'Unknown figure code. Pick the figure in the list.');
  }, [lookupFig, setRows, feedback, announce]);

  const onFigCode = useCallback((code: FigCode) => {
    const same = ref.current.find((r) => r.code.code === code.code && r.code.factory === code.factory && r.code.year === code.year);
    if (same) {
      setRows((rs) => rs.map((r) => (r.id === same.id ? { ...r, qty: Math.min(99, r.qty + 1) } : r)));
      feedback(true);
      announce(`${same.chosen?.name ?? 'Same figure'}: ${same.qty + 1}.`);
      return;
    }
    const row: FigRow = { id: uid(), code, status: 'looking', candidates: [], chosen: null, picked: false, remember: false, qty: 1 };
    ref.current = [row, ...ref.current];
    setRows((rs) => [row, ...rs]);
    void lookup(row.id, code);
  }, [lookup, setRows, feedback, announce]);

  /** Looks up again the rows scanned while offline. */
  const retryOffline = useCallback(() => { for (const r of ref.current) if (r.status === 'offline') { setRows((rs) => rs.map((x) => (x.id === r.id ? { ...x, status: 'looking' } : x))); void lookup(r.id, r.code); } }, [lookup, setRows]);

  return { rows, setRows, onFigCode, retryOffline };
}

export function FigureList({ rows, setRows, series, pending, onSubmit }: {
  rows: FigRow[]; setRows: (fn: (r: FigRow[]) => FigRow[]) => void; series: CmfSeries[]; pending: boolean; onSubmit: () => void;
}) {
  const ready = rows.filter((r) => r.chosen?.rbFigNo);
  const copies = ready.reduce((t, r) => t + r.qty, 0);
  const change = (id: string, patch: Partial<FigRow>) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  if (!rows.length) return <p className="rounded-card border border-dashed border-line-strong p-6 text-center text-sm text-fg-3">Scan the square code on the bottom of a Collectible Minifigures box. Cover the ordinary barcode next to it if the camera picks that up instead.</p>;
  return (
    <section aria-label="Scanned minifigures" className="space-y-3">
      <p className="text-sm text-fg-2">{rows.length} scanned · {ready.length} {ready.length === 1 ? 'figure' : 'figures'}, {copies} {copies === 1 ? 'copy' : 'copies'} ready{rows.length > ready.length ? <> · <b className="text-warn">{rows.length - ready.length} to sort out</b></> : null}</p>
      <ul className="divide-y divide-line rounded-card border border-line bg-surface">
        {rows.map((r) => <FigRowView key={r.id} r={r} series={series} onChange={(p) => change(r.id, p)} onRemove={() => setRows((rs) => rs.filter((x) => x.id !== r.id))} />)}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" icon={Check} loading={pending} disabled={!ready.length} onClick={onSubmit}>Add {ready.length} {ready.length === 1 ? 'figure' : 'figures'}</Button>
        <Button variant="ghost" onClick={() => { if (window.confirm('Clear the scanned list?')) setRows(() => []); }}>Clear list</Button>
      </div>
      <p className="text-xs text-fg-3">Box codes come from collectors, not LEGO, and the same figure has different codes per factory. Treat a match on a sealed box as a good guess.</p>
    </section>
  );
}

function FigRowView({ r, series, onChange, onRemove }: { r: FigRow; series: CmfSeries[]; onChange: (p: Partial<FigRow>) => void; onRemove: () => void }) {
  const [picking, setPicking] = useState(false);
  const c = r.chosen;
  const needsPick = !c || !c.rbFigNo;
  return (
    <li className="space-y-2 p-3">
      <div className="flex items-start gap-3">
        <div className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-control bg-muted">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {c?.imageUrl ? <img src={c.imageUrl} alt="" referrerPolicy="no-referrer" className="size-full object-contain" /> : <CircleHelp aria-hidden className="size-5 text-fg-4" />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{c ? c.name : r.status === 'looking' ? 'Looking up…' : r.status === 'ambiguous' ? 'One of several figures' : r.status === 'offline' ? 'Offline: looked up when you’re back' : r.status === 'error' ? 'Lookup failed' : 'Unknown code'}</p>
          <p className="text-xs text-fg-3">
            <span className="font-mono">{r.code.code}{r.code.factory ? ` ${r.code.factory}${r.code.year}` : ''}</span>
            {c && <> · {c.series} · {r.picked ? 'picked by you' : SOURCE[c.source]}</>}
            {c && !c.exact && !r.picked && r.code.factory && <> · known for another factory</>}
            {r.message && <> · {r.message}</>}
          </p>
          <p className="mt-1 flex flex-wrap gap-1.5">
            {c?.owned ? <Chip tone="ok">You own {c.owned}</Chip> : null}
            {c && !c.rbFigNo && <Chip tone="warn">Pick it from the checklist to add it</Chip>}
          </p>
        </div>
        {!needsPick && (
          <span className="inline-flex items-center rounded-control border border-line-strong text-sm">
            <button type="button" aria-label={`Fewer copies of ${c!.name}`} className="px-2 py-1" disabled={r.qty <= 1} onClick={() => onChange({ qty: r.qty - 1 })}>−</button>
            <span className="w-6 text-center font-semibold tabular-nums">{r.qty}</span>
            <button type="button" aria-label={`More copies of ${c!.name}`} className="px-2 py-1" disabled={r.qty >= 99} onClick={() => onChange({ qty: r.qty + 1 })}>+</button>
          </span>
        )}
        <IconButton icon={Trash2} tone="danger" label="Remove from the list" onClick={onRemove} />
      </div>
      {r.status === 'ambiguous' && !c && (
        <div className="flex flex-wrap gap-2 pl-15">
          {r.candidates.map((x) => <Button key={`${x.series}|${x.name}`} size="sm" onClick={() => onChange({ chosen: x })}>{x.name} ({x.series})</Button>)}
        </div>
      )}
      <div className="pl-15">
        {picking || (needsPick && r.status !== 'looking' && r.status !== 'ambiguous')
          ? <FigPicker series={series} hint={c?.series ?? r.candidates[0]?.series} remember={r.remember || r.status === 'not_found'} onPick={(fig, remember) => { onChange({ chosen: fig, picked: true, remember }); setPicking(false); }} onCancel={picking ? () => setPicking(false) : undefined} />
          : c && <button type="button" className="text-xs text-link hover:underline" onClick={() => setPicking(true)}>Wrong figure? Pick it</button>}
      </div>
    </li>
  );
}

/** Pick a figure from a series' Rebrickable checklist (loaded on demand). */
function FigPicker({ series, hint, remember: rememberDefault, onPick, onCancel }: {
  series: CmfSeries[]; hint?: string; remember: boolean; onPick: (f: FigCandidate, remember: boolean) => void; onCancel?: () => void;
}) {
  const guess = series.find((s) => hint && s.name.toLowerCase().includes(hint.toLowerCase().replace(/ series$/, '')));
  const [themeId, setThemeId] = useState<number | null>(guess?.themeId ?? null);
  const [figs, setFigs] = useState<CmfFig[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [remember, setRemember] = useState(rememberDefault);
  const [pending, start] = useTransition();
  useEffect(() => {
    if (themeId === null) return;
    start(async () => {
      const r = await cmfChecklistFor(themeId).catch(() => ({ ok: false as const, error: 'You’re offline. Pick the figure once you’re back online.' }));
      if (r.ok) { setFigs(r.figs); setError(null); } else { setFigs(null); setError(r.error); }
    });
  }, [themeId]);
  if (!series.length) return <p className="text-xs text-fg-3">Picking a figure needs the Collectible Minifigures series from Rebrickable (REBRICKABLE_API_KEY and a theme sync).</p>;
  const name = series.find((s) => s.themeId === themeId)?.name ?? '';
  return (
    <div className="space-y-2 rounded-control bg-subtle p-3">
      <label className="block text-sm">Series
        <select value={themeId ?? ''} onChange={(e) => setThemeId(e.target.value ? Number(e.target.value) : null)} className={field}>
          <option value="">Pick the series…</option>
          {series.map((s) => <option key={s.themeId} value={s.themeId}>{s.name}</option>)}
        </select>
      </label>
      {pending && <p className="text-xs text-fg-3">Loading the checklist…</p>}
      {error && <p className="text-xs text-danger">{error}</p>}
      {figs && (
        <ul className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
          {figs.map((f) => (
            <li key={f.rbFigNo}>
              <button type="button" onClick={() => onPick({ name: f.name, series: name, rbFigNo: f.rbFigNo, imageUrl: f.imageUrl, themeId, source: 'user', verified: true, exact: true, owned: f.owned }, remember)}
                className={cx('w-full rounded-control border border-line bg-surface px-2 py-1.5 text-left text-xs hover:bg-muted')}>
                {f.name}{f.owned ? <span className="text-ok"> · own {f.owned}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      )}
      <label className="flex items-center gap-2 text-xs">
        <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="size-4 accent-primary" />
        I opened the box: remember this code for this figure
      </label>
      {onCancel && <button type="button" className="text-xs text-link hover:underline" onClick={onCancel}>Cancel</button>}
    </div>
  );
}
