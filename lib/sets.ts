// Shared, framework-free logic: row shape, input validation, filtering and totals.
// Used by the server (service layer, API) and the browser (Board). Tested in lib/sets.test.ts.
import { availability } from './retail';
import { FIG_NO } from './minifigs';

export const CONDITIONS = ['New', 'Used', 'Partial'] as const;
export type Condition = (typeof CONDITIONS)[number];
/** Default storage locations for a new database. Users edit the list in Settings. */
export const DEFAULT_LOCATIONS = ['Display', 'Storage', 'Sell'] as const;
export const REGISTERED = ['Y', 'No QR'] as const;
/** What a physical copy is: still sealed, built, being built, or taken apart (parted out copies aren't counted). */
export const STATUSES = ['sealed', 'built', 'in_progress', 'parted_out'] as const;
export type CopyStatus = (typeof STATUSES)[number];
export const STATUS_LABEL: Record<CopyStatus, string> = { sealed: 'Sealed', built: 'Built', in_progress: 'In progress', parted_out: 'Parted out' };

/** One physical copy of a set. Money is in the collection currency. */
export type CopyRow = {
  id: number;
  setId: number;
  collectionId: number | null;
  status: CopyStatus;
  condition: Condition;
  missingPct: number | null;
  location: string | null;
  acquiredDate: string | null; // YYYY-MM-DD
  buildDate: string | null; // YYYY-MM-DD
  pricePaid: number | null;
  tax: number | null;
  shipping: number | null;
  gwp: boolean; // gift with purchase: cost basis 0
  estValue: number | null;
  estGuide: 'N' | 'U' | null; // the price guide estValue came from
  notes: string | null;
  missingMarked?: number; // pieces marked missing on this copy; when > 0, its Missing % is computed from them
};

/** Validated copy input. `undefined` = leave alone, `null` = clear. */
export type CopyInput = {
  status?: CopyStatus;
  condition?: Condition;
  missingPct?: number | null;
  location?: string | null;
  acquiredDate?: string | null;
  buildDate?: string | null;
  pricePaid?: number | null;
  tax?: number | null;
  shipping?: number | null;
  gwp?: boolean;
  notes?: string | null;
};

/**
 * One set in the collection, as the UI and API see it. Prices are per copy. `qty`, `condition`, `location` and
 * `missingPct` are derived from the copies: the count of copies that aren't parted out, and the shared value when
 * every such copy has the same one (else null, with `mixed` set).
 */
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
  estValue: number | null; // per copy: valueTotal ÷ qty
  blError: string | null;
  lastUpdated: string | null; // ISO time of the last BrickLink lookup
  notes: string | null;
  copies: CopyRow[];
  mixed: { condition: boolean; location: boolean };
  valueTotal: number | null; // Est. Value of all copies that aren't parted out
  costBasis: number | null; // over the copies that have one
  costCovered: number; // how many copies have a cost basis
  gain: number | null; // value − cost basis, over the covered copies
  partedOut: number; // copies parted out (not in qty or value)
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

/**
 * Validated input for add/edit. `undefined` = leave alone, `null` = clear. `qty`, `condition`, `location` and
 * `missingPct` act on the copies (see lib/service/sets.ts); `copy` carries the other copy fields for a new copy.
 */
export type SetInput = {
  setNo: string;
  name?: string;
  location?: string | null;
  condition?: Condition;
  registered?: string | null;
  missingPct?: number | null;
  qty?: number;
  notes?: string | null;
  copy?: CopyInput;
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

/**
 * parseSetInput plus the copy fields of a new copy (status, dates, cost, gift with purchase, `copyNotes`).
 * Condition, location and Missing % stay on the set input; `notes` are the set's notes.
 */
export function parseSetWithCopy(form: Record<string, unknown>, partial: boolean, locations: readonly string[]): ReturnType<typeof parseSetInput> {
  const p = parseSetInput(form, partial, locations);
  if (!p.ok) return p;
  const { condition: _c, location: _l, missingPct: _m, notes: _n, copyNotes, ...rest } = form;
  const c = parseCopyInput({ ...rest, notes: copyNotes }, true, locations);
  if (!c.ok) return c;
  if (c.value.status === 'sealed' && p.value.condition === 'Partial') return { ok: false, error: "A sealed copy can't be Partial." };
  if (Object.keys(c.value).length) p.value.copy = c.value;
  return p;
}

const MONEY_MAX = 1_000_000;
const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v + 'T00:00:00Z')) && new Date(v + 'T00:00:00Z').toISOString().startsWith(v);
const truthy = (v: unknown) => v === true || v === 1 || ['on', 'true', '1', 'yes', 'y'].includes(String(v).trim().toLowerCase());

