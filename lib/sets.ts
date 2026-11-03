// Shared, framework-free logic: row shape, input validation, filtering and totals.
// Used by the server (service layer, API) and the browser (Board). Tested in lib/sets.test.ts.
import { availability } from './retail';

export const CONDITIONS = ['New', 'Used', 'Partial'] as const;
export type Condition = (typeof CONDITIONS)[number];
/** Default storage locations for a new database. Users edit the list in Settings. */
export const DEFAULT_LOCATIONS = ['Display', 'Storage', 'Sell'] as const;
export const REGISTERED = ['Y', 'No QR'] as const;

/** One set in the collection, as the UI and API see it. Prices are per copy. */
export type SetRow = {
  id: number;
  setNo: string; // BrickLink item number, always with a suffix: 10280-1
  name: string;
  blName: string | null;
  year: number | null;
  categoryId: number | null;
  imageUrl: string | null;
  pieces: number | null;
  partLots: number | null;
  location: string | null;
  condition: Condition | null;
  registered: string | null;
  missingPct: number | null;
  qty: number;
  avgSold: number | null;
  minSold: number | null;
  maxSold: number | null;
  qtySold: number | null;
  estValue: number | null;
  blError: string | null;
  lastUpdated: string | null; // ISO time of the last BrickLink lookup
  notes: string | null;
  // From Rebrickable when REBRICKABLE_API_KEY is set; null until matched
  theme?: string | null; // top-level theme, e.g. Icons
  subtheme?: string | null; // e.g. Botanical Collection
  minifigs?: number | null;
  hasModel?: boolean; // an LDraw model is saved for the 3D view
  missingMarked?: number; // pieces marked missing from the parts list; when > 0, Missing % is computed from them
  // From Brickset when BRICKSET_API_KEY is set; null until checked
  retailPrice?: number | null; // original retail price, in retailCurrency
  retailCurrency?: string | null;
  launchDate?: string | null; // YYYY-MM-DD
  exitDate?: string | null; // YYYY-MM-DD: past = retired, future = expected retirement
  retired?: boolean | null;
};

/** Validated input for add/edit. `undefined` = leave alone, `null` = clear. */
export type SetInput = {
  setNo: string;
  name?: string;
  location?: string | null;
  condition?: Condition;
  registered?: string | null;
  missingPct?: number | null;
  qty?: number;
  notes?: string | null;
};

/** null, '' and non-numbers count as 0 for sums. */
export const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0);

/** 10280 and 10280-1 are the same set. BrickLink always wants the suffix. */
export const setNo = (raw: unknown) => {
  const s = String(raw ?? '').trim();
  return s.includes('-') ? s : s + '-1';
};
/** Short form for display: 10280-1 shows as 10280, 10280-2 stays. */
export const displayNo = (no: string) => (no.endsWith('-1') ? no.slice(0, -2) : no);

/**
 * Validates form or JSON input at the trust boundary (server actions, API). Field names match SetInput.
 * `partial` = edit: only setNo is required. `locations` = the allowed list from the database.
 */
export function parseSetInput(
  form: Record<string, unknown>,
  partial: boolean,
  locations: readonly string[],
): { ok: true; value: SetInput } | { ok: false; error: string } {
  const str = (k: string) => (form[k] === undefined || form[k] === null ? undefined : String(form[k]).trim());
  const raw = str('setNo') ?? '';
  if (!/^\d{3,7}(-\d{1,2})?$/.test(raw)) return { ok: false, error: 'Set number must look like 10280 or 10280-1' };
  const value: SetInput = { setNo: setNo(raw) };

  const name = str('name');
  if (name !== undefined) {
    if (name.length > 120) return { ok: false, error: 'Name is too long' };
    if (name || !partial) value.name = name;
  }
  if (!partial && !name) return { ok: false, error: 'Name is required' };

  const location = str('location');
  if (location !== undefined) {
    if (location && !locations.includes(location)) return { ok: false, error: `Location must be one of: ${locations.join(', ')}` };
    value.location = location || null;
  }
  const condition = str('condition');
  if (condition !== undefined && condition !== '') {
    if (!(CONDITIONS as readonly string[]).includes(condition)) return { ok: false, error: `Condition must be one of: ${CONDITIONS.join(', ')}` };
    value.condition = condition as Condition;
  }
  if (!partial && !value.condition) return { ok: false, error: 'Condition is required' };

  const registered = str('registered');
  if (registered !== undefined) {
    if (registered && !(REGISTERED as readonly string[]).includes(registered)) return { ok: false, error: `Registered must be one of: ${REGISTERED.join(', ')}` };
    value.registered = registered || null;
  }

  const missing = str('missingPct');
  if (missing !== undefined) {
    if (missing === '') value.missingPct = null;
    else {
      const m = Number(missing);
      if (!Number.isFinite(m) || m < 0 || m > 100) return { ok: false, error: 'Missing % must be 0–100' };
      value.missingPct = m;
    }
  }
  const qtyIn = str('qty');
  if (qtyIn) {
    const q = Number(qtyIn);
    if (!Number.isInteger(q) || q < 1 || q > 999) return { ok: false, error: 'Qty must be a whole number 1–999' };
    value.qty = q;
  }
  const notes = str('notes');
  if (notes !== undefined) {
    if (notes.length > 2000) return { ok: false, error: 'Notes are too long' };
    value.notes = notes || null;
  }
  return { ok: true, value };
}

