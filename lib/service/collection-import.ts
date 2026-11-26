// Collections exported from other trackers: Rebrickable set lists, Brickset "My sets" and BrickEconomy. Recognised
// by their header row and turned into sets and copies. The column names come from each site's documentation and from
// open-source tools that read these files (no sample file from the sites themselves was available):
// - Rebrickable set list: "Set Number,Quantity" (+ "Includes Spares", "Inventory Ver"); rebrickable.com/help/lists-sets/
// - Brickset My sets: "Number,Variant,…,SetName,…,QtyOwned,QtyOwnedNew,QtyOwnedUsed,…,UserNotes" (as read by the MIT
//   tools matthewgall/blocks and brittonnmt/brickset-browser); Number has no "-1", Variant does.
// - BrickEconomy: either one row per copy ("Number,…,SetName,Retail,Paid,Value,Condition,Date,Notes") or one row per
//   set with an "Owned" count; brickeconomy.com/faqs. Number includes "-1".
// Headers are matched by name, case-insensitively, never by position: the sites have changed their columns over time.
import { eq } from 'drizzle-orm';
import { sets } from '../db/schema';
import type { DB } from '../db/types';
import { placeholderName, setNo, type CopyInput } from '../sets';
import { insertCopies, repriceCopies } from './copies';
import { targetCollection } from './collections';
import type { Result } from './sets';

export type CollectionFormat = 'rebrickable' | 'brickset' | 'brickeconomy';
export const FORMAT_LABEL: Record<CollectionFormat, string> = { rebrickable: 'Rebrickable set list', brickset: 'Brickset My sets', brickeconomy: 'BrickEconomy collection' };
export type ImportItem = { setNo: string; name: string | null; copies: CopyInput[] };
export type Skipped = { row: number; reason: string };
export type CollectionPlan = { format: CollectionFormat; items: ImportItem[]; skipped: Skipped[] };
export type CollectionSummary = { format: CollectionFormat; label: string; newSets: number; existingSets: number; copies: number; skipped: Skipped[]; dryRun: boolean };

const key = (h: string) => h.trim().toLowerCase().replace(/[\s_]+/g, ' ');

/** Which tracker a header row comes from, or null for any other CSV. */
export function detectCollection(header: string[]): CollectionFormat | null {
  const h = new Set(header.map(key));
  if (h.has('number') && h.has('variant') && (h.has('setname') || h.has('qtyowned') || h.has('own'))) return 'brickset';
  if ((h.has('set number') || h.has('set num')) && h.has('quantity')) return 'rebrickable';
  if (h.has('number') && (h.has('retail') || h.has('paid')) && (h.has('owned') || h.has('condition') || h.has('paid'))) return 'brickeconomy';
  return null;
}

