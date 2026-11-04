import { describe, expect, it } from 'vitest';
import { copiesSummary, copyGuide, costBasis, dailyHistory, displayNo, estValue, filterSets, groupTotals, parseCopyInput, parseQuickList, parseSetInput, parseSetWithCopy, setGuide, setNo, totals, withCopies, type CopyRow, type SetRow } from './sets';

const LOCS = ['Out', 'Storage', 'Sell'];
const parse = (f: Record<string, unknown>, partial = true) => parseSetInput(f, partial, LOCS);

describe('parseSetInput', () => {
  it('accepts a valid add and normalizes the set number', () => {
    const r = parse({ setNo: '10280', name: 'Flower Bouquet', condition: 'Used' }, false);
    expect(r).toEqual({ ok: true, value: { setNo: '10280-1', name: 'Flower Bouquet', condition: 'Used' } });
  });
  it('rejects bad input', () => {
    expect(parse({ setNo: '10280; drop', name: 'x', condition: 'Used' }, false).ok).toBe(false);
    expect(parse({ setNo: '10280', condition: 'Used' }, false).ok).toBe(false); // add needs a name
    expect(parse({ setNo: '10280', name: 'x', condition: 'Mint' }, false).ok).toBe(false);
    expect(parse({ setNo: '10280', location: 'Garage' }).ok).toBe(false);
    expect(parse({ setNo: '10280', missingPct: '150' }).ok).toBe(false);
    expect(parse({ setNo: '10280', qty: '1.5' }).ok).toBe(false);
    expect(parse({ setNo: '10280', qty: '0' }).ok).toBe(false);
    expect(parse({ setNo: '10280', registered: 'maybe' }).ok).toBe(false);
  });
  it('lets an edit clear fields and send only what was given', () => {
    expect(parse({ setNo: '10280', missingPct: '', location: '' })).toEqual({ ok: true, value: { setNo: '10280-1', missingPct: null, location: null } });
    expect(parse({ setNo: '10280', condition: 'Partial' })).toEqual({ ok: true, value: { setNo: '10280-1', condition: 'Partial' } });
    expect(parse({ setNo: '10280', qty: '3' })).toMatchObject({ ok: true, value: { qty: 3 } });
  });
});

it('set number suffix', () => {
  expect(setNo(10280)).toBe('10280-1');
  expect(setNo('10280-2')).toBe('10280-2');
  expect(displayNo('10280-1')).toBe('10280');
  expect(displayNo('10280-2')).toBe('10280-2');
});

let cid = 0;
const copy = (o: Partial<CopyRow> = {}): CopyRow => ({
  id: ++cid, setId: 0, collectionId: null, status: 'built', condition: 'Used', missingPct: null, location: null, acquiredDate: null, buildDate: null,
  pricePaid: null, tax: null, shipping: null, gwp: false, estValue: null, estGuide: null, notes: null, ...o,
});
/** A set row with `qty` copies sharing condition, location, Missing % and per-copy value (or the given `copies`). */
const row = (o: Partial<SetRow> = {}): SetRow => {
  const { qty = 1, condition = 'Used', location = null, missingPct = null, estValue = null, copies, ...rest } = o;
  const base = {
    id: 0, setNo: '', name: '', blName: null, year: null, categoryId: null, imageUrl: null, pieces: null, partLots: null, registered: null,
    avgSold: null, minSold: null, maxSold: null, qtySold: null, blError: null, lastUpdated: null, notes: null, ...rest,
  };
  const c = condition ?? 'Used';
  return withCopies(base, copies ?? Array.from({ length: qty }, () => copy({ condition: c, status: c === 'New' ? 'sealed' : 'built', location, missingPct, estValue })));
};
const sets = [
  row({ setNo: '10280-1', name: 'Flower Bouquet', location: 'Out', estValue: 22.88, avgSold: 22.88, pieces: 765 }),
  row({ setNo: '43205-1', name: 'Ultimate Adventure Castle', condition: 'New', estValue: 81.84, avgSold: 81.84, pieces: 749 }),
  row({ setNo: '9999-1', name: 'Partial thing', location: 'Out', condition: 'Partial', estValue: 9, avgSold: 10, blError: 'item: not found' }),
];
const all = { q: '', location: '', condition: '', sort: 'setNo' as const };