/**
 * Validates one copy's fields, from a form or JSON. `partial` = edit (only what's given). Rules: sealed means New
 * (and can't be Partial), money is 0–1,000,000, dates are YYYY-MM-DD, and a gift with purchase costs 0.
 */
export function parseCopyInput(
  form: Record<string, unknown>,
  partial: boolean,
  locations: readonly string[],
): { ok: true; value: CopyInput } | { ok: false; error: string } {
  const str = (k: string) => (form[k] === undefined || form[k] === null ? undefined : String(form[k]).trim());
  const value: CopyInput = {};
  const status = str('status');
  if (status !== undefined && status !== '') {
    if (!(STATUSES as readonly string[]).includes(status)) return { ok: false, error: `Status must be one of: ${STATUSES.join(', ')}` };
    value.status = status as CopyStatus;
  }
  const condition = str('condition');
  if (condition !== undefined && condition !== '') {
    if (!(CONDITIONS as readonly string[]).includes(condition)) return { ok: false, error: `Condition must be one of: ${CONDITIONS.join(', ')}` };
    value.condition = condition as Condition;
  }
  if (value.status === 'sealed') {
    if (value.condition === 'Partial') return { ok: false, error: "A sealed copy can't be Partial." };
    value.condition = 'New';
  }
  if (!partial) {
    value.status ??= value.condition === 'New' ? 'sealed' : 'built';
    value.condition ??= value.status === 'sealed' ? 'New' : 'Used';
  }
  const location = str('location');
  if (location !== undefined) {
    if (location && !locations.includes(location)) return { ok: false, error: `Location must be one of: ${locations.join(', ')}` };
    value.location = location || null;
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
  for (const [k, label] of [['acquiredDate', 'Acquired date'], ['buildDate', 'Build date']] as const) {
    const v = str(k);
    if (v === undefined) continue;
    if (v && !isDate(v)) return { ok: false, error: `${label} must be a date like 2026-11-04` };
    value[k] = v || null;
  }
  for (const [k, label] of [['pricePaid', 'Price paid'], ['tax', 'Tax'], ['shipping', 'Shipping']] as const) {
    const v = str(k);
    if (v === undefined) continue;
    if (v === '') { value[k] = null; continue; }
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0 || n > MONEY_MAX) return { ok: false, error: `${label} must be 0–1,000,000` };
    value[k] = Math.round(n * 100) / 100;
  }
  if (form.gwp !== undefined && form.gwp !== null && form.gwp !== '') value.gwp = truthy(form.gwp);
  else if (!partial) value.gwp = false;
  if (value.gwp) value.pricePaid = 0;
  const notes = str('notes');
  if (notes !== undefined) {
    if (notes.length > 2000) return { ok: false, error: 'Notes are too long' };
    value.notes = notes || null;
  }
  return { ok: true, value };
}

/** Copies that count: everything except parted out. */
export const isActive = (c: Pick<CopyRow, 'status'>) => c.status !== 'parted_out';

/** BrickLink guide for a copy: new sold prices when sealed or New, used otherwise. */
export const copyGuide = (c: Pick<CopyRow, 'status' | 'condition'>): 'N' | 'U' => (c.status === 'sealed' || c.condition === 'New' ? 'N' : 'U');

/** What a copy cost: 0 for a gift with purchase, null when nothing is known, else paid + tax + shipping. */
export function costBasis(c: Pick<CopyRow, 'gwp' | 'pricePaid' | 'tax' | 'shipping'>): number | null {
  if (c.gwp) return 0;
  if (c.pricePaid == null && c.tax == null && c.shipping == null) return null;
  return Math.round((num(c.pricePaid) + num(c.tax) + num(c.shipping)) * 100) / 100;
}

