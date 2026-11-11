// Parts lists from files: BrickLink XML (Wanted Lists, inventory and Studio exports) and Rebrickable parts CSVs, turned
// into BrickLink part and colour numbers. Used by loose-part imports (lib/service/lots.ts) and your own builds' parts lists.
import { parseBrickLinkXml } from '../bricklink/wanted';
import type { DB } from '../db/types';
import { remember, resolveMany, type Resolved } from '../identifiers/resolve';
import type { PartLookup } from '../rebrickable/client';
import { parseCsv } from '../csv';
import { rbMappings } from './identifiers';

export const FILE_KINDS = ['bricklink_xml', 'rebrickable_csv'] as const;
export type FileKind = (typeof FILE_KINDS)[number];

/** Files are refused above these. */
export const MAX_BYTES = 5_000_000;
export const MAX_LINES = 20_000;

/** One line of a parts file in BrickLink numbers, or in Rebrickable's when there's no match (`mapped` false). */
export type FileLine = { type: string; partNo: string; colorId: number | null; qty: number; condition: 'N' | 'U' | null; mapped: boolean };
export type ReadResult = { ok: true; lines: FileLine[]; unmapped: number; skipped: number; note: string | null } | { ok: false; status: 400 | 413; error: string };

/** The kind of file, from its name or its first characters. */
export function detectKind(text: string, fileName?: string | null): FileKind | null {
  const n = (fileName ?? '').toLowerCase();
  if (n.endsWith('.xml')) return 'bricklink_xml';
  if (n.endsWith('.csv')) return 'rebrickable_csv';
  const head = text.replace(/^﻿/, '').trimStart().slice(0, 200);
  if (head.startsWith('<')) return 'bricklink_xml';
  if (/^"?part"?\s*,/i.test(head)) return 'rebrickable_csv';
  return null;
}

/**
 * A Rebrickable parts CSV (`Part,Color,Quantity`, optionally `Is Spare`, which is kept): columns found by header name,
 * case-blind. Rebrickable numbers; rows with quantity 0 are skipped.
 */
export function parseRebrickableCsv(text: string): { rows: { partNo: string; colorId: number; qty: number }[]; skipped: number; errors: string[] } {
  const all = parseCsv(text.replace(/^﻿/, ''));
  const errors: string[] = [];
  if (!all.length) return { rows: [], skipped: 0, errors: ['The file is empty.'] };
  const head = all[0].map((h) => h.trim().toLowerCase());
  const col = (...names: string[]) => head.findIndex((h) => names.includes(h));
  const part = col('part', 'part_num', 'part num'), color = col('color', 'color_id', 'colour'), qty = col('quantity', 'qty');
  if (part < 0 || color < 0 || qty < 0) return { rows: [], skipped: 0, errors: ['This isn\'t a Rebrickable parts CSV: it needs Part, Color and Quantity columns.'] };
  const rows: { partNo: string; colorId: number; qty: number }[] = [];
  let skipped = 0;
  all.slice(1).forEach((r, i) => {
    const line = i + 2;
    const p = (r[part] ?? '').trim(), c = (r[color] ?? '').trim(), q = (r[qty] ?? '').trim();
    const n = Number(q), cid = Number(c);
    if (!p || p.length > 64) return void errors.push(`Line ${line}: no part number.`);
    if (!/^-?\d+$/.test(c)) return void errors.push(`Line ${line} (${p}): colour "${c}" isn't a Rebrickable colour number.`);
    if (!Number.isInteger(n) || n < 0) return void errors.push(`Line ${line} (${p}): quantity "${q}" isn't a whole number.`);
    if (n === 0) { skipped++; return; }
    rows.push({ partNo: p, colorId: cid, qty: n });
  });
  return { rows, skipped, errors };
}

const blOf = (r: Resolved | undefined) => r?.canonical ?? r?.candidates[0]?.canonical ?? null;

/**
 * Rebrickable part and colour numbers to BrickLink ones through the identifiers map (filled by the daily sync). Numbers
 * it doesn't know yet are asked of Rebrickable when a key is set, and remembered. The first BrickLink number wins, as
 * for builds; a line is `mapped` only when both part and colour are known.
 */
