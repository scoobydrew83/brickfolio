// Retirement Radar: pure helpers shared by the server (lib/service/radar.ts) and the browser.
// Growth since retirement is worked out from the sold prices Brickfolio stored at each sync, or from the
// original retail price when there's no stored price from around the retirement date.

export type Flag = 'designer' | 'smart';
export const FLAG_LABEL: Record<Flag, string> = { designer: 'BrickLink Designer Program', smart: 'SMART Play' };

/** Themes worth watching: BrickLink Designer Program sets retire as soon as their run ends; SMART Play is new in 2026. */
export function flagsFor(...names: (string | null | undefined)[]): Flag[] {
  const text = names.filter(Boolean).join(' ').toLowerCase();
  const out: Flag[] = [];
  if (/bricklink designer|designer program|\bbricklink\b/.test(text)) out.push('designer');
  if (/smart play|smart brick/.test(text)) out.push('smart');
  return out;
}

export type Growth = {
  perYear: number; // compound growth per year, in %
  totalPct: number; // change from the starting price, in %
  from: number; // starting price
  fromDate: string; // YYYY-MM-DD
  to: number; // current average sold
  years: number;
  basis: 'snapshot' | 'retail'; // stored BrickLink price near retirement, or the original retail price
  thin: boolean; // too little price history to trust much
};

export type PricePoint = { date: string; avgSold: number | null };

const DAY = 86_400_000;
const MIN_YEARS = 0.25; // under three months, a yearly rate means little
const NEAR_DAYS = 45; // a stored price within this many days of retirement counts as "at retirement"

/**
 * Growth since a set retired. Starts from the first stored sold price on or after the exit date (within 45
 * days); failing that, from the retail price in the same currency. Null when retired too recently or there's no start.
 */
export function growthSince(
  exitDate: string | null | undefined,
  current: number | null | undefined,
  history: PricePoint[],
  retail: { price: number | null | undefined; currency: string | null | undefined },
  currency: string,
  today = new Date().toISOString().slice(0, 10),
): Growth | null {
  if (!exitDate || current == null || current <= 0 || exitDate > today) return null;
  const exitMs = Date.parse(exitDate);
  const priced = history.filter((p) => p.avgSold != null && p.avgSold > 0).sort((a, b) => a.date.localeCompare(b.date));
  const near = priced.find((p) => p.date >= exitDate && Date.parse(p.date) - exitMs <= NEAR_DAYS * DAY);
  let from: number, fromDate: string, basis: Growth['basis'];
  if (near) { from = near.avgSold!; fromDate = near.date; basis = 'snapshot'; }
  else if (retail.price && retail.currency === currency) { from = retail.price; fromDate = exitDate; basis = 'retail'; }
  else return null;
  const years = (Date.parse(today) - Date.parse(fromDate)) / (365.25 * DAY);
  if (years < MIN_YEARS) return null;
  const perYear = (Math.pow(current / from, 1 / years) - 1) * 100;
  const round = (v: number) => Math.round(v * 10) / 10;
  return {
    perYear: round(perYear), totalPct: round(((current - from) / from) * 100), from, fromDate, to: current,
    years: Math.round(years * 100) / 100, basis, thin: basis === 'retail' || priced.filter((p) => p.date >= fromDate).length < 3,
  };
}

/** "2026-12" → "December 2026". */
export const monthLabel = (ym: string) => new Date(`${ym}-01T00:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });

/** Whole days from `today` to `date` (both YYYY-MM-DD); negative when it's past. */
export const daysUntil = (date: string, today = new Date().toISOString().slice(0, 10)) => Math.round((Date.parse(date) - Date.parse(today)) / DAY);