describe('filterSets', () => {
  it('sorts set numbers numerically', () => expect(filterSets(sets, all).map((s) => s.setNo).join()).toBe('9999-1,10280-1,43205-1'));
  it('filters by location, blank location and condition', () => {
    expect(filterSets(sets, { ...all, location: 'Out' })).toHaveLength(2);
    expect(filterSets(sets, { ...all, location: '(none)' })).toHaveLength(1);
    expect(filterSets(sets, { ...all, condition: 'Partial' })).toHaveLength(1);
  });
  it('searches by name and sorts by value', () => {
    expect(filterSets(sets, { ...all, q: 'castle' })[0].setNo).toBe('43205-1');
    expect(filterSets(sets, { ...all, sort: 'value' })[0].setNo).toBe('43205-1');
  });
});

describe('totals', () => {
  it('sums Est. Value, pieces and errors', () => {
    const t = totals(sets);
    expect(t.estValue).toBeCloseTo(113.72);
    expect(t.avgSold).toBeGreaterThan(t.estValue);
    expect([t.pieces, t.errors, t.count]).toEqual([1514, 1, 3]);
  });
  it('multiplies by qty; count stays distinct sets', () => {
    const t = totals([...sets.slice(0, 2), row({ ...sets[2], copies: undefined, qty: 3, estValue: 9, condition: 'Partial', location: 'Out' })]);
    expect(t.estValue).toBeCloseTo(22.88 + 81.84 + 27);
    expect([t.count, t.copies]).toEqual([3, 5]);
  });
  it('min/max multiply by qty, blanks count as 0', () => {
    const t = totals([row({ minSold: 5, maxSold: 40, qty: 2 }), row({ minSold: 1 })]);
    expect([t.minSold, t.maxSold]).toEqual([11, 80]);
  });
  it('groups by location, blank as (none), biggest value first', () => {
    const g = groupTotals(sets, 'location');
    expect(g.map((x) => `${x.label}:${x.count}`).join()).toBe('(none):1,Out:2');
    expect(g[1].estValue).toBeCloseTo(31.88);
  });
});