const money = (v: string | undefined) => {
  const s = (v ?? '').replace(/[^\d.,-]/g, '').replace(/,(?=\d{3}\b)/g, '').replace(',', '.');
  const x = Number(s);
  return s === '' || !Number.isFinite(x) || x < 0 || x > 1_000_000 ? null : Math.round(x * 100) / 100;
};
const count = (v: string | undefined) => { const x = Number((v ?? '').trim()); return Number.isInteger(x) && x > 0 ? Math.min(x, 999) : 0; };
/** Only unambiguous dates: 2024-03-05, or "Mar 5, 2024" / "5 March 2024". 03/05/2024 could be either, so it's left out. */
function date(v: string | undefined): string | null {
  const s = (v ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  if (!/[a-z]{3}/i.test(s)) return null;
  const t = Date.parse(`${s} UTC`);
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : null;
}
const validNo = (no: string) => /^\d{3,7}-\d{1,2}$/.test(no);

/** Rows (header + body) of a recognised file → what to add. */
export function planCollection(format: CollectionFormat, header: string[], body: string[][]): CollectionPlan {
  const idx = new Map(header.map((h, i) => [key(h), i]));
  const get = (r: string[], ...names: string[]) => { for (const n of names) { const i = idx.get(n); if (i !== undefined && r[i] !== undefined && r[i].trim() !== '') return r[i].trim(); } return undefined; };
  const items = new Map<string, ImportItem>();
  const skipped: Skipped[] = [];
  const add = (no: string, name: string | null, copies: CopyInput[]) => {
    const it = items.get(no) ?? { setNo: no, name, copies: [] };
    it.copies.push(...copies);
    items.set(no, it);
  };
  body.forEach((r, i) => {
    const row = i + 2; // as a spreadsheet numbers it, after the header
    if (!r.some((c) => c.trim())) return;
    if (format === 'rebrickable') {
      const no = setNo(get(r, 'set number', 'set num') ?? '');
      const qty = count(get(r, 'quantity')) || 1;
      if (!validNo(no)) return void skipped.push({ row, reason: 'not a set number' });
      add(no, null, Array.from({ length: qty }, () => ({ condition: 'Used' as const, status: 'built' as const })));
    } else if (format === 'brickset') {
      const num = get(r, 'number') ?? '';
      const no = setNo(/-\d+$/.test(num) ? num : `${num}-${get(r, 'variant') || '1'}`);
      if (!validNo(no)) return void skipped.push({ row, reason: 'not a set number' });
      const nNew = count(get(r, 'qtyownednew')), nUsed = count(get(r, 'qtyownedused'));
      const own = /^(x|true|yes|1|y)$/i.test(get(r, 'own') ?? '');
      const total = count(get(r, 'qtyowned')) || (own ? 1 : 0);
      if (!total && !nNew && !nUsed) return void skipped.push({ row, reason: 'wanted, not owned' });
      const rest = Math.max(0, total - nNew - nUsed);
      const notes = get(r, 'usernotes') ?? null;
      const copies: CopyInput[] = [
        ...Array.from({ length: nNew }, () => ({ condition: 'New' as const, status: 'sealed' as const })),
        ...Array.from({ length: nUsed + rest }, () => ({ condition: 'Used' as const, status: 'built' as const })),
      ];
      if (notes && copies[0]) copies[0].notes = notes.slice(0, 2000);
      add(no, get(r, 'setname', 'name') ?? null, copies);
    } else {
      const no = setNo(get(r, 'number', 'set number') ?? '');
      if (!validNo(no)) return void skipped.push({ row, reason: 'not a set number' });
      const name = get(r, 'setname', 'name', 'set name') ?? null;
      if (idx.has('condition') || idx.has('paid')) {
        const cond = (get(r, 'condition') ?? '').toLowerCase();
        const isNew = /new|sealed/.test(cond) && !/used/.test(cond);
        const note = get(r, 'notes');
        add(no, name, [{
          condition: isNew ? 'New' : /incomplete/.test(cond) ? 'Partial' : 'Used', status: isNew ? 'sealed' : 'built',
          pricePaid: money(get(r, 'paid', 'price paid')), acquiredDate: date(get(r, 'date', 'acquired', 'date acquired')),
          notes: note && note !== 'Imported from BrickEconomy' ? note.slice(0, 2000) : null,
        }]);
      } else {
        const qty = count(get(r, 'owned', 'quantity'));
        if (!qty) return void skipped.push({ row, reason: 'wanted, not owned' });
        add(no, name, Array.from({ length: qty }, () => ({ condition: 'Used' as const, status: 'built' as const })));
      }
    }
  });
  return { format, items: [...items.values()], skipped };
}

/**
 * Adds the plan's copies: to sets already in the collection, or to new sets, which are looked up at the next sync
 * (names from the file meanwhile). With `dryRun`, only counts what would happen. Importing the same file twice adds
 * the copies twice, so the preview says how many sets are already here.
 */
export async function applyCollection(db: DB, plan: CollectionPlan, opts: { dryRun?: boolean; collectionId?: number } = {}): Promise<Result<{ summary: CollectionSummary }>> {
  const col = await targetCollection(db, opts.collectionId);
  if (!col.ok) return col;
  let newSets = 0, existingSets = 0, copies = 0;
  for (const it of plan.items) {
    const have = await db.select({ id: sets.id }).from(sets).where(eq(sets.setNo, it.setNo)).get();
    if (have) existingSets++; else newSets++;
    copies += it.copies.length;
    if (opts.dryRun || !it.copies.length) continue;
    const id = have?.id ?? (await db.insert(sets).values({ setNo: it.setNo, name: it.name?.slice(0, 120) || placeholderName(it.setNo) }).onConflictDoNothing().returning({ id: sets.id }).all())[0]?.id;
    if (id === undefined) continue;
    for (const c of it.copies) await insertCopies(db, id, { ...c, collectionId: col.id }, 1);
    if (have) await repriceCopies(db, id);
  }
  return { ok: true, summary: { format: plan.format, label: FORMAT_LABEL[plan.format], newSets, existingSets, copies, skipped: plan.skipped, dryRun: !!opts.dryRun } };
}