export async function mapRebrickable(db: DB, rows: { partNo: string; colorId: number; qty: number }[], lookup: PartLookup | null): Promise<{ lines: FileLine[]; asked: boolean }> {
  const parts = [...new Set(rows.map((r) => r.partNo))], colors = [...new Set(rows.map((r) => r.colorId))];
  let [bp, bc] = await Promise.all([resolveMany(db, 'part', 'rebrickable', parts), resolveMany(db, 'color', 'rebrickable', colors)]);
  const missingParts = parts.filter((p) => !blOf(bp.get(p))), missingColors = colors.filter((c) => !blOf(bc.get(String(c))));
  let asked = false;
  if (lookup && (missingParts.length || missingColors.length)) {
    asked = true;
    if (missingColors.length) await remember(db, (await lookup.colors()).flatMap((c) => rbMappings('color', c.id, c)));
    if (missingParts.length) await remember(db, (await lookup.partsByNumbers(missingParts)).flatMap((p) => rbMappings('part', p.partNo, p)));
    [bp, bc] = await Promise.all([resolveMany(db, 'part', 'rebrickable', parts), resolveMany(db, 'color', 'rebrickable', colors)]);
  }
  return {
    asked,
    lines: rows.map((r) => {
      const part = blOf(bp.get(r.partNo)), color = blOf(bc.get(String(r.colorId)));
      return part && color !== null
        ? { type: 'PART', partNo: part, colorId: Number(color), qty: r.qty, condition: null, mapped: true }
        : { type: 'PART', partNo: r.partNo, colorId: r.colorId, qty: r.qty, condition: null, mapped: false };
    }),
  };
}

/** Merges lines with the same type, part, colour and mapping, adding quantities. Part numbers compare case-blind. */
export function mergeLines(lines: FileLine[]): FileLine[] {
  const by = new Map<string, FileLine>();
  for (const l of lines) {
    const k = `${l.type}|${l.partNo.toLowerCase()}|${l.colorId ?? -1}|${l.mapped}`;
    const m = by.get(k);
    if (m) m.qty += l.qty; else by.set(k, { ...l });
  }
  return [...by.values()];
}

/**
 * Reads a parts file into merged BrickLink lines. A file with any unreadable line is refused whole (nothing is written),
 * naming the first few problems; one over 5 MB answers 413.
 */
export async function readPartsFile(db: DB, kind: FileKind, text: string, lookup: PartLookup | null): Promise<ReadResult> {
  if (text.length > MAX_BYTES) return { ok: false, status: 413, error: 'The file is over 5 MB.' };
  const refuse = (errors: string[]): ReadResult => ({ ok: false, status: 400, error: `${errors.slice(0, 3).join(' ')}${errors.length > 3 ? ` (and ${errors.length - 3} more)` : ''} Nothing was imported.` });
  if (kind === 'bricklink_xml') {
    const { items, errors } = parseBrickLinkXml(text);
    if (errors.length) return refuse(errors);
    if (items.length > MAX_LINES) return { ok: false, status: 413, error: `The file has ${items.length.toLocaleString()} items; ${MAX_LINES.toLocaleString()} at most.` };
    return { ok: true, lines: mergeLines(items.map((i) => ({ type: i.type, partNo: i.partNo, colorId: i.colorId, qty: i.qty, condition: i.condition, mapped: true }))), unmapped: 0, skipped: 0, note: null };
  }
  const { rows, skipped, errors } = parseRebrickableCsv(text);
  if (errors.length) return refuse(errors);
  if (rows.length > MAX_LINES) return { ok: false, status: 413, error: `The file has ${rows.length.toLocaleString()} lines; ${MAX_LINES.toLocaleString()} at most.` };
  if (!rows.length) return { ok: false, status: 400, error: 'The file has no parts. Nothing was imported.' };
  const { lines } = await mapRebrickable(db, rows, lookup);
  const merged = mergeLines(lines);
  const unmapped = merged.filter((l) => !l.mapped).length;
  return {
    ok: true, lines: merged, unmapped, skipped,
    note: unmapped && !lookup ? 'Set REBRICKABLE_API_KEY (or wait for the daily sync to learn more part numbers) to match the rest to BrickLink numbers.' : null,
  };
}
