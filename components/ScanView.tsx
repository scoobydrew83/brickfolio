'use client';
// Scan barcodes: one box at a time (scan, check, add), many in a row (keep scanning, review the list, add once), or
// Collectible Minifigures boxes by their square code. The set number can also be read off the box (OCR). Works
// offline: known boxes resolve from the saved barcodes on the device, and adds wait there until the connection is
// back (components/scan/useScanNetwork.ts). The camera and decoding stay in the browser (components/scan).
import Link from 'next/link';
import { Check, CircleHelp, CloudUpload, Heart, Keyboard, ListChecks, Minus, PersonStanding, Plus, ScanBarcode, ScanText, Trash2, TriangleAlert, Vibrate, Volume2, VolumeX, WifiOff } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { forgetScan } from '@/app/actions';
import { createRepeatGuard, parseBarcode, type Barcode } from '@/lib/barcode/gtin';
import type { BarcodeCapabilities } from '@/lib/barcode/providers';
import type { Resolution, ScanCandidate } from '@/lib/barcode/resolve';
import type { OcrPaths } from '@/lib/barcode/ocr';
import type { CmfSeries } from '@/lib/service/minifigs';
import { CONDITIONS, displayNo, type Condition } from '@/lib/sets';
import { Banner, Button, Chip, IconButton, Segmented, cx, field } from './ui';
import { PageHeader } from './shell/PageHeader';
import { Scanner } from './scan/Scanner';
import { useScanNetwork, type SetLookup } from './scan/useScanNetwork';
import { FigureList, useFigSession } from './scan/FigureList';
import { cachedImageSrc, fallBackTo } from '@/lib/images/url';
import { readSetNumbers } from './scan/ocr';
import type { Pending } from './scan/outbox';

type Mode = 'single' | 'batch' | 'minifig';
type Target = 'collection' | 'wishlist';
type Resolved = Extract<Resolution, { status: 'matched' | 'ambiguous' | 'not_found' }>;
type Lookup = SetLookup;

/** One box in a many-in-a-row session. Kept in sessionStorage so a reload or a detour doesn't lose it. */
type Row = {
  id: string; barcode: Barcode | null; status: 'looking' | 'matched' | 'ambiguous' | 'not_found' | 'offline' | 'error';
  set: ScanCandidate | null; candidates: ScanCandidate[]; qty: number; target: Target; message?: string;
};

