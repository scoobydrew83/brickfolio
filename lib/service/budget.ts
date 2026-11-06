// BrickLink's daily API limit, shared by everything one sync does, in priority order: the primary guide for sets,
// minifigs, the wishlist, the store, the other condition's guide (new vs. used gap), then part prices.
export const DAILY_LIMIT = 5000; // BrickLink's daily API limit
export const RESERVE = 500; // calls left unused for adding sets by hand during the day

/** A counter for one sync's BrickLink calls. `take` never goes past what's left. */
export class Budget {
  used = 0;
  constructor(private readonly limit = DAILY_LIMIT - RESERVE) {}
  left(): number { return Math.max(0, this.limit - this.used); }
  /** Reserves up to `n` calls (all of them for spending that already happened) and returns how many it got. */
  take(n: number): number {
    const got = Math.max(0, Math.min(Math.floor(n), this.left()));
    this.used += got;
    return got;
  }
  /** Records calls already made, even past the limit (the primary lookups always run). */
  spend(n: number): void { this.used += Math.max(0, Math.floor(n)); }
}

/**
 * OTHER_GUIDE_DAILY_CALLS: most second-guide price calls per sync. Default: enough to refresh every set about weekly
 * (sets ÷ 7, plus 10), at most 1,000. 0 turns it off.
 */
export function otherGuideDailyCalls(sets: number, env = process.env.OTHER_GUIDE_DAILY_CALLS): number {
  if (env !== undefined && env !== '') {
    const n = Number(env);
    return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), DAILY_LIMIT - RESERVE) : 0;
  }
  return Math.min(1000, Math.ceil(sets / 7) + 10);
}