/** Validates a location name for Settings. */
export function parseLocation(raw: unknown): { ok: true; value: string } | { ok: false; error: string } {
  const v = String(raw ?? '').trim();
  if (!v || v.length > 40) return { ok: false, error: 'Location must be 1–40 characters' };
  if (v === '(none)') return { ok: false, error: '"(none)" is reserved' };
  return { ok: true, value: v };
}

export type Filters = { q: string; location: string; condition: string; theme?: string; availability?: string; sort: 'setNo' | 'value' | 'name' | 'year' };

export function filterSets(sets: SetRow[], f: Filters): SetRow[] {
  const q = f.q.trim().toLowerCase();
  const hit = (s: SetRow) =>
    (!q || [s.setNo, s.name, s.blName, s.location, s.year, s.theme, s.subtheme].some((v) => String(v ?? '').toLowerCase().includes(q))) &&
    (!f.theme || (f.theme === '(none)' ? !s.theme : s.theme === f.theme)) &&
    (!f.location || (f.location === '(none)' ? !s.location : s.location === f.location)) &&
    (!f.condition || (f.condition === '(none)' ? !s.condition : s.condition === f.condition)) &&
    (!f.availability || (availability(s) ?? '(none)') === f.availability);
  const by: Record<Filters['sort'], (a: SetRow, b: SetRow) => number> = {
    setNo: (a, b) => a.setNo.localeCompare(b.setNo, undefined, { numeric: true }),
    value: (a, b) => num(b.estValue) - num(a.estValue),
    name: (a, b) => a.name.localeCompare(b.name),
    year: (a, b) => num(b.year) - num(a.year),
  };
  return sets.filter(hit).sort(by[f.sort]);
}

export function totals(sets: SetRow[]) {
  return {
    count: sets.length,
    copies: sets.reduce((t, s) => t + s.qty, 0),
    estValue: sets.reduce((t, s) => t + num(s.estValue) * s.qty, 0), // values are per copy
    avgSold: sets.reduce((t, s) => t + num(s.avgSold) * s.qty, 0),
    minSold: sets.reduce((t, s) => t + num(s.minSold) * s.qty, 0),
    maxSold: sets.reduce((t, s) => t + num(s.maxSold) * s.qty, 0),
    pieces: sets.reduce((t, s) => t + num(s.pieces) * s.qty, 0),
    errors: sets.filter((s) => s.blError).length,
  };
}

/** Totals per location, condition, theme or availability, biggest Est. Value first. Blank = '(none)', the same value the filters use. */
export function groupTotals(sets: SetRow[], key: 'location' | 'condition' | 'theme' | 'availability') {
  const groups = new Map<string, SetRow[]>();
  for (const s of sets) {
    const k = (key === 'availability' ? availability(s) : s[key]) || '(none)';
    groups.set(k, [...(groups.get(k) ?? []), s]);
  }
  return [...groups].map(([label, rows]) => ({ label, ...totals(rows) })).sort((a, b) => b.estValue - a.estValue);
}

/** Collection totals saved after each sync. One row per day (YYYY-MM-DD). */
export type HistoryRow = { date: string; sets: number; copies: number; estValue: number; avgSold: number; pieces: number };

/** Keeps the last row per date, oldest first, and drops bad dates. */
export function dailyHistory(rows: HistoryRow[]): HistoryRow[] {
  const byDay = new Map<string, HistoryRow>();
  for (const r of rows) if (/^\d{4}-\d{2}-\d{2}$/.test(String(r.date))) byDay.set(r.date, r);
  return [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export const money = (v: unknown, currency = 'USD') =>
  v === '' || v === undefined || v === null
    ? '—'
    : num(v).toLocaleString('en-US', { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** BrickLink price guide to use: new sold prices for New sets, used for Used and Partial. */
export const priceGuide = (condition: Condition | null): 'N' | 'U' => (condition === 'New' ? 'N' : 'U');

/** Est. Value per copy, as the sheet's formula had it: average sold price less Missing %, for any condition. */
export function estValue(avgSold: number | null, missingPct: number | null): number | null {
  return avgSold === null ? null : avgSold * (1 - num(missingPct) / 100);
}