const SESSION = 'brickfolio-scan-session';
const PREFS = 'brickfolio-scan-prefs';
const uid = () => (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`);
const read = <T,>(store: 'local' | 'session', key: string, fallback: T): T => {
  try { const v = (store === 'local' ? localStorage : sessionStorage).getItem(key); return v ? (JSON.parse(v) as T) : fallback; } catch { return fallback; }
};
const write = (store: 'local' | 'session', key: string, value: unknown) => {
  try { (store === 'local' ? localStorage : sessionStorage).setItem(key, JSON.stringify(value)); } catch {}
};

/** A short beep through Web Audio: no sound file to load. Silently does nothing where audio isn't allowed. */
let audio: AudioContext | null = null;
function beep(ok: boolean) {
  try {
    audio ??= new AudioContext();
    const o = audio.createOscillator(), g = audio.createGain();
    o.frequency.value = ok ? 1200 : 300;
    g.gain.value = 0.08;
    o.connect(g).connect(audio.destination);
    o.start();
    o.stop(audio.currentTime + (ok ? 0.08 : 0.2));
  } catch {}
}

const setLabel = (c: ScanCandidate) => c.name || `Set ${displayNo(c.setNo)}`;

type Props = { locations: string[]; caps: BarcodeCapabilities; demo: boolean; series: CmfSeries[]; ocr: OcrPaths };

export default function ScanView({ locations, caps, demo, series, ocr }: Props) {
  const guard = useMemo(() => createRepeatGuard(), []);
  const [mode, setModeRaw] = useState<Mode>('single');
  const [prefs, setPrefs] = useState({ sound: true, vibrate: true });
  const [autoStart, setAutoStart] = useState<boolean | null>(null);
  const [current, setCurrent] = useState<{ barcode: Barcode | null; res: Lookup | null; preset?: ScanCandidate } | null>(null);
  const [rows, setRowsRaw] = useState<Row[]>([]);
  const [batchKey, setBatchKey] = useState<string>(() => uid());
  const [defaults, setDefaults] = useState<{ condition: Condition; location: string }>({ condition: 'New', location: '' });
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [status, setStatus] = useState(''); // read out by screen readers
  const [manual, setManual] = useState(false);
  const [pending, startTransition] = useTransition();
  const modeRef = useRef(mode);
  const video = useRef<HTMLVideoElement | null>(null);
  const [ocrState, setOcrState] = useState<{ reading: boolean; numbers: string[] | null; error?: string }>({ reading: false, numbers: null });
  const net = useScanNetwork({
    onSent: useCallback((text: string) => setMessage({ kind: 'ok', text: `Sent what was waiting: ${text}` }), []),
    onRefused: useCallback((error: string) => setMessage({ kind: 'error', text: `A waiting batch was refused: ${error}` }), []),
  });

  // Browser-only state after the first render, so the server and client render the same thing first.
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    const m = read('local', PREFS, { mode: 'single' as Mode }).mode;
    setModeRaw(m === 'batch' || m === 'minifig' ? m : 'single');
    setPrefs({ sound: true, vibrate: true, ...read('local', PREFS, {}) });
    const saved = read<{ rows: Row[]; key: string } | null>('session', SESSION, null);
    if (saved?.rows?.length) { setRowsRaw(saved.rows.map((r) => (r.status === 'looking' ? { ...r, status: 'error', message: 'Interrupted. Look it up again.' } : r))); setBatchKey(saved.key || uid()); }
    let started = false;
    try { started = sessionStorage.getItem('brickfolio-camera') === 'on'; } catch {}
    setAutoStart(started);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  const setRows = useCallback((fn: (r: Row[]) => Row[]) => setRowsRaw((prev) => { const next = fn(prev); write('session', SESSION, { rows: next, key: batchKey }); return next; }), [batchKey]);
  const setMode = (m: Mode) => { setModeRaw(m); setCurrent(null); write('local', PREFS, { ...prefs, mode: m }); };
  const savePrefs = (p: typeof prefs) => { setPrefs(p); write('local', PREFS, { ...p, mode }); };
  const feedback = useCallback((ok: boolean) => {
    if (prefs.sound) beep(ok);
    if (prefs.vibrate) navigator.vibrate?.(ok ? 60 : [80, 60, 80]);
  }, [prefs]);

  // ---- one at a time ----

  const lookupOne = useCallback((barcode: Barcode, refresh = false) => {
    setCurrent({ barcode, res: null });
    setStatus(`Barcode ${barcode.raw} read. Looking it up.`);
    startTransition(async () => {
      const res = await net.lookupSet(barcode, refresh);
      setCurrent({ barcode, res });
      const found = res.status === 'matched' || res.status === 'ambiguous';
      feedback(found);
      setStatus(res.status === 'matched' ? `Found ${setLabel(res.candidates[0])}.` : res.status === 'ambiguous' ? `${res.candidates.length} possible sets. Pick one.` : res.status === 'error' ? res.error : res.status === 'offline' ? 'Offline and not saved on this device. Type or read the set number.' : 'No set found for this barcode.');
    });
  }, [feedback, net]);

  // ---- many in a row ----

  const lookupRow = useCallback((id: string, barcode: Barcode) => {
    startTransition(async () => {
      const res = await net.lookupSet(barcode);
      setRows((rs) => rs.map((r) => {
        if (r.id !== id) return r;
        if (res.status === 'error') return { ...r, status: 'error', message: res.error };
        if (res.status === 'offline') return { ...r, status: 'offline' };
        return { ...r, status: res.status, set: res.status === 'matched' ? res.candidates[0] : null, candidates: res.candidates, target: res.status === 'matched' && res.candidates[0].owned ? 'collection' : r.target };
      }));
      feedback(res.status === 'matched');
      setStatus(res.status === 'matched' ? `Added ${setLabel(res.candidates[0])} to the list.` : res.status === 'ambiguous' ? 'Several possible sets. Pick one in the list.' : res.status === 'offline' ? 'Offline: kept to look up later.' : 'Not found. Enter the set number in the list.');
    });
  }, [feedback, setRows, net]);

  const rowsRef = useRef(rows);
  // The camera callback reads these without re-subscribing on every change.
  useEffect(() => { modeRef.current = mode; rowsRef.current = rows; }, [mode, rows]);
  const onDetected = useCallback((barcode: Barcode) => {
    if (modeRef.current === 'single') return lookupOne(barcode);
    const same = rowsRef.current.find((r) => r.barcode?.gtin === barcode.gtin);
    if (same) {
      // The box left the frame and came back: another copy.
      setRows((rs) => rs.map((r) => (r.id === same.id ? { ...r, qty: Math.min(999, r.qty + 1) } : r)));
      feedback(true);
      setStatus(`${same.set ? setLabel(same.set) : barcode.raw}: ${same.qty + 1} copies.`);
      return;
    }
    const row: Row = { id: uid(), barcode, status: 'looking', set: null, candidates: [], qty: 1, target: 'collection' };
    rowsRef.current = [row, ...rowsRef.current]; // so a second read before the next render sees it
    setRows((rs) => [row, ...rs]);
    lookupRow(row.id, barcode);
  }, [lookupOne, lookupRow, feedback, setRows]);

  const typedBarcode = (text: string) => {
    const b = parseBarcode(text);
    if (!b.ok) return b.error;
    const { ok: _, ...barcode } = b;
    onDetected(barcode);
    return null;
  };

  const typedSet = (no: string, then: (c: ScanCandidate) => void) => startTransition(async () => {
    const r = await net.describe(no);
    if (!r.ok) return setMessage({ kind: 'error', text: r.error });
    then(r.set);
  });

  // ---- saving ----

  const save = (
    items: { setNo: string; qty: number; target: Target }[], remember: { barcode: Barcode; setNo: string }[], key: string, done: (text: string) => void,
    figs: Pending['figs'] = [], rememberFigs: Pending['rememberFigs'] = [],
  ) =>
    startTransition(async () => {
      const payload = items.map((i) => ({ ...i, condition: i.target === 'wishlist' && defaults.condition === 'Partial' ? 'Used' : defaults.condition, location: i.target === 'collection' ? defaults.location || null : null }));
      const n = items.reduce((t, i) => t + i.qty, 0), f = figs.reduce((t, i) => t + i.qty, 0);
      const label = [n && `${n} ${n === 1 ? 'set' : 'sets'}`, f && `${f} ${f === 1 ? 'minifigure' : 'minifigures'}`].filter(Boolean).join(', ');
      const r = await net.submit({ key, items: payload, figs, remember: remember.map((m) => ({ barcode: m.barcode.raw, format: m.barcode.format, setNo: m.setNo })), rememberFigs, label });
      if (r.state === 'refused') { setMessage({ kind: 'error', text: `Not saved: ${r.error}` }); return; }
      const text = r.state === 'saved' ? r.message : `You’re offline, so ${label} ${n + f === 1 ? 'is' : 'are'} kept on this device and will be added when you’re back online. Not in your collection yet.`;
      setMessage({ kind: 'ok', text });
      setStatus(text);
      done(text);
    });

  // ---- minifigures ----

  const figSession = useFigSession(net.lookupFig, feedback, setStatus);

  // ---- reading the set number off the box ----

  const readNumber = () => {
    const v = video.current;
    if (!v || !v.videoWidth) { setOcrState({ reading: false, numbers: null, error: 'Start the camera and point it at the front of the box first.' }); return; }
    setOcrState({ reading: true, numbers: null });
    setStatus('Reading the set number…');
    readSetNumbers(v, ocr)
      .then((numbers) => { setOcrState({ reading: false, numbers, error: numbers.length ? undefined : 'No number found. Fill the frame with the number and try again.' }); setStatus(numbers.length ? `Read ${numbers.join(', ')}. Pick the set number.` : 'No number found.'); })
      .catch((e: unknown) => setOcrState({ reading: false, numbers: null, error: e instanceof Error ? e.message : String(e) }));
  };
  /** A number read off the box: completes the unknown barcode on screen, or starts a new entry. */
  const pickNumber = (no: string) => {
    setOcrState({ reading: false, numbers: null });
    typedSet(no, (c) => {
      if (mode === 'single') {
        if (current?.barcode && current.res && current.res.status !== 'matched') setCurrent({ ...current, preset: c });
        else setCurrent({ barcode: null, res: { status: 'matched', barcode: { raw: '', format: 'EAN_13', gtin: '' }, candidates: [c], providers: [], noProviders: false } });
      } else {
        const open = rowsRef.current[0];
        if (open && !open.set && open.status !== 'looking') setRows((rs) => rs.map((x) => (x.id === open.id ? { ...x, status: 'matched', set: c } : x)));
        else setRows((rs) => [{ id: uid(), barcode: null, status: 'matched', set: c, candidates: [c], qty: 1, target: 'collection' }, ...rs]);
      }
    });
  };

  // Back online: look up what was scanned offline.
  useEffect(() => {
    if (!net.online) return;
    for (const r of rowsRef.current) if (r.status === 'offline' && r.barcode) lookupRow(r.id, r.barcode);
    figSession.retryOffline();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [net.online]);

  const unresolved = rows.filter((r) => !r.set).length;
  const ready = rows.filter((r) => r.set);
  const copies = ready.reduce((t, r) => t + r.qty, 0);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Scan barcodes"
        actions={<Segmented label="Scan mode" value={mode} onChange={setMode} options={[{ value: 'single', label: 'One at a time', icon: ScanBarcode }, { value: 'batch', label: 'Many in a row', icon: ListChecks }, { value: 'minifig', label: 'Minifigures', icon: PersonStanding }]} />}
      >
        <p>
          {mode === 'single' ? 'Scan a box, check the set, add it.' : mode === 'batch' ? 'Keep scanning boxes, then review the list and add them all at once. Scan a box again (after taking it out of view) for another copy.' : 'Scan the square code on the bottom of Collectible Minifigures boxes to see which figure is inside, then add them.'}
          {' '}Codes are read on this device; nothing from the camera is uploaded.
        </p>
      </PageHeader>

      <p role="status" aria-live="polite" className="sr-only">{status}</p>
      {message && <Banner kind={message.kind} onDismiss={() => setMessage(null)}>{message.text}</Banner>}
      {demo && <Banner kind="ok">This is the demo: scanning works with the sample barcodes (type 2000000104973), but nothing is saved.</Banner>}
      {!net.online && (
        <p role="status" className="flex items-start gap-2 rounded-control bg-warn-soft px-4 py-3 text-sm text-warn">
          <WifiOff aria-hidden className="mt-0.5 size-4 shrink-0" />
          <span>You’re offline. Boxes saved on this device are still recognised{net.map ? ` (${Object.keys(net.map.barcodes).length} barcodes, as of ${new Date(net.map.at).toLocaleString()})` : ''}; the rest are looked up when you’re back. Anything you add waits here until then.</span>
        </p>
      )}
      {net.outbox.length > 0 && <Outbox list={net.outbox} online={net.online} pending={pending} onSend={() => startTransition(async () => { await net.flush(); })} onDiscard={net.discard} />}
      {mode !== 'minifig' && <LookupNote caps={caps} />}

      <div className="grid gap-5 lg:grid-cols-2 lg:items-start">
        <div className="space-y-3 lg:sticky lg:top-20">
          {autoStart !== null && <Scanner guard={guard} autoStart={autoStart} kind={mode === 'minifig' ? 'minifig' : 'retail'} videoRef={video} active={mode !== 'single' || !current} onDetected={onDetected} onFigCode={figSession.onFigCode} />}
          <div className="flex flex-wrap items-center gap-2">
            {mode !== 'minifig' && <Button variant="ghost" size="sm" icon={ScanText} loading={ocrState.reading} onClick={readNumber}>Read the set number</Button>}
            {mode !== 'minifig' && <Button variant="ghost" size="sm" icon={Keyboard} aria-expanded={manual} onClick={() => setManual(!manual)}>Type it</Button>}
            <span className="flex-1" />
            <IconButton icon={prefs.sound ? Volume2 : VolumeX} label={prefs.sound ? 'Beep on scan: on' : 'Beep on scan: off'} aria-pressed={prefs.sound} onClick={() => savePrefs({ ...prefs, sound: !prefs.sound })} />
            <IconButton icon={Vibrate} label={prefs.vibrate ? 'Vibrate on scan: on' : 'Vibrate on scan: off'} aria-pressed={prefs.vibrate} className={prefs.vibrate ? '' : 'opacity-40'} onClick={() => savePrefs({ ...prefs, vibrate: !prefs.vibrate })} />
          </div>
          {(ocrState.numbers?.length || ocrState.error) && mode !== 'minifig' ? (
            <div className="rounded-card border border-line bg-surface p-3 text-sm" aria-live="polite">
              {ocrState.error ? <p className="text-fg-3">{ocrState.error}</p> : (
                <>
                  <p className="text-fg-2">Which one is the set number?</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {ocrState.numbers!.map((n) => <Button key={n} size="sm" onClick={() => pickNumber(n)}>{n}</Button>)}
                    <Button size="sm" variant="ghost" onClick={() => setOcrState({ reading: false, numbers: null })}>None of these</Button>
                  </div>
                </>
              )}
            </div>
          ) : null}
          {manual && mode !== 'minifig' && (
            <ManualEntry
              pending={pending}
              onBarcode={typedBarcode}
              onSet={(no) => typedSet(no, (c) => {
                if (mode === 'single') setCurrent({ barcode: null, res: { status: 'matched', barcode: { raw: '', format: 'EAN_13', gtin: '' }, candidates: [c], providers: [], noProviders: false } });
                else setRows((rs) => [{ id: uid(), barcode: null, status: 'matched', set: c, candidates: [c], qty: 1, target: 'collection' }, ...rs]);
              })}
            />
          )}
          {mode !== 'minifig' && <Defaults locations={locations} value={defaults} onChange={setDefaults} />}
        </div>

        <div className="space-y-4">
          {mode === 'single' && !current && (
            <p className="rounded-card border border-dashed border-line-strong p-6 text-center text-sm text-fg-3">Scanned sets show up here.</p>
          )}
          {mode === 'single' && current && (
            <SingleResult
              key={`${current.barcode?.gtin ?? 'manual'}-${current.res?.status ?? 'looking'}-${current.preset?.setNo ?? ''}`}
              current={current}
              caps={caps}
              pending={pending}
              onRetry={() => current.barcode && lookupOne(current.barcode, true)}
              onPick={(no, then) => typedSet(no, then)}
              onForget={(c) => startTransition(async () => {
                const r = await forgetScan(current.barcode!.raw, c.setNo);
                if (!r.ok) return setMessage({ kind: 'error', text: r.error });
                setCurrent({ barcode: current.barcode, res: { status: 'not_found', barcode: current.barcode!, candidates: [], providers: [], noProviders: false } });
              })}
              onSave={(c, qty, target, remember) => save(
                [{ setNo: c.setNo, qty, target }],
                remember && current.barcode ? [{ barcode: current.barcode, setNo: c.setNo }] : [],
                uid(),
                () => setCurrent(null),
              )}
              onNext={() => setCurrent(null)}
            />
          )}
          {mode === 'minifig' && (
            <FigureList
              rows={figSession.rows}
              setRows={figSession.setRows}
              series={series}
              pending={pending}
              onSubmit={() => {
                const ready = figSession.rows.filter((r) => r.chosen?.rbFigNo);
                save([], [], uid(), () => figSession.setRows((rs) => rs.filter((r) => !r.chosen?.rbFigNo)),
                  ready.map((r) => ({ rbFigNo: r.chosen!.rbFigNo!, name: r.chosen!.name, imageUrl: r.chosen!.imageUrl, qty: r.qty })),
                  ready.filter((r) => r.picked && r.remember).map((r) => ({ code: r.code.raw, name: r.chosen!.name, series: r.chosen!.series, rbFigNo: r.chosen!.rbFigNo })));
              }}
            />
          )}
          {mode === 'batch' && (
            <BatchList
              rows={rows}
              pending={pending}
              onChange={(id, patch) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)))}
              onRemove={(id) => setRows((rs) => rs.filter((r) => r.id !== id))}
              onRetry={(r) => { if (r.barcode) { setRows((rs) => rs.map((x) => (x.id === r.id ? { ...x, status: 'looking', message: undefined } : x))); lookupRow(r.id, r.barcode); } }}
              onResolve={(r, no) => typedSet(no, (c) => setRows((rs) => rs.map((x) => (x.id === r.id ? { ...x, status: 'matched', set: c } : x))))}
              summary={<>{rows.length} scanned · {ready.length} {ready.length === 1 ? 'set' : 'sets'}, {copies} {copies === 1 ? 'copy' : 'copies'}{unresolved ? <> · <b className="text-warn">{unresolved} to sort out</b></> : null}</>}
              onClear={() => { setRows(() => []); setBatchKey(uid()); guard.reset(); }}
              onSubmit={() => save(
                ready.map((r) => ({ setNo: r.set!.setNo, qty: r.qty, target: r.target })),
                // Barcodes you sorted out by hand (or picked between) are remembered for next time.
                ready.filter((r) => r.barcode && !r.set!.verified && r.candidates.length !== 1).map((r) => ({ barcode: r.barcode!, setNo: r.set!.setNo })),
                batchKey,
                () => { const left = rows.filter((r) => !r.set); setRowsRaw(left); const k = uid(); setBatchKey(k); write('session', SESSION, { rows: left, key: k }); },
              )}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/** What the lookup can do here, said once, when it can't reach any provider. */
function LookupNote({ caps }: { caps: BarcodeCapabilities }) {
  if (caps.providers.some((p) => p.enabled)) return null;
  return (
    <p className="rounded-control bg-info-soft px-4 py-3 text-sm text-info">
      No barcode lookup service is set up, so Brickfolio knows the barcodes you’ve confirmed{caps.brickset ? ' and those Brickset sends for sets you own or want' : ''}.
      For a new box, type its set number once and it’s remembered. <Link href="/settings#barcodes" className="font-semibold underline">How to add a lookup service</Link>
    </p>
  );
}

function ManualEntry({ pending, onBarcode, onSet }: { pending: boolean; onBarcode: (text: string) => string | null; onSet: (no: string) => void }) {
  const [code, setCode] = useState('');
  const [no, setNo] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="grid gap-3 rounded-card border border-line bg-surface p-4 sm:grid-cols-2">
      <form onSubmit={(e) => { e.preventDefault(); const err = onBarcode(code); setError(err); if (!err) setCode(''); }}>
        <label className="block text-sm">Barcode digits
          <input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="off" placeholder="673419264150" aria-invalid={!!error} aria-describedby={error ? 'barcode-error' : undefined} className={`${field} font-mono`} />
        </label>
        {error && <p id="barcode-error" className="mt-1 text-xs text-danger">{error}</p>}
        <Button type="submit" size="sm" className="mt-2" disabled={!code.trim()}>Look up</Button>
      </form>
      <form onSubmit={(e) => { e.preventDefault(); if (no.trim()) { onSet(no.trim()); setNo(''); } }}>
        <label className="block text-sm">Or a set number
          <input value={no} onChange={(e) => setNo(e.target.value)} inputMode="numeric" autoComplete="off" placeholder="10497" pattern="\d{3,7}(-\d{1,2})?" className={field} />
        </label>
        <Button type="submit" size="sm" className="mt-2" loading={pending} disabled={!no.trim()}>Use this set</Button>
      </form>
    </div>
  );
}

function Defaults({ locations, value, onChange }: { locations: string[]; value: { condition: Condition; location: string }; onChange: (v: { condition: Condition; location: string }) => void }) {
  return (
    <div className="grid grid-cols-2 gap-3 text-sm">
      <label className="block">Condition
        <select value={value.condition} onChange={(e) => onChange({ ...value, condition: e.target.value as Condition })} className={field}>
          {CONDITIONS.map((c) => <option key={c}>{c}</option>)}
        </select>
      </label>
      <label className="block">Location
        <select value={value.location} onChange={(e) => onChange({ ...value, location: e.target.value })} className={field}>
          <option value="">(none)</option>
          {locations.map((l) => <option key={l}>{l}</option>)}
        </select>
      </label>
    </div>
  );
}

/** Photo, name and what you already have. */
function SetSummary({ c, children }: { c: ScanCandidate; children?: React.ReactNode }) {
  return (
    <div className="flex gap-4">
      <div className="flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-control bg-muted">
        {/* A plain img on purpose: provider photos come from any host, and the server must not fetch arbitrary URLs.
            Sets you own come from the image cache instead, so they still show offline. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {c.imageUrl ? <img src={cachedImageSrc('set', c.setNo, c.imageUrl, !!c.owned)!} alt="" referrerPolicy="no-referrer" onError={fallBackTo(c.imageUrl)} className="size-full object-contain" /> : <ScanBarcode aria-hidden className="size-8 text-fg-4" />}
      </div>
      <div className="min-w-0 space-y-1">
        <p className="text-lg font-bold leading-tight">{setLabel(c)}</p>
        <p className="text-sm text-fg-3 tabular-nums">#{displayNo(c.setNo)}{c.year ? ` · ${c.year}` : ''}{c.pieces ? ` · ${c.pieces.toLocaleString()} pieces` : ''}</p>
        <p className="flex flex-wrap gap-1.5">
          {c.owned ? <Chip tone="ok">You own {c.owned.qty}{c.owned.condition ? ` · ${c.owned.condition}` : ''}{c.owned.location ? ` · ${c.owned.location}` : ''}</Chip> : <Chip>Not in your collection</Chip>}
          {c.wished && <Chip tone="primary">On your wishlist</Chip>}
        </p>
        {children}
      </div>
    </div>
  );
}

const sourceText = (c: ScanCandidate) =>
  c.source === 'user' ? 'Barcode you confirmed' : c.source === 'brickset' ? 'Barcode from Brickset' : `Found by ${c.source === 'comparethebricks' ? 'CompareTheBricks' : 'BrickEconomy'}`;

function SingleResult({ current, caps, pending, onRetry, onPick, onForget, onSave, onNext }: {
  current: { barcode: Barcode | null; res: Lookup | null; preset?: ScanCandidate }; caps: BarcodeCapabilities; pending: boolean;
  onRetry: () => void; onPick: (no: string, then: (c: ScanCandidate) => void) => void; onForget: (c: ScanCandidate) => void;
  onSave: (c: ScanCandidate, qty: number, target: Target, remember: boolean) => void; onNext: () => void;
}) {
  const { barcode, res } = current;
  const [chosen, setChosen] = useState<ScanCandidate | null>(current.preset ?? (res?.status === 'matched' ? res.candidates[0] : null));
  const [qty, setQty] = useState(1);
  const [remember, setRemember] = useState(true);
  const [no, setNo] = useState('');
  const head = barcode && <p className="text-xs text-fg-3">Barcode <span className="font-mono">{barcode.raw}</span></p>;

  if (!res) return <section aria-busy className="space-y-2 rounded-card border border-line bg-surface p-5">{head}<p className="text-sm">Looking it up…</p></section>;
  if (res.status === 'error') {
    return (
      <section className="space-y-3 rounded-card border border-danger-ring bg-danger-soft p-5 text-danger">
        {head}<p className="text-sm">{res.error}</p>
        <span className="flex gap-2"><Button onClick={onRetry}>Try again</Button><Button variant="ghost" onClick={onNext}>Scan another</Button></span>
      </section>
    );
  }
  const needsRemember = !!barcode?.gtin && !!chosen && (res.status !== 'matched' || !chosen.verified);
  const wasMatched = res.status === 'matched' && !current.preset;
  return (
    <section className="space-y-4 rounded-card border border-line bg-surface p-5 shadow-raised">
      {head}
      {res.status === 'ambiguous' && !chosen && (
        <div className="space-y-2">
          <p className="flex items-center gap-2 font-semibold"><CircleHelp aria-hidden className="size-5 text-warn" /> This barcode matches {res.candidates.length} sets. Which one is it?</p>
          <ul className="space-y-2">
            {res.candidates.map((c) => (
              <li key={c.setNo}><button type="button" onClick={() => setChosen(c)} className="w-full rounded-control border border-line p-3 text-left hover:bg-subtle"><SetSummary c={c} /></button></li>
            ))}
          </ul>
        </div>
      )}
      {(res.status === 'not_found' || res.status === 'offline') && !chosen && (
        <div className="space-y-3">
          <p className="flex items-center gap-2 font-semibold"><TriangleAlert aria-hidden className="size-5 text-warn" /> {res.status === 'offline' ? 'Offline, and this barcode isn’t saved on this device' : 'No set found for this barcode'}</p>
          {res.status === 'offline' ? <p className="text-sm text-fg-3">Type the set number or use <b>Read the set number</b>. It’s added and remembered when you’re back online.</p> : <NotFoundReason res={res} caps={caps} onRetry={onRetry} />}
          <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (no.trim()) onPick(no.trim(), setChosen); }}>
            <label className="block flex-1 text-sm">Set number on the box
              <input value={no} onChange={(e) => setNo(e.target.value)} inputMode="numeric" autoFocus autoComplete="off" placeholder="10497" pattern="\d{3,7}(-\d{1,2})?" className={field} />
            </label>
            <Button type="submit" loading={pending} disabled={!no.trim()}>Use this set</Button>
          </form>
        </div>
      )}
      {chosen && (
        <>
          <SetSummary c={chosen}>
            {wasMatched && barcode?.gtin && (
              <p className="text-xs text-fg-3">{sourceText(chosen)} · <button type="button" className="text-link hover:underline" onClick={() => onForget(chosen)}>Wrong set?</button></p>
            )}
          </SetSummary>
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm text-fg-2">{chosen.owned ? 'More copies' : 'Copies'}</span>
            <Stepper value={qty} onChange={setQty} label="copies" />
          </div>
          {needsRemember && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="size-4 accent-primary" />
              Remember this barcode for {displayNo(chosen.setNo)}
            </label>
          )}
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" icon={Check} loading={pending} onClick={() => onSave(chosen, qty, 'collection', needsRemember && remember)}>
              {chosen.owned ? `Add ${qty} more ${qty === 1 ? 'copy' : 'copies'}` : 'Add to collection'}
            </Button>
            {!chosen.wished && !chosen.owned && <Button icon={Heart} disabled={pending} onClick={() => onSave(chosen, 1, 'wishlist', needsRemember && remember)}>Add to wishlist</Button>}
            {chosen.owned && <Link href={`/sets/${chosen.setNo}`} className="inline-flex items-center px-2 text-sm font-medium text-link hover:underline">View set</Link>}
            <Button variant="ghost" onClick={onNext}>Scan another</Button>
          </div>
          {chosen.owned && <p className="text-xs text-fg-3">Your existing entry keeps its condition, location and notes; only the number of copies goes up.</p>}
        </>
      )}
    </section>
  );
}

function NotFoundReason({ res, caps, onRetry }: { res: Resolved; caps: BarcodeCapabilities; onRetry: () => void }) {
  const failed = res.providers.filter((p) => p.outcome !== 'not_found' && p.outcome !== 'unsupported');
  if (res.noProviders) return <p className="text-sm text-fg-3">It isn’t saved yet{caps.brickset ? ' (Brickset sends barcodes only for sets you own or want)' : ''}, and no lookup service is set up. Enter the set number and it’ll be remembered.</p>;
  if (res.cachedMiss) return <p className="text-sm text-fg-3">The lookup services didn’t know it when checked recently. <button type="button" onClick={onRetry} className="text-link hover:underline">Ask again</button></p>;
  if (failed.length) return <p className="text-sm text-fg-3">{failed.map((f) => f.message).join(' ')} <button type="button" onClick={onRetry} className="text-link hover:underline">Try again</button></p>;
  if (!res.providers.length) return <p className="text-sm text-fg-3">Enter the set number on the box and this barcode will be remembered.</p>;
  return <p className="text-sm text-fg-3">The lookup services don’t know this barcode. Enter the set number and it’ll be remembered.</p>;
}

function Stepper({ value, onChange, label }: { value: number; onChange: (n: number) => void; label: string }) {
  return (
    <span className="inline-flex items-center rounded-control border border-line-strong">
      <IconButton icon={Minus} label={`Fewer ${label}`} disabled={value <= 1} onClick={() => onChange(Math.max(1, value - 1))} />
      <span className="w-8 text-center text-sm font-semibold tabular-nums" aria-live="polite" aria-label={`${value} ${label}`}>{value}</span>
      <IconButton icon={Plus} label={`More ${label}`} disabled={value >= 999} onClick={() => onChange(Math.min(999, value + 1))} />
    </span>
  );
}

function BatchList({ rows, pending, summary, onChange, onRemove, onRetry, onResolve, onClear, onSubmit }: {
  rows: Row[]; pending: boolean; summary: React.ReactNode;
  onChange: (id: string, patch: Partial<Row>) => void; onRemove: (id: string) => void; onRetry: (r: Row) => void;
  onResolve: (r: Row, no: string) => void; onClear: () => void; onSubmit: () => void;
}) {
  const ready = rows.filter((r) => r.set).length;
  if (!rows.length) return <p className="rounded-card border border-dashed border-line-strong p-6 text-center text-sm text-fg-3">Scan a box to start the list.</p>;
  return (
    <section aria-label="Scanned sets" className="space-y-3">
      <p className="text-sm text-fg-2">{summary}</p>
      <ul className="divide-y divide-line rounded-card border border-line bg-surface">
        {rows.map((r) => <BatchRow key={r.id} r={r} pending={pending} onChange={onChange} onRemove={onRemove} onRetry={onRetry} onResolve={onResolve} />)}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" icon={Check} loading={pending} disabled={!ready} onClick={onSubmit}>Add {ready} {ready === 1 ? 'set' : 'sets'}</Button>
        <Button variant="ghost" onClick={() => { if (window.confirm('Clear the scanned list?')) onClear(); }}>Clear list</Button>
      </div>
      {rows.length > ready && <p className="text-xs text-fg-3">Sets still to sort out stay in the list after adding the rest.</p>}
    </section>
  );
}

function BatchRow({ r, pending, onChange, onRemove, onRetry, onResolve }: {
  r: Row; pending: boolean; onChange: (id: string, patch: Partial<Row>) => void; onRemove: (id: string) => void; onRetry: (r: Row) => void; onResolve: (r: Row, no: string) => void;
}) {
  const [no, setNo] = useState('');
  return (
    <li className="space-y-2 p-3">
      <div className="flex items-start gap-3">
        <span aria-hidden className={cx('mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold', r.set ? 'bg-ok-soft text-ok' : 'bg-warn-soft text-warn')}>{r.set ? <Check className="size-4" /> : '?'}</span>
        <div className="min-w-0 flex-1">
          {r.set ? (
            <p className="truncate font-medium">{setLabel(r.set)} <span className="font-normal text-fg-3 tabular-nums">#{displayNo(r.set.setNo)}</span></p>
          ) : (
            <p className="font-medium">{r.status === 'looking' ? 'Looking up…' : r.status === 'ambiguous' ? 'Several possible sets' : r.status === 'error' ? 'Lookup failed' : 'Unknown barcode'}</p>
          )}
          <p className="text-xs text-fg-3">
            {r.barcode ? <span className="font-mono">{r.barcode.raw}</span> : 'Typed in'}
            {r.set?.owned && <> · you own {r.set.owned.qty}</>}
            {r.message && <> · {r.message}</>}
          </p>
        </div>
        {r.set && <Stepper value={r.qty} onChange={(qty) => onChange(r.id, { qty })} label={`copies of ${displayNo(r.set.setNo)}`} />}
        <IconButton icon={Trash2} tone="danger" label="Remove from the list" onClick={() => onRemove(r.id)} />
      </div>
      {r.set && !r.set.owned && (
        <div className="pl-9">
          <Segmented label={`Where ${displayNo(r.set.setNo)} goes`} value={r.target} onChange={(target) => onChange(r.id, { target })} options={[{ value: 'collection', label: 'Collection' }, { value: 'wishlist', label: 'Wishlist' }]} />
        </div>
      )}
      {r.status === 'ambiguous' && !r.set && (
        <div className="flex flex-wrap gap-2 pl-9">
          {r.candidates.map((c) => <Button key={c.setNo} size="sm" onClick={() => onChange(r.id, { set: c, status: 'matched' })}>{setLabel(c)} #{displayNo(c.setNo)}</Button>)}
        </div>
      )}
      {(r.status === 'not_found' || r.status === 'error') && !r.set && (
        <form className="flex flex-wrap items-end gap-2 pl-9" onSubmit={(e) => { e.preventDefault(); if (no.trim()) onResolve(r, no.trim()); }}>
          <label className="block text-sm">Set number
            <input value={no} onChange={(e) => setNo(e.target.value)} inputMode="numeric" autoComplete="off" placeholder="10497" pattern="\d{3,7}(-\d{1,2})?" className={`${field} w-32`} />
          </label>
          <Button type="submit" size="sm" loading={pending} disabled={!no.trim()}>Use</Button>
          {r.status === 'error' && <Button size="sm" variant="ghost" onClick={() => onRetry(r)}>Look up again</Button>}
        </form>
      )}
    </li>
  );
}

/** Adds waiting to be sent: offline ones, and any the server refused (with its answer). */
function Outbox({ list, online, pending, onSend, onDiscard }: { list: Pending[]; online: boolean; pending: boolean; onSend: () => void; onDiscard: (key: string) => void }) {
  const waiting = list.filter((p) => !p.error);
  return (
    <section aria-label="Waiting to be added" className="space-y-2 rounded-card border border-warn-ring bg-warn-soft p-4 text-sm text-warn">
      <p className="flex items-center gap-2 font-semibold"><CloudUpload aria-hidden className="size-4" /> {waiting.length ? `${waiting.length} ${waiting.length === 1 ? 'batch is' : 'batches are'} waiting on this device, not in your collection yet` : 'Not added'}</p>
      <ul className="space-y-1">
        {list.map((p) => (
          <li key={p.key} className="flex flex-wrap items-center gap-2">
            <span>{p.label || 'A batch'} · scanned {new Date(p.at).toLocaleString()}</span>
            {p.error && <><span className="text-danger">Refused: {p.error}</span><Button size="sm" variant="ghost" onClick={() => onDiscard(p.key)}>Discard</Button></>}
          </li>
        ))}
      </ul>
      {waiting.length > 0 && <Button size="sm" icon={CloudUpload} loading={pending} disabled={!online} onClick={onSend}>{online ? 'Send now' : 'Sends when you’re back online'}</Button>}
    </section>
  );
}
