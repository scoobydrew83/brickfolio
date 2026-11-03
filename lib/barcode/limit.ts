// A small per-process limit on barcode lookups, so a stuck scanner or a script can't burn a provider's daily quota
// (CompareTheBricks' free tier is 250 calls a day). Per server instance; good enough for a single-collection app.

export function createLimiter(max: number, windowMs: number, now: () => number = Date.now) {
  let hits: number[] = [];
  return {
    /** True when another request fits in the window (and counts it). */
    take(): boolean {
      const t = now();
      hits = hits.filter((h) => t - h < windowMs);
      if (hits.length >= max) return false;
      hits.push(t);
      return true;
    },
  };
}

/** 120 lookups a minute: two a second, well above what a person scanning boxes needs. */
const g = globalThis as unknown as { __brickfolioBarcodeLimit?: ReturnType<typeof createLimiter> };
export const lookupLimit = () => (g.__brickfolioBarcodeLimit ??= createLimiter(120, 60_000));
