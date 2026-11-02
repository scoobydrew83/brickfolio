// CSV import/export. Import understands the old Google Sheet's columns ("Lego #", "Set Name", …) and this
// app's own export, so moving from the sheet is: File → Download → CSV for each tab, then upload in Settings.
import { eq, sql } from 'drizzle-orm';
import type { SetPart } from '../bricklink/client';
import { history, locations, sets } from '../db/schema';
import type { DB } from '../db/types';
import { CONDITIONS, setNo, type Condition, type SetRow } from '../sets';
import { replaceParts } from './parts';
import type { Result } from './sets';

/** RFC 4180 CSV: quoted fields, "" escapes, CRLF or LF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim()));
}

/** Spreadsheets run text starting with these as a formula; a leading ' makes them plain text. */
const FORMULA = /^[=+\-@\t\r]/;
const esc = (v: unknown) => {
  let s = v === null || v === undefined ? '' : String(v);
  if (typeof v === 'string' && FORMULA.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
/** Undoes esc()'s formula guard on import. */
const unguard = (c: string) => (c.startsWith("'") && FORMULA.test(c.slice(1)) ? c.slice(1) : c);
export const toCsv = (header: string[], rows: unknown[][]) => [header, ...rows].map((r) => r.map(esc).join(',')).join('\r\n') + '\r\n';

const EXPORT_COLS = ['setNo', 'name', 'qty', 'location', 'condition', 'registered', 'missingPct', 'notes', 'blName', 'year', 'categoryId', 'imageUrl', 'pieces', 'partLots', 'avgSold', 'minSold', 'maxSold', 'qtySold', 'estValue', 'blError', 'lastUpdated'] as const;
export const setsCsv = (rows: SetRow[]) => toCsv([...EXPORT_COLS], rows.map((r) => EXPORT_COLS.map((k) => r[k])));

// Sheet column → field. Keys are lowercased with spaces, so both "Set Name" and "name" match.
const ALIASES: Record<string, string> = {
  'lego #': 'setNo', 'set #': 'setNo', setno: 'setNo', 'set name': 'name', name: 'name', location: 'location', condition: 'condition',
  'reg?': 'registered', registered: 'registered', 'bl name': 'blName', blname: 'blName', year: 'year', 'category id': 'categoryId',
  categoryid: 'categoryId', 'image url': 'imageUrl', imageurl: 'imageUrl', 'avg sold': 'avgSold', avgsold: 'avgSold',
  'min sold': 'minSold', minsold: 'minSold', 'max sold': 'maxSold', maxsold: 'maxSold', 'qty sold': 'qtySold', qtysold: 'qtySold',
  'part lots': 'partLots', partlots: 'partLots', 'last updated': 'lastUpdated', lastupdated: 'lastUpdated', 'bl error': 'blError',
  blerror: 'blError', 'missing %': 'missingPct', missingpct: 'missingPct', 'est. value': 'estValue', estvalue: 'estValue',
  pieces: 'pieces', qty: 'qty', notes: 'notes', date: 'date', sets: 'sets', copies: 'copies',
  // Parts tab
  'set no': 'partSet', 'part no': 'partNo', partno: 'partNo', 'part name': 'partName', type: 'type', 'color id': 'colorId',
  colorid: 'colorId', extra: 'extra', alternate: 'alternate', counterpart: 'counterpart', 'match no': 'matchNo', matchno: 'matchNo',
};

/** "$1,234.50" → 1234.5, "" → null. */
const n = (v: string | undefined) => {
  const s = (v ?? '').replace(/[$€£,\s%]/g, '');
  return s === '' || !Number.isFinite(Number(s)) ? null : Number(s);
};
const t = (v: string | undefined) => (v ?? '').trim() || null;
/** The sheet read Missing % ≤ 1 as a fraction (0.25 = 25%) and larger values as a percent. "25%" is 25. */
const pct = (v: string | undefined) => {
  const x = n(v);
  return x === null || (v ?? '').includes('%') || x > 1 ? x : x * 100;
};

/** Imports a Sets CSV or a History CSV (detected from the header). Existing sets are updated by set number. */
const bool = (v: string | undefined) => /^(true|yes|1)$/i.test((v ?? '').trim());

/**
 * Imports a Sets, History or Parts CSV (detected from the header). Existing sets are updated by set number;
 * a Parts CSV replaces the parts lists of the sets it mentions and skips sets that aren't in the collection.
 */
export async function importCsv(db: DB, text: string): Promise<Result<{ kind: 'sets' | 'history' | 'parts'; count: number; skipped?: number }>> {
  const [head, ...body] = parseCsv(text.replace(/^﻿/, ''));
  if (!head) return { ok: false, status: 400, error: 'The file is empty.' };
  const keys = head.map((h) => ALIASES[h.trim().toLowerCase()] ?? '');
  const rows = body.map((r) => Object.fromEntries(keys.map((k, i) => [k, r[i] === undefined ? r[i] : unguard(r[i])]).filter(([k]) => k)) as Record<string, string>);

  if (keys.includes('partNo') && keys.includes('partSet')) {
    const bySet = new Map<string, SetPart[]>();
    for (const r of rows) {
      const no = setNo(r.partSet), partNo = t(r.partNo);
      if (!partNo || !/^\d{3,7}-\d{1,2}$/.test(no)) continue;
      const list = bySet.get(no) ?? bySet.set(no, []).get(no)!;
      list.push({
        matchNo: n(r.matchNo) ?? 0, partNo, name: t(r.partName) ?? partNo, type: t(r.type) ?? 'PART', colorId: n(r.colorId),
        qty: n(r.qty) ?? 0, extra: n(r.extra) ?? 0, alternate: bool(r.alternate), counterpart: bool(r.counterpart),
      });
    }
    let count = 0, skipped = 0;
    for (const [no, parts] of bySet) {
      const s = await db.select({ id: sets.id }).from(sets).where(eq(sets.setNo, no)).get();
      if (!s) { skipped += parts.length; continue; }
      await replaceParts(db, s.id, parts);
      count += parts.length;
    }
    return { ok: true, kind: 'parts', count, skipped };
  }

  if (keys.includes('date') && !keys.includes('setNo')) {
    let count = 0;
    for (const r of rows) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date?.trim() ?? '')) continue;
      const v = { sets: n(r.sets) ?? 0, copies: n(r.copies) ?? 0, estValue: n(r.estValue) ?? 0, avgSold: n(r.avgSold) ?? 0, pieces: n(r.pieces) ?? 0 };
      await db.insert(history).values({ date: r.date.trim(), ...v }).onConflictDoUpdate({ target: history.date, set: v });
      count++;
    }
    return { ok: true, kind: 'history', count };
  }
  if (!keys.includes('setNo')) return { ok: false, status: 400, error: 'Not a Sets, History or Parts CSV: no "Lego #", "Date" or "Part No" column found.' };

  let count = 0;
  for (const r of rows) {
    const no = setNo(r.setNo);
    if (!/^\d{3,7}-\d{1,2}$/.test(no)) continue;
    const condition = (CONDITIONS as readonly string[]).includes(r.condition?.trim()) ? (r.condition.trim() as Condition) : null;
    const location = t(r.location);
    if (location) await db.insert(locations).values({ name: location, sort: 99 }).onConflictDoNothing();
    const v = {
      name: t(r.name) ?? t(r.blName) ?? no, location, condition, registered: t(r.registered), missingPct: pct(r.missingPct),
      qty: Math.max(1, Math.round(n(r.qty) ?? 1)), notes: t(r.notes), blName: t(r.blName), year: n(r.year), categoryId: n(r.categoryId),
      imageUrl: t(r.imageUrl), pieces: n(r.pieces), partLots: n(r.partLots), avgSold: n(r.avgSold), minSold: n(r.minSold),
      maxSold: n(r.maxSold), qtySold: n(r.qtySold), estValue: n(r.estValue), blError: t(r.blError), lastUpdated: t(r.lastUpdated),
    };
    await db.insert(sets).values({ setNo: no, ...v }).onConflictDoUpdate({ target: sets.setNo, set: { ...v, updatedAt: sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))` } });
    count++;
  }
  return { ok: true, kind: 'sets', count };
}
