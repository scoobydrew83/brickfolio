// Retail barcodes on LEGO boxes: UPC-A (12 digits, North America) and EAN-13 (13 digits, elsewhere), sometimes
// EAN-8 or UPC-E on small boxes. Framework-free, used by the scanner in the browser and by the lookup on the server.
// Barcodes are strings throughout, so leading zeros survive.

export const FORMATS = ['UPC_A', 'EAN_13', 'EAN_8', 'UPC_E'] as const;
export type BarcodeFormat = (typeof FORMATS)[number];

/**
 * A checked barcode. `gtin` is the form lookups use: UPC-A and UPC-E become their 13-digit EAN form (a leading 0),
 * so a box scanned as UPC-A and the same box read as EAN-13 match. EAN-8 stays 8 digits (it is its own number space).
 */
export type Barcode = { raw: string; format: BarcodeFormat; gtin: string };
export type BarcodeError = { code: 'INVALID_BARCODE' | 'UNSUPPORTED_FORMAT'; error: string };

/** Longest input looked at, so a pasted paragraph can't cost anything. */
export const MAX_INPUT = 32;

/** GS1 check digit for the digits before it: weights 3,1,3,… from the right. */
export function checkDigit(body: string): number {
  let sum = 0;
  for (let i = 0; i < body.length; i++) sum += Number(body[body.length - 1 - i]) * (i % 2 === 0 ? 3 : 1);
  return (10 - (sum % 10)) % 10;
}

const checks = (digits: string) => checkDigit(digits.slice(0, -1)) === Number(digits[digits.length - 1]);

/** UPC-E (8 digits: number system, 6 data, check) written out as the UPC-A it stands for, or null. */
export function expandUpcE(upce: string): string | null {
  if (!/^[01]\d{7}$/.test(upce)) return null;
  const ns = upce[0], d = upce.slice(1, 7), check = upce[7];
  const last = Number(d[5]);
  let body: string;
  if (last <= 2) body = `${d[0]}${d[1]}${d[5]}0000${d[2]}${d[3]}${d[4]}`;
  else if (last === 3) body = `${d[0]}${d[1]}${d[2]}00000${d[3]}${d[4]}`;
  else if (last === 4) body = `${d[0]}${d[1]}${d[2]}${d[3]}00000${d[4]}`;
  else body = `${d[0]}${d[1]}${d[2]}${d[3]}${d[4]}0000${d[5]}`;
  const upca = `${ns}${body}${check}`;
  return checks(upca) ? upca : null;
}

/** Maps a decoder's format name (BarcodeDetector's ean_13, ZXing's EAN_13, …) to ours. Unknown names give null. */
export function formatHint(name: unknown): BarcodeFormat | null {
  const n = String(name ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return ({ UPCA: 'UPC_A', EAN13: 'EAN_13', EAN8: 'EAN_8', UPCE: 'UPC_E' } as Record<string, BarcodeFormat>)[n] ?? null;
}

/**
 * Checks a scanned or typed barcode: digits only (spaces and dashes are dropped), a supported length and a correct
 * check digit. `hint` is the decoder's format, needed only to tell UPC-E from EAN-8 (both are 8 digits).
 */
export function parseBarcode(input: unknown, hint?: BarcodeFormat | null): ({ ok: true } & Barcode) | ({ ok: false } & BarcodeError) {
  const text = String(input ?? '');
  if (text.length > MAX_INPUT) return { ok: false, code: 'INVALID_BARCODE', error: 'That is too long for a barcode.' };
  const raw = text.trim().replace(/[\s-]/g, '');
  if (!raw) return { ok: false, code: 'INVALID_BARCODE', error: 'Enter the digits under the barcode.' };
  if (!/^\d+$/.test(raw)) return { ok: false, code: 'INVALID_BARCODE', error: 'A barcode has digits only.' };
  const bad = { ok: false, code: 'INVALID_BARCODE', error: 'The check digit doesn’t match. Scan again or check the digits.' } as const;
  if (raw.length === 12) return checks(raw) ? { ok: true, raw, format: 'UPC_A', gtin: `0${raw}` } : bad;
  if (raw.length === 13) return checks(raw) ? { ok: true, raw, format: 'EAN_13', gtin: raw } : bad;
  if (raw.length === 8) {
    if (hint === 'UPC_E') {
      const upca = expandUpcE(raw);
      return upca ? { ok: true, raw, format: 'UPC_E', gtin: `0${upca}` } : bad;
    }
    return checks(raw) ? { ok: true, raw, format: 'EAN_8', gtin: raw } : bad;
  }
  return { ok: false, code: 'UNSUPPORTED_FORMAT', error: 'Use the UPC (12 digits) or EAN (13 digits) barcode on the box.' };
}

/** The 12-digit UPC-A form of a GTIN that has one (EAN-13 starting with 0), else null. */
export const upcOf = (gtin: string) => (gtin.length === 13 && gtin.startsWith('0') ? gtin.slice(1) : null);

/** Every spelling of a GTIN a provider might store: 0673419264150 and 673419264150. */
export const spellings = (gtin: string) => [gtin, upcOf(gtin)].filter((v): v is string => !!v);

/**
 * Stops one box held in front of the camera from counting again and again. A code counts once when it appears, and
 * again only after it has been out of view for `goneFrames` decoded frames in a row. That tracks the box, not a timer,
 * so a slow phone and a fast one behave the same. `forget(gtin)` lets the next read count straight away
 * ("Add another copy").
 */
export function createRepeatGuard(opts: { goneFrames?: number } = {}) {
  const goneFrames = opts.goneFrames ?? 12;
  let frame = 0;
  const lastSeen = new Map<string, number>();
  return {
    /** Codes seen in one decoded frame. Returns the ones that count as new scans. */
    frame(codes: Iterable<string>): string[] {
      frame++;
      const fresh: string[] = [];
      for (const c of new Set(codes)) {
        const seen = lastSeen.get(c);
        if (seen === undefined || frame - seen > goneFrames) fresh.push(c);
        lastSeen.set(c, frame);
      }
      if (lastSeen.size > 200) for (const [c, f] of lastSeen) if (frame - f > goneFrames) lastSeen.delete(c);
      return fresh;
    },
    forget(code: string) { lastSeen.delete(code); },
    reset() { lastSeen.clear(); frame = 0; },
  };
}
