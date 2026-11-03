// Adds made on the Scan page go through this queue: kept on the device first, then sent to the server. Online, that
// takes a moment; offline, they wait and go when the connection is back. Each batch has its own idempotency key, so
// sending it again (after a dropped connection) can't add anything twice.
import { scanSummary, type ScanAddCounts } from '@/lib/barcode/summary';
import type { BarcodeFormat } from '@/lib/barcode/gtin';

export type Pending = {
  key: string;
  at: string;
  items: { setNo: string; qty: number; target: 'collection' | 'wishlist'; condition: string; location: string | null }[];
  figs: { rbFigNo: string; name: string; imageUrl: string | null; qty: number }[];
  remember: { barcode: string; format: BarcodeFormat; setNo: string }[];
  rememberFigs: { code: string; name: string; series: string; rbFigNo: string | null }[];
  label: string; // "3 sets, 1 minifigure", for the waiting list
  error?: string; // the server refused it: shown until you discard it
};

const KEY = 'brickfolio-scan-outbox';
export function loadOutbox(): Pending[] {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '[]') as Pending[]; } catch { return []; }
}
function save(list: Pending[]) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch {}
}
export function enqueue(p: Pending) { save([...loadOutbox(), p]); }
export function discard(key: string) { save(loadOutbox().filter((p) => p.key !== key)); }

type Sent = { key: string; message: string };
export type FlushResult = { sent: Sent[]; refused: { key: string; error: string }[]; offline: boolean };

const post = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });

/** Thrown when the server can't be reached: stop and keep the rest for later. */
class Offline extends Error {}
const send = async (url: string, body: unknown, headers?: Record<string, string>) => {
  let res: Response;
  try { res = await post(url, body, headers); } catch { throw new Offline(); }
  if (res.status >= 500 || res.status === 408 || res.status === 429) throw new Offline();
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data: data as Record<string, unknown> };
};

let running: Promise<FlushResult> | null = null;

/** Sends what's waiting, oldest first. Batches the server refuses stay, marked with its answer. */
export function flushOutbox(): Promise<FlushResult> {
  running ??= (async () => {
    const out: FlushResult = { sent: [], refused: [], offline: false };
    for (const p of loadOutbox()) {
      if (p.error) continue;
      try {
        for (const m of p.remember) await send('/api/v1/barcodes/mappings', m);
        for (const m of p.rememberFigs) await send('/api/v1/barcodes/minifig/mappings', m);
        const r = await send('/api/v1/barcodes/batch', { items: p.items, figs: p.figs }, { 'Idempotency-Key': p.key });
        if (r.ok) {
          out.sent.push({ key: p.key, message: scanSummary(r.data as unknown as ScanAddCounts) });
          discard(p.key);
        } else {
          const error = String(r.data.error ?? 'The server refused this batch.');
          out.refused.push({ key: p.key, error });
          save(loadOutbox().map((x) => (x.key === p.key ? { ...x, error } : x)));
        }
      } catch (e) {
        if (e instanceof Offline) { out.offline = true; break; }
        throw e;
      }
    }
    return out;
  })().finally(() => { running = null; });
  return running;
}
