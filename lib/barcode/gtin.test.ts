import { describe, expect, it } from 'vitest';
import { checkDigit, createRepeatGuard, expandUpcE, formatHint, parseBarcode, spellings, upcOf } from './gtin';

describe('parseBarcode', () => {
  it('reads UPC-A and gives its 13-digit form', () => {
    expect(parseBarcode('673419264150')).toEqual({ ok: true, raw: '673419264150', format: 'UPC_A', gtin: '0673419264150' });
  });

  it('reads EAN-13 as is', () => {
    expect(parseBarcode('5702015869935')).toEqual({ ok: true, raw: '5702015869935', format: 'EAN_13', gtin: '5702015869935' });
  });

  it('treats a UPC-A read as EAN-13 (leading 0) as the same product', () => {
    const upc = parseBarcode('012345678905');
    const ean = parseBarcode('0012345678905');
    expect(upc.ok && ean.ok && upc.gtin === ean.gtin).toBe(true);
    if (ean.ok) expect(ean.raw).toBe('0012345678905'); // the scanned form is kept too
  });

  it('keeps leading zeros and never treats a barcode as a number', () => {
    const r = parseBarcode('000000000000'.slice(0, 11) + String(checkDigit('00000000000')));
    expect(r).toMatchObject({ ok: true, raw: '000000000000', gtin: '0000000000000' });
  });

  it('reads EAN-8, and UPC-E only when the decoder says so', () => {
    expect(parseBarcode('96385074')).toMatchObject({ ok: true, format: 'EAN_8', gtin: '96385074' });
    expect(parseBarcode('01234565', 'UPC_E')).toMatchObject({ ok: true, format: 'UPC_E', gtin: '0012345000065' });
  });

  it('drops spaces and dashes from typed input', () => {
    expect(parseBarcode(' 6 73419-26415 0 ')).toMatchObject({ ok: true, raw: '673419264150' });
  });

  it('rejects bad check digits, letters, odd lengths and long input', () => {
    expect(parseBarcode('673419264151')).toMatchObject({ ok: false, code: 'INVALID_BARCODE' });
    expect(parseBarcode('67341926415X')).toMatchObject({ ok: false, code: 'INVALID_BARCODE' });
    expect(parseBarcode('')).toMatchObject({ ok: false, code: 'INVALID_BARCODE' });
    expect(parseBarcode('12345')).toMatchObject({ ok: false, code: 'UNSUPPORTED_FORMAT' });
    expect(parseBarcode('1'.repeat(40))).toMatchObject({ ok: false, code: 'INVALID_BARCODE' });
    expect(parseBarcode(null)).toMatchObject({ ok: false });
  });
});

it('expands UPC-E per the GS1 rules', () => {
  expect(expandUpcE('01234565')).toBe('012345000065');
  expect(expandUpcE('01234560')).toBeNull(); // wrong check digit
  expect(expandUpcE('21234565')).toBeNull(); // number system must be 0 or 1
});

it('maps decoder format names', () => {
  expect(formatHint('ean_13')).toBe('EAN_13');
  expect(formatHint('UPC_A')).toBe('UPC_A');
  expect(formatHint('upc_e')).toBe('UPC_E');
  expect(formatHint('qr_code')).toBeNull();
});

it('lists both spellings of a UPC', () => {
  expect(upcOf('0673419264150')).toBe('673419264150');
  expect(upcOf('5702015869935')).toBeNull();
  expect(spellings('0673419264150')).toEqual(['0673419264150', '673419264150']);
});

describe('createRepeatGuard', () => {
  it('counts a box held in view once', () => {
    const g = createRepeatGuard({ goneFrames: 3 });
    expect(g.frame(['A'])).toEqual(['A']);
    for (let i = 0; i < 20; i++) expect(g.frame(['A'])).toEqual([]);
  });

  it('ignores a few missed frames but counts the box again once it has left', () => {
    const g = createRepeatGuard({ goneFrames: 3 });
    g.frame(['A']);
    g.frame([]); g.frame([]); // decoder missed it briefly
    expect(g.frame(['A'])).toEqual([]);
    g.frame([]); g.frame([]); g.frame([]); g.frame([]); // gone for 4 frames
    expect(g.frame(['A'])).toEqual(['A']);
  });

  it('tells two boxes apart and can forget one for "add another copy"', () => {
    const g = createRepeatGuard({ goneFrames: 3 });
    expect(g.frame(['A', 'B', 'A'])).toEqual(['A', 'B']);
    g.forget('A');
    expect(g.frame(['A', 'B'])).toEqual(['A']);
  });
});

it('limits lookups per window', async () => {
  const { createLimiter } = await import('./limit');
  let t = 0;
  const l = createLimiter(2, 1000, () => t);
  expect([l.take(), l.take(), l.take()]).toEqual([true, true, false]);
  t = 1001;
  expect(l.take()).toBe(true);
});

it('picks likely set numbers from OCR words, biggest print first', async () => {
  const { setNumberCandidates, ocrPaths } = await import('./ocr');
  const words = [
    { text: '1254', confidence: 90, height: 20 }, // piece count
    { text: '10497', confidence: 85, height: 80 }, // the set number, printed large
    { text: '18', confidence: 95, height: 30 }, // age
    { text: '10497', confidence: 60, height: 30 },
    { text: '0042', confidence: 90, height: 40 },
    { text: '31120', confidence: 20, height: 90 }, // too unsure
  ];
  expect(setNumberCandidates(words)).toEqual(['10497', '1254']);
  expect(ocrPaths({}).workerPath).toBe('/ocr/worker.min.js');
  expect(ocrPaths({ DB_DRIVER: 'd1' }).corePath).toMatch(/^https:\/\/cdn\.jsdelivr\.net\//);
  expect(ocrPaths({ OCR_ASSETS_URL: 'https://files.example/ocr/' })).toEqual({ workerPath: 'https://files.example/ocr/worker.min.js', corePath: 'https://files.example/ocr', langPath: 'https://files.example/ocr' });
});
