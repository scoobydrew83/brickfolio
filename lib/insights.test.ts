import { expect, it } from 'vitest';
import { byYear, insights, returns } from './insights';
import { withCopies, type CopyRow, type SetRow } from './sets';

let cid = 0;
const copy = (o: Partial<CopyRow> = {}): CopyRow => ({
  id: ++cid, setId: 0, collectionId: null, status: 'built', condition: 'Used', missingPct: null, location: null, acquiredDate: null, buildDate: null,
  pricePaid: null, tax: null, shipping: null, gwp: false, estValue: null, estGuide: null, notes: null, ...o,
});
const set = (setNo: string, o: Partial<SetRow>, copies: CopyRow[]): SetRow => withCopies({
  id: 0, setNo, name: setNo, blName: null, year: null, categoryId: null, imageUrl: null, pieces: null, partLots: null, registered: null,
  avgSold: null, minSold: null, maxSold: null, qtySold: null, blError: null, lastUpdated: null, notes: null, theme: null, ...o,
} as Omit<SetRow, 'copies'>, copies) as SetRow;

const all = [
  set('1-1', { year: 2020, theme: 'Icons' }, [copy({ estValue: 150, pricePaid: 100, location: 'Shelf' })]), // +50%
  set('2-1', { year: 2018, theme: 'Icons' }, [copy({ estValue: 40, pricePaid: 80, location: 'Shelf' })]), // −50%
  set('3-1', { year: 2020, theme: 'Technic' }, [copy({ estValue: 60, location: 'Storage' }), copy({ status: 'sold', estValue: 60, pricePaid: 50, salePrice: 90, saleFees: 10 })]),
  set('4-1', { year: 2019, theme: 'Space' }, [copy({ status: 'sold', estValue: 30, salePrice: 30 })]), // only sold: not owned
];

it('groups owned value by year, oldest first', () => {
  expect(byYear(all)).toEqual([{ label: '2018', value: 40, count: 1 }, { label: '2020', value: 210, count: 2 }]);
});

it('ranks returns on cost, best first, over owned sets with a cost', () => {
  expect(returns(all).map((r) => [r.setNo, r.pct, r.gain])).toEqual([['1-1', 50, 50], ['2-1', -50, -40]]);
});

it('puts the page together: themes, locations, best and worst, coverage and the realised gain', () => {
  const i = insights(all, 'USD', 1);
  expect(i.byTheme.map((b) => [b.label, b.value])).toEqual([['Icons', 190], ['Technic', 60]]);
  expect(i.byLocation.map((b) => b.label)).toEqual(['Shelf', 'Storage']);
  expect([i.best[0].setNo, i.worst[0].setNo]).toEqual(['1-1', '2-1']);
  expect(i.costCoverage).toEqual({ covered: 2, of: 3 });
  expect([i.total.sold, i.total.realised]).toEqual([2, 30]); // (90 − 10 − 50) + nothing for the uncosted sale
});

it('never lists a set as both best and lowest', () => {
  const many = Array.from({ length: 5 }, (_, i) => set(`${i + 10}-1`, {}, [copy({ estValue: 100 + i * 10, pricePaid: 100 })]));
  const i = insights(many, 'USD', 10);
  expect(i.best.map((r) => r.setNo)).toEqual(['14-1', '13-1', '12-1']);
  expect(i.worst.map((r) => r.setNo)).toEqual(['10-1', '11-1']);
});
