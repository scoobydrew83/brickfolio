// Draws the valuation report (lib/service/report.ts) as a PDF with pdf-lib, so it works on Node and Cloudflare alike.
// Standard Helvetica only covers Latin-1-ish text (WinAnsi), so everything printed goes through `clean`.
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { APP_NAME } from '../brand';
import type { Valuation } from '../service/report';

const SWAP: Record<string, string> = { '›': '>', '‹': '<', '−': '-', '→': '->', '·': '·', ' ': ' ', ' ': ' ' };
/** WinAnsi-safe text: keeps Latin-1 and the few extra characters Helvetica has, swaps or drops the rest. */
export function clean(s: string): string {
  const extra = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
  return [...String(s ?? '')].map((c) => {
    if (SWAP[c] !== undefined) return SWAP[c];
    const code = c.codePointAt(0)!;
    if ((code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) || extra.includes(c)) return c;
    return c.normalize('NFKD').replace(/[^\x20-\x7e]/g, '') || '?';
  }).join('');
}

/** Money in the report currency; falls back to "INR 1,234.00" when the symbol can't be printed. */
export function pdfMoney(v: number | null, currency: string): string {
  if (v == null) return '-';
  const s = v.toLocaleString('en-US', { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return clean(s) === s ? s : `${currency} ${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const INK = rgb(0.09, 0.09, 0.11), MUTED = rgb(0.38, 0.38, 0.42), LINE = rgb(0.85, 0.85, 0.83), BAND = rgb(0.96, 0.96, 0.95);

export async function valuationPdf(v: Valuation): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(clean(`${APP_NAME} valuation report ${v.generatedAt.slice(0, 10)}`));
  doc.setProducer(APP_NAME);
  doc.setCreator(APP_NAME);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  // US Letter for dollars, A4 elsewhere.
  const [W, H] = v.currency === 'USD' || v.currency === 'CAD' ? [612, 792] : [595.28, 841.89];
  const M = 40;
  const money = (n: number | null) => pdfMoney(n, v.currency);
  let page: PDFPage = doc.addPage([W, H]);
  let y = H - M;

  const text = (s: string, x: number, size = 9, f: PDFFont = font, color = INK) => page.drawText(clean(s), { x, y, size, font: f, color });
  const right = (s: string, xr: number, size = 9, f: PDFFont = font, color = INK) => { const c = clean(s); page.drawText(c, { x: xr - f.widthOfTextAtSize(c, size), y, size, font: f, color }); };
  const fit = (s: string, width: number, size = 9, f: PDFFont = font) => {
    let c = clean(s);
    if (f.widthOfTextAtSize(c, size) <= width) return c;
    while (c.length > 1 && f.widthOfTextAtSize(c + '...', size) > width) c = c.slice(0, -1);
    return c.trimEnd() + '...';
  };
  const wrap = (s: string, width: number, size = 9, f: PDFFont = font) => {
    const out: string[] = []; let cur = '';
    for (const w of clean(s).split(/\s+/)) {
      const next = cur ? `${cur} ${w}` : w;
      if (f.widthOfTextAtSize(next, size) > width && cur) { out.push(cur); cur = w; } else cur = next;
    }
    if (cur) out.push(cur);
    return out;
  };
  const rule = () => page.drawLine({ start: { x: M, y: y - 3 }, end: { x: W - M, y: y - 3 }, thickness: 0.5, color: LINE });
  const newPage = () => { page = doc.addPage([W, H]); y = H - M; };
  const need = (h: number, onBreak?: () => void) => { if (y - h < M + 24) { newPage(); onBreak?.(); } };

  // ---- cover ----
  text(`${APP_NAME} · Collection valuation`, M, 18, bold); y -= 20;
  text(`Prepared ${new Date(v.generatedAt).toUTCString().slice(5, 16)}${v.owner ? ` for ${v.owner}` : ''} · values in ${v.currency}`, M, 10, font, MUTED); y -= 40;

  const stat = (label: string, value: string, x: number) => {
    page.drawText(clean(label), { x, y: y + 16, size: 8, font, color: MUTED });
    page.drawText(clean(value), { x, y, size: 14, font: bold, color: INK });
  };
  const col = (W - 2 * M) / 3;
  stat('Estimated value', money(v.totals.value), M);
  stat(`Sets (${v.totals.sets}, ${v.totals.setCopies} copies)`, money(v.totals.setValue), M + col);
  stat(`Minifigures (${v.totals.minifigs}, ${v.totals.minifigCopies} copies)`, money(v.totals.minifigValue), M + 2 * col);
  y -= 30;
  if (v.totals.retail != null) { text(`Original retail of the ${v.totals.retailCovered} items with a known retail price: ${money(v.totals.retail)} (Brickset).`, M, 9, font, MUTED); y -= 14; }
  if (v.totals.unpriced) { text(`${v.totals.unpriced} item${v.totals.unpriced === 1 ? ' has' : 's have'} no recent BrickLink sales and ${v.totals.unpriced === 1 ? 'is' : 'are'} listed without a value.`, M, 9, font, MUTED); y -= 14; }
  y -= 8;

  // ---- method ----
  text('How values are worked out', M, 11, bold); y -= 14;
  const method = [
    `Each value is the BrickLink average sold price over recent sales for the item's condition (new for New, used for Used and Partial), less the Missing % for incomplete sets. "Sales" is how many sales the average is based on, and "Priced" is the date it was fetched.`,
    `Last full price update: ${v.lastSync ? new Date(v.lastSync).toUTCString().slice(5, 22) + ' UTC' : 'not yet run'}.${v.partialWithParts ? ` ${v.partialWithParts} Partial set${v.partialWithParts === 1 ? "'s" : "s'"} Missing % comes from parts marked missing one by one.` : ''}`,
    'These are market estimates, not appraisals. Prices move; replacement cost for sealed or retired sets can be higher than the average sold price.',
  ];
  for (const para of method) for (const l of wrap(para, W - 2 * M)) { text(l, M, 9, font, MUTED); y -= 12; }
  y -= 10;

  // ---- by location ----
  text('By location', M, 11, bold); y -= 14;
  text('Location', M, 8, bold, MUTED); right('Items', M + 300, 8, bold, MUTED); right('Copies', M + 360, 8, bold, MUTED); right('Value', W - M, 8, bold, MUTED); rule(); y -= 13;
  for (const l of v.byLocation) {
    need(13);
    text(fit(l.label, 250), M); right(String(l.items), M + 300); right(String(l.copies), M + 360); right(money(l.value), W - M); y -= 13;
  }
  y -= 14;

  // ---- items ----
  const C = { no: M, name: M + 58, year: W - M - 334, cond: W - M - 304, qty: W - M - 214, each: W - M - 152, total: W - M - 88, sales: W - M - 52, priced: W - M };
  const head = () => {
    text('Items', M, 11, bold); y -= 14;
    for (const [k, label] of [['no', 'Number'], ['name', 'Name'], ['year', 'Year'], ['cond', 'Condition']] as const) text(label, C[k], 8, bold, MUTED);
    right('Qty', C.qty, 8, bold, MUTED); right('Each', C.each, 8, bold, MUTED); right('Total', C.total, 8, bold, MUTED); right('Sales', C.sales, 8, bold, MUTED); right('Priced', C.priced, 8, bold, MUTED);
    rule(); y -= 13;
  };
  need(60);
  head();
  let lastLoc: string | null | undefined;
  let band = false;
  for (const l of v.lines) {
    if (l.location !== lastLoc) {
      need(28, head);
      y -= 3; text(l.location ?? 'No location', M, 9, bold); y -= 13; lastLoc = l.location; band = false;
    }
    need(13, head);
    if (band) page.drawRectangle({ x: M - 2, y: y - 3, width: W - 2 * M + 4, height: 12, color: BAND });
    band = !band;
    const cond = l.condition ? `${l.condition}${l.missingPct ? ` -${Math.round(l.missingPct * 10) / 10}%` : ''}` : '-';
    text(fit(l.no, 54), C.no);
    text(fit(`${l.kind === 'minifig' ? '[Minifig] ' : ''}${l.name}`, C.year - C.name - 6), C.name);
    text(l.year ? String(l.year) : '-', C.year);
    text(fit(cond, C.qty - C.cond - 14), C.cond);
    right(String(l.qty), C.qty); right(money(l.each), C.each); right(money(l.total), C.total, 9, bold);
    right(l.sales != null ? String(l.sales) : '-', C.sales); right(l.pricedAt ?? '-', C.priced, 8, font, MUTED);
    y -= 13;
  }
  need(20);
  y -= 4; rule(); y -= 14;
  text('Total estimated value', M, 10, bold); right(money(v.totals.value), C.total, 10, bold); y -= 13;

  // ---- footers ----
  const pages = doc.getPages();
  pages.forEach((p, i) => {
    const foot = clean(`${APP_NAME} valuation · ${v.generatedAt.slice(0, 10)} · Prices: BrickLink sold history. Retail: Brickset. Not an appraisal.`);
    p.drawText(foot, { x: M, y: M - 14, size: 7, font, color: MUTED });
    const pg = `Page ${i + 1} of ${pages.length}`;
    p.drawText(pg, { x: W - M - font.widthOfTextAtSize(pg, 7), y: M - 14, size: 7, font, color: MUTED });
  });
  return doc.save();
}