/** The one guide fetched for a set (until both are): the guide of most of its active copies. Ties go to used. */
export function setGuide(copies: Pick<CopyRow, 'status' | 'condition'>[]): 'N' | 'U' {
  const pool = copies.some(isActive) ? copies.filter(isActive) : copies;
  const n = pool.filter((c) => copyGuide(c) === 'N').length;
  return n > pool.length - n ? 'N' : 'U';
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/** A set row with its derived fields (qty, shared condition/location/Missing %, value, cost, gain) worked out from `copies`. */
export function withCopies<T extends Omit<SetRow, 'copies' | 'mixed' | 'valueTotal' | 'costBasis' | 'costCovered' | 'gain' | 'partedOut' | 'qty' | 'condition' | 'location' | 'missingPct' | 'estValue'>>(
  base: T, copies: CopyRow[],
): T & Pick<SetRow, 'copies' | 'mixed' | 'valueTotal' | 'costBasis' | 'costCovered' | 'gain' | 'partedOut' | 'qty' | 'condition' | 'location' | 'missingPct' | 'estValue'> {
  const act = copies.filter(isActive);
  const shared = <K extends 'condition' | 'location' | 'missingPct'>(k: K) => {
    const vals = new Set(act.map((c) => c[k] ?? null));
    return { value: vals.size === 1 ? ([...vals][0] as CopyRow[K] | null) : null, mixed: vals.size > 1 };
  };
  const cond = shared('condition'), loc = shared('location'), miss = shared('missingPct');
  const valued = act.filter((c) => c.estValue != null);
  const valueTotal = valued.length ? round2(valued.reduce((t, c) => t + num(c.estValue), 0)) : null;
  const covered = act.filter((c) => costBasis(c) != null);
  const cost = covered.length ? round2(covered.reduce((t, c) => t + num(costBasis(c)), 0)) : null;
  const gain = covered.length ? round2(covered.reduce((t, c) => t + num(c.estValue) - num(costBasis(c)), 0)) : null;
  return {
    ...base, copies, qty: act.length, condition: cond.value as Condition | null, location: loc.value as string | null, missingPct: miss.value as number | null,
    mixed: { condition: cond.mixed, location: loc.mixed }, estValue: valueTotal === null || !act.length ? null : round2(valueTotal / act.length),
    valueTotal, costBasis: cost, costCovered: covered.length, gain, partedOut: copies.length - act.length,
  };
}

/** "2 sealed · 1 built" for a set's active copies (parted out ones are listed last). */
export function copiesSummary(copies: Pick<CopyRow, 'status'>[]): string {
  const n = (s: CopyStatus) => copies.filter((c) => c.status === s).length;
  return STATUSES.filter((s) => n(s)).map((s) => `${n(s)} ${STATUS_LABEL[s].toLowerCase()}`).join(' · ');
}

/** Validates a location name for Settings. */
export function parseLocation(raw: unknown): { ok: true; value: string } | { ok: false; error: string } {
  const v = String(raw ?? '').trim();
  if (!v || v.length > 40) return { ok: false, error: 'Location must be 1–40 characters' };
  if (v === '(none)') return { ok: false, error: '"(none)" is reserved' };
  return { ok: true, value: v };
}

export type Filters = { q: string; location: string; condition: string; status?: string; theme?: string; availability?: string; sort: 'setNo' | 'value' | 'name' | 'year' };

/** Whether any copy matches a filter value ('(none)' = blank). */
const anyCopy = (s: SetRow, k: 'location' | 'condition' | 'status', v: string) =>
  s.copies.some((c) => (v === '(none)' ? !c[k] : c[k] === v));

export function filterSets(sets: SetRow[], f: Filters): SetRow[] {
  const q = f.q.trim().toLowerCase();
  const hit = (s: SetRow) =>
    (!f.theme || (f.theme === '(none)' ? !s.theme : s.theme === f.theme)) &&
    (!q || s.copies.some((c) => c.location?.toLowerCase().includes(q) || c.notes?.toLowerCase().includes(q)) || [s.setNo, s.name, s.blName, s.year, s.theme, s.subtheme].some((v) => String(v ?? '').toLowerCase().includes(q))) &&
    (!f.location || anyCopy(s, 'location', f.location)) &&
    (!f.condition || anyCopy(s, 'condition', f.condition)) &&
    (!f.status || anyCopy(s, 'status', f.status)) &&
    (!f.availability || (availability(s) ?? '(none)') === f.availability);
  const by: Record<Filters['sort'], (a: SetRow, b: SetRow) => number> = {
    setNo: (a, b) => a.setNo.localeCompare(b.setNo, undefined, { numeric: true }),
    value: (a, b) => num(b.valueTotal) - num(a.valueTotal),
    name: (a, b) => a.name.localeCompare(b.name),
    year: (a, b) => num(b.year) - num(a.year),
  };
  return sets.filter(hit).sort(by[f.sort]);
}

/** Collection totals over copies that aren't parted out. A set whose copies are all parted out isn't counted. */
export function totals(sets: SetRow[]) {
  const covered = sets.filter((s) => s.costCovered > 0);
  return {
    count: sets.filter((s) => s.qty > 0).length,
    copies: sets.reduce((t, s) => t + s.qty, 0),
    estValue: sets.reduce((t, s) => t + num(s.valueTotal), 0),
    avgSold: sets.reduce((t, s) => t + num(s.avgSold) * s.qty, 0),
    minSold: sets.reduce((t, s) => t + num(s.minSold) * s.qty, 0),
    maxSold: sets.reduce((t, s) => t + num(s.maxSold) * s.qty, 0),
    pieces: sets.reduce((t, s) => t + num(s.pieces) * s.qty, 0),
    errors: sets.filter((s) => s.blError).length,
    costBasis: covered.length ? covered.reduce((t, s) => t + num(s.costBasis), 0) : null,
    gain: covered.length ? covered.reduce((t, s) => t + num(s.gain), 0) : null,
    partedOut: sets.reduce((t, s) => t + s.partedOut, 0),
  };
}

/**
 * Totals per location, condition, theme or availability, biggest Est. Value first. Blank = '(none)', the same value
 * the filters use. Location and condition group copies: a set with copies in two places counts in both, split.
 */
export function groupTotals(sets: SetRow[], key: 'location' | 'condition' | 'theme' | 'availability') {
  const groups = new Map<string, SetRow[]>();
  const add = (k: string, s: SetRow) => groups.set(k, [...(groups.get(k) ?? []), s]);
  for (const s of sets) {
    if (key === 'location' || key === 'condition') {
      const byKey = new Map<string, CopyRow[]>();
      for (const c of s.copies.filter(isActive)) byKey.set(c[key] || '(none)', [...(byKey.get(c[key] || '(none)') ?? []), c]);
      for (const [k, cs] of byKey) add(k, withCopies(s, cs));
    } else add((key === 'availability' ? availability(s) : s[key]) || '(none)', s);
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

/** BrickLink price guide for a condition: new sold prices for New, used for Used and Partial. For copies use copyGuide. */
export const priceGuide = (condition: Condition | null): 'N' | 'U' => (condition === 'New' ? 'N' : 'U');

/** Est. Value per copy, as the sheet's formula had it: average sold price less Missing %, for any condition. */
export function estValue(avgSold: number | null, missingPct: number | null): number | null {
  return avgSold === null ? null : avgSold * (1 - num(missingPct) / 100);
}

/** Name given to a pasted set until BrickLink fills in the real one. */
export const placeholderName = (no: string) => `Set ${displayNo(no)}`;

export type QuickList = { sets: { setNo: string; qty: number }[]; minifigs: { figNo: string; qty: number }[]; invalid: string[] };
export const QUICK_MAX = 500;

/**
 * Reads a pasted list: one entry per line (or comma or semicolon), each a set number (10497, 10497-1) or a
 * BrickLink minifig number (sw0001), with an optional count like "10497 x2" or "2x 10497". Repeats add up.
 * Lines starting with # are skipped.
 */
export function parseQuickList(text: string): QuickList {
  const sets = new Map<string, number>(), figs = new Map<string, number>(), invalid: string[] = [];
  for (const raw of String(text ?? '').split(/[\n,;]+/)) {
    const entry = raw.trim().replace(/^#\s*(?=\d)/, ''); // "#10497" means set 10497
    if (!entry || entry.startsWith('#')) continue;
    let id = entry, qty = 1;
    const pre = entry.match(/^(\d{1,3})\s*[x×*]\s+(\S+)$/i) ?? entry.match(/^(\d{1,3})\s*[x×*](\S*[a-z-]\S*)$/i);
    const post = entry.match(/^(\S+?)\s*[x×*]\s*(\d{1,3})$/i);
    if (pre) { qty = Number(pre[1]); id = pre[2]; } else if (post) { id = post[1]; qty = Number(post[2]); }
    if (qty < 1 || qty > 999) { invalid.push(entry); continue; }
    if (/^\d{3,7}(-\d{1,2})?$/.test(id)) sets.set(setNo(id), (sets.get(setNo(id)) ?? 0) + qty);
    else if (FIG_NO.test(id)) figs.set(id.toLowerCase(), (figs.get(id.toLowerCase()) ?? 0) + qty);
    else invalid.push(entry);
  }
  const all = [...sets].map(([setNo, qty]) => ({ setNo, qty }));
  const mf = [...figs].map(([figNo, qty]) => ({ figNo, qty }));
  const room = Math.max(0, QUICK_MAX - all.length);
  return { sets: all.slice(0, QUICK_MAX), minifigs: mf.slice(0, room), invalid: [...invalid, ...all.slice(QUICK_MAX).map((s) => s.setNo), ...mf.slice(room).map((f) => f.figNo)] };
}
