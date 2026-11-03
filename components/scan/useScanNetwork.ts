'use client';
// The Scan page's link to the server, built to survive a bad or missing connection:
// - lookups go to the server, and fall back to the saved barcodes kept on the device (GET /api/v1/barcodes/offline);
// - adds go through the outbox, so they wait on the device when offline and are sent once (idempotency key) later;
// - the service worker (/scan-sw.js) keeps the page itself, so it opens without a connection.
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { describeScanSet, lookupBarcode, lookupFigCode } from '@/app/actions';
import type { Barcode } from '@/lib/barcode/gtin';
import type { FigResolution } from '@/lib/barcode/figcodes';
import { localResolve, offlineCandidate, type OfflineMap } from '@/lib/barcode/offline';
import type { Resolution, ScanCandidate } from '@/lib/barcode/resolve';
import { enqueue, flushOutbox, loadOutbox, discard as discardPending, type Pending } from './outbox';

type Resolved = Extract<Resolution, { status: 'matched' | 'ambiguous' | 'not_found' }>;
/** `offline` = couldn't reach the server and the barcode isn't saved on the device: look it up again later. */
export type SetLookup = Resolved | { status: 'error'; error: string } | { status: 'offline'; barcode: Barcode };
export type FigLookup = FigResolution | { status: 'error'; error: string } | { status: 'offline' };

const MAP_KEY = 'brickfolio-offline-map';
const MAP_FRESH_MS = 10 * 60_000;

const subscribe = (cb: () => void) => {
  window.addEventListener('online', cb);
  window.addEventListener('offline', cb);
  return () => { window.removeEventListener('online', cb); window.removeEventListener('offline', cb); };
};

function readMap(): OfflineMap | null {
  try { return JSON.parse(localStorage.getItem(MAP_KEY) ?? 'null') as OfflineMap | null; } catch { return null; }
}

/** True for the errors a server action throws when the request never reached the server. */
const unreachable = (e: unknown) => e instanceof TypeError || (e instanceof Error && /fetch|network|load failed/i.test(e.message));

export function useScanNetwork(opts: { onSent?: (message: string) => void; onRefused?: (error: string) => void } = {}) {
  const online = useSyncExternalStore(subscribe, () => navigator.onLine, () => true);
  const [map, setMap] = useState<OfflineMap | null>(null);
  const [outbox, setOutbox] = useState<Pending[]>([]);
  const { onSent, onRefused } = opts;

  const refreshMap = useCallback(async (force = false) => {
    const have = readMap();
    if (have) setMap(have);
    if (!force && have && Date.now() - Date.parse(have.at) < MAP_FRESH_MS) return;
    try {
      const res = await fetch('/api/v1/barcodes/offline', { credentials: 'same-origin' });
      if (!res.ok) return;
      const m = (await res.json()) as OfflineMap;
      setMap(m);
      try { localStorage.setItem(MAP_KEY, JSON.stringify(m)); } catch {} // too big for this browser: works online only
    } catch {}
  }, []);

  const flush = useCallback(async () => {
    const r = await flushOutbox();
    setOutbox(loadOutbox());
    for (const s of r.sent) onSent?.(s.message);
    for (const x of r.refused) onRefused?.(x.error);
    if (r.sent.length) void refreshMap(true);
    return r;
  }, [onSent, onRefused, refreshMap]);

  // On load: the saved barcodes, anything left waiting from last time, and the service worker.
  useEffect(() => {
    /* eslint-disable-next-line react-hooks/set-state-in-effect */
    setOutbox(loadOutbox());
    void refreshMap();
    if (navigator.onLine && loadOutbox().length) void flush();
    if (process.env.NODE_ENV === 'production' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/scan-sw.js', { scope: '/scan' }).then(async () => {
        const reg = await navigator.serviceWorker.ready;
        // Scripts this page loaded before the worker took over: cache them now so the page opens offline next time.
        const urls = performance.getEntriesByType('resource').map((e) => e.name).filter((u) => u.includes('/_next/static/'));
        reg.active?.postMessage({ type: 'precache', urls: [location.pathname, ...urls] });
      }).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Back online: send what waited.
  useEffect(() => {
    if (!online) return;
    void (async () => { if (loadOutbox().length) await flush(); })();
  }, [online, flush]);

  /** Finds the set for a barcode, from the server or, without one, from the saved barcodes on the device. */
  const lookupSet = useCallback(async (b: Barcode, refresh = false): Promise<SetLookup> => {
    const local = () => {
      const m = map ?? readMap();
      const hit = m && localResolve(m, b);
      return hit ? { ...hit, barcode: b, providers: [], noProviders: false } : { status: 'offline' as const, barcode: b };
    };
    if (!navigator.onLine) return local();
    try {
      return (await lookupBarcode(b.raw, b.format, refresh)) as SetLookup;
    } catch (e) {
      if (unreachable(e)) return local();
      return { status: 'error', error: e instanceof Error ? e.message : String(e) };
    }
  }, [map]);

  /** What's known about a set number typed or read off the box. Works offline with what's on the device. */
  const describe = useCallback(async (no: string): Promise<{ ok: true; set: ScanCandidate } | { ok: false; error: string }> => {
    const n = no.trim();
    if (!/^\d{3,7}(-\d{1,2})?$/.test(n)) return { ok: false, error: 'Set number must look like 10280 or 10280-1' };
    const full = n.includes('-') ? n : `${n}-1`;
    const local = () => ({ ok: true as const, set: offlineCandidate(map ?? readMap() ?? { at: '', barcodes: {}, owned: {}, wished: {} }, { setNo: full }) });
    if (!navigator.onLine) return local();
    try { return await describeScanSet(full); } catch (e) { return unreachable(e) ? local() : { ok: false, error: String(e) }; }
  }, [map]);

  const lookupFig = useCallback(async (text: string): Promise<FigLookup> => {
    if (!navigator.onLine) return { status: 'offline' };
    try { return (await lookupFigCode(text)) as FigLookup; } catch (e) { return unreachable(e) ? { status: 'offline' } : { status: 'error', error: String(e) }; }
  }, []);

  /**
   * Adds sets and minifigures: kept on the device, then sent. Says whether they're in the collection now ('saved',
   * with the server's summary) or still waiting ('waiting'), so the page never claims more than happened.
   */
  const submit = useCallback(async (p: Omit<Pending, 'at'>): Promise<{ state: 'saved'; message: string } | { state: 'waiting' } | { state: 'refused'; error: string }> => {
    enqueue({ ...p, at: new Date().toISOString() });
    setOutbox(loadOutbox());
    const r = await flushOutbox();
    setOutbox(loadOutbox());
    const mine = r.sent.find((s) => s.key === p.key);
    for (const s of r.sent) if (s.key !== p.key) onSent?.(s.message);
    if (mine) { void refreshMap(true); return { state: 'saved', message: mine.message }; }
    const refused = r.refused.find((s) => s.key === p.key);
    if (refused) return { state: 'refused', error: refused.error };
    return { state: 'waiting' };
  }, [onSent, refreshMap]);

  const discard = useCallback((key: string) => { discardPending(key); setOutbox(loadOutbox()); }, []);

  return { online, map, outbox, lookupSet, lookupFig, describe, submit, flush, discard };
}