describe('copies', () => {
  const LOCS = ['Out', 'Storage'];
  it('parseCopyInput: sealed forces New, gift with purchase zeroes the cost, bad dates and money are refused', () => {
    expect(parseCopyInput({ status: 'sealed', condition: 'Used' }, false, LOCS)).toMatchObject({ ok: true, value: { status: 'sealed', condition: 'New', gwp: false } });
    expect(parseCopyInput({ status: 'sealed', condition: 'Partial' }, false, LOCS).ok).toBe(false);
    expect(parseCopyInput({ condition: 'New' }, false, LOCS)).toMatchObject({ ok: true, value: { status: 'sealed', condition: 'New' } });
    expect(parseCopyInput({}, false, LOCS)).toMatchObject({ ok: true, value: { status: 'built', condition: 'Used' } });
    expect(parseCopyInput({ gwp: 'on', pricePaid: '20' }, true, LOCS)).toEqual({ ok: true, value: { gwp: true, pricePaid: 0 } });
    expect(parseCopyInput({ pricePaid: '12.345', tax: '', shipping: '4' }, true, LOCS)).toEqual({ ok: true, value: { pricePaid: 12.35, tax: null, shipping: 4 } });
    expect(parseCopyInput({ acquiredDate: '2026-02-30' }, true, LOCS).ok).toBe(false);
    expect(parseCopyInput({ acquiredDate: '4 Nov' }, true, LOCS).ok).toBe(false);
    expect(parseCopyInput({ pricePaid: '-1' }, true, LOCS).ok).toBe(false);
    expect(parseCopyInput({ pricePaid: '1000001' }, true, LOCS).ok).toBe(false);
    expect(parseCopyInput({ status: 'lost' }, true, LOCS).ok).toBe(false);
    expect(parseCopyInput({ location: 'Garage' }, true, LOCS).ok).toBe(false);
    expect(parseCopyInput({ acquiredDate: '', buildDate: '2026-11-04' }, true, LOCS)).toEqual({ ok: true, value: { acquiredDate: null, buildDate: '2026-11-04' } });
  });
  it('parseSetWithCopy keeps set fields on the set and the rest on the copy', () => {
    const r = parseSetWithCopy({ setNo: '10280', name: 'x', condition: 'New', location: 'Out', notes: 'set', copyNotes: 'box', pricePaid: '49.99' }, false, LOCS);
    expect(r).toMatchObject({ ok: true, value: { condition: 'New', location: 'Out', notes: 'set', copy: { pricePaid: 49.99, notes: 'box' } } });
  });
  it('copyGuide, costBasis and setGuide', () => {
    expect(copyGuide(copy({ status: 'sealed', condition: 'New' }))).toBe('N');
    expect(copyGuide(copy({ status: 'built', condition: 'New' }))).toBe('N');
    expect(copyGuide(copy({ status: 'built', condition: 'Partial' }))).toBe('U');
    expect(costBasis(copy())).toBeNull();
    expect(costBasis(copy({ pricePaid: 10, tax: 0.8, shipping: 4.99 }))).toBe(15.79);
    expect(costBasis(copy({ gwp: true, pricePaid: 10 }))).toBe(0);
    const sealed = copy({ status: 'sealed', condition: 'New' }), built = copy();
    expect(setGuide([sealed, sealed, built])).toBe('N');
    expect(setGuide([sealed, built])).toBe('U'); // tie goes to used
    expect(setGuide([sealed, copy({ status: 'parted_out' }), copy({ status: 'parted_out' })])).toBe('N'); // parted out don't vote
    expect(setGuide([])).toBe('U');
  });
  it('derives qty, shared fields, value, cost and gain; parted out copies are left out', () => {
    const s = row({ copies: [copy({ status: 'sealed', condition: 'New', location: 'Out', estValue: 100, pricePaid: 60, tax: 5 }), copy({ location: 'Storage', estValue: 70, gwp: true }), copy({ status: 'parted_out', estValue: 50 })] });
    expect(s).toMatchObject({ qty: 2, condition: null, location: null, mixed: { condition: true, location: true }, valueTotal: 170, estValue: 85, costBasis: 65, costCovered: 2, gain: 105, partedOut: 1 });
    expect(copiesSummary(s.copies)).toBe('1 sealed · 1 built · 1 parted out');
    const t = totals([s]);
    expect([t.copies, t.estValue, t.costBasis, t.gain, t.partedOut]).toEqual([2, 170, 65, 105, 1]);
    expect(totals([row({ copies: [copy({ status: 'parted_out' })] })]).count).toBe(0);
  });
  it('filters and groups by copies: any copy matches, and a set in two places counts in both', () => {
    const s = row({ setNo: '1-1', copies: [copy({ location: 'Out', estValue: 10 }), copy({ location: 'Storage', status: 'sealed', condition: 'New', estValue: 30 })] });
    expect(filterSets([s], { ...all, location: 'Storage' })).toHaveLength(1);
    expect(filterSets([s], { ...all, condition: 'New' })).toHaveLength(1);
    expect(filterSets([s], { ...all, status: 'sealed' })).toHaveLength(1);
    expect(filterSets([s], { ...all, status: 'in_progress' })).toHaveLength(0);
    const g = groupTotals([s], 'location');
    expect(g.map((x) => `${x.label}:${x.copies}:${x.estValue}`)).toEqual(['Storage:1:30', 'Out:1:10']);
  });
});

it('dailyHistory keeps the last row per day, oldest first, and drops bad dates', () => {
  const h = (date: string, v: number) => ({ date, sets: 1, copies: 1, estValue: v, avgSold: v, pieces: 1 });
  const days = dailyHistory([h('2026-10-26', 5), h('2026-10-25', 1), h('2026-10-25', 2), h('', 9)]);
  expect(days.map((d) => `${d.date}=${d.estValue}`).join()).toBe('2026-10-25=2,2026-10-26=5');
});

it('estValue subtracts Missing % for any condition, like the sheet formula', () => {
  expect(estValue(100, 25)).toBe(75);
  expect(estValue(22.8833, null)).toBe(22.8833); // unrounded
  expect(estValue(null, 0)).toBeNull();
});

describe('parseQuickList', () => {
  it('reads set and minifig numbers with counts, adding repeats', () => {
    expect(parseQuickList('10497\n10497-1 x2, 2x 21325; sw0001\nSW0001*3\n# a comment\n#10305\n\nhello, 10497x0')).toEqual({
      sets: [{ setNo: '10497-1', qty: 3 }, { setNo: '21325-1', qty: 2 }, { setNo: '10305-1', qty: 1 }],
      minifigs: [{ figNo: 'sw0001', qty: 4 }],
      invalid: ['hello', '10497x0'],
    });
  });
  it('caps a paste at 500 entries', () => {
    const r = parseQuickList(Array.from({ length: 502 }, (_, i) => String(10000 + i)).join('\n'));
    expect(r.sets).toHaveLength(500);
    expect(r.invalid).toEqual(['10500-1', '10501-1']);
  });
});
