import { beforeEach, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import type { Lookup, MinifigLookup } from '../bricklink/client';
import { openNodeDb } from '../db/node';
import type { DB } from '../db/types';
import { clean, pdfMoney, valuationPdf } from '../report/pdf';
import { addMinifig } from './minifigs';
import { valuation } from './report';
import * as svc from './sets';

let db: DB;
const lookup: Lookup = async (no) => ({ blName: `BL ${no}`, year: 2021, categoryId: 1, imageUrl: null, avgSold: no === '1-1' ? null : 100, minSold: 90, maxSold: 110, qtySold: 7 });
const fig: MinifigLookup = async () => ({ blName: 'Luke', year: 1999, categoryId: 1, imageUrl: null, avgSold: 10, minSold: 5, maxSold: 15, qtySold: 4 });
beforeEach(() => { db = openNodeDb(':memory:').db; });

it('totals sets and minifigs by location and lists every item with its price source', async () => {
  await svc.addSet(db, { setNo: '10497-1', name: 'Galaxy Explorer', condition: 'New', location: 'Display', qty: 2 }, { lookup });
  await svc.addSet(db, { setNo: '6080-1', name: "King's Castle › Ünïcode ☃", condition: 'Partial', missingPct: 10, location: 'Storage' }, { lookup });
  await svc.addSet(db, { setNo: '1-1', name: 'Unsold', condition: 'Used' }, { lookup });
  await addMinifig(db, { figNo: 'sw0001', location: 'Display', qty: 3 }, { lookup: fig });

  const v = await valuation(db, { owner: '  Sam  ' });
  expect(v.owner).toBe('Sam');
  expect(v.totals).toMatchObject({ sets: 3, setCopies: 4, setValue: 290, minifigs: 1, minifigCopies: 3, minifigValue: 30, value: 320, unpriced: 1 });
  expect(v.byLocation.map((l) => [l.label, l.items, l.value])).toEqual([['Display', 2, 230], ['Storage', 1, 90], ['(none)', 1, 0]]);
  expect(v.lines.map((l) => l.no)).toEqual(['10497', 'sw0001', '6080', '1']);
  expect(v.lines[0]).toMatchObject({ each: 100, total: 200, sales: 7 });

  const pdf = await valuationPdf(v);
  const doc = await PDFDocument.load(pdf);
  expect(doc.getPageCount()).toBe(1);
  expect(doc.getTitle()).toContain('valuation report');
});

it('runs onto more pages for a big collection', async () => {
  for (let i = 0; i < 120; i++) await svc.addSet(db, { setNo: `${70000 + i}-1`, name: `Set ${i}`, condition: 'Used' }, { lookup: null });
  const doc = await PDFDocument.load(await valuationPdf(await valuation(db)));
  expect(doc.getPageCount()).toBeGreaterThan(2);
});

it('keeps text and money printable in Helvetica', () => {
  expect(clean('Lamborghini Sián › Ünï ☃ “quoted” — ok')).toBe('Lamborghini Sián > Ünï ? “quoted” — ok');
  expect(pdfMoney(1234.5, 'EUR')).toBe('€1,234.50');
  expect(pdfMoney(1234.5, 'INR')).toBe('INR 1,234.50');
  expect(pdfMoney(null, 'USD')).toBe('-');
});
