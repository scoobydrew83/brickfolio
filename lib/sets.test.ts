import { describe, expect, it } from 'vitest';
import { dailyHistory, displayNo, estValue, filterSets, groupTotals, parseSetInput, setNo, totals, type SetRow } from './sets';

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

const row = (o: Partial<SetRow>): SetRow => ({
  id: 0, setNo: '', name: '', blName: null, year: null, categoryId: null, imageUrl: null, pieces: null, partLots: null, location: null,
  condition: 'Used', registered: null, missingPct: null, qty: 1, avgSold: null, minSold: null, maxSold: null, qtySold: null, estValue: null,
  blError: null, lastUpdated: null, notes: null, ...o,
});
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
    expect(filterSets([...sets, row({ setNo: '1-1', condition: null })], { ...all, condition: '(none)' })).toHaveLength(1);
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
    const t = totals([...sets.slice(0, 2), { ...sets[2], qty: 3 }]);
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
