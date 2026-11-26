// USB and Bluetooth barcode scanners act as keyboards ("keyboard wedge"): they type the digits very fast and press
// Enter. This buffer tells such a burst apart from a person typing, so the Scan page can take scans without a field
// having focus. Pure and time-injected, so it's tested without a browser (wedge.test.ts).

/** Keys further apart than this (ms) start a new burst: people type far slower than scanners. */
export const WEDGE_GAP_MS = 60;
/** The shortest code a scanner sends that we act on (EAN-8; UPC-E is read as its 8-digit form). */
export const WEDGE_MIN = 8;

export type WedgeBuffer = {
  /** Feed one key. Returns the scanned digits when this key (Enter, or Tab) ends a fast burst, else null. */
  key(key: string, at: number): string | null;
  reset(): void;
};

export function createWedgeBuffer(gap = WEDGE_GAP_MS, min = WEDGE_MIN): WedgeBuffer {
  let digits = '';
  let last = -Infinity;
  return {
    key(key, at) {
      const fast = at - last <= gap;
      last = at;
      if (key === 'Enter' || key === 'Tab') {
        const code = fast && digits.length >= min ? digits : null;
        digits = '';
        return code;
      }
      if (/^\d$/.test(key)) {
        digits = fast ? digits + key : key; // a slow digit starts over: someone typing, or a new scan
        if (digits.length > 14) digits = digits.slice(-14);
        return null;
      }
      digits = ''; // anything else (letters, shortcuts) isn't a scan
      return null;
    },
    reset() { digits = ''; last = -Infinity; },
  };
}
