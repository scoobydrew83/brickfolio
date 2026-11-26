import { expect, it } from 'vitest';
import { createWedgeBuffer } from './wedge';

const feed = (keys: string, start = 1000, step = 10) => {
  const w = createWedgeBuffer();
  let out: string | null = null;
  [...keys.split(''), 'Enter'].forEach((k, i) => { const r = w.key(k, start + i * step); if (r) out = r; });
  return out;
};

it('takes a fast burst of digits ending in Enter as a scan', () => {
  expect(feed('5702017417110')).toBe('5702017417110');
  expect(feed('12345678')).toBe('12345678');
});

it('ignores people typing, short bursts and non-digits', () => {
  expect(feed('5702017417110', 1000, 150)).toBeNull(); // too slow: a person
  expect(feed('1234')).toBeNull(); // too short to be a box barcode
  const w = createWedgeBuffer();
  ['5', '7', 'a', '0', '2'].forEach((k, i) => w.key(k, i * 5));
  expect(w.key('Enter', 30)).toBeNull();
});

it('starts over after a pause, so a slow first digit does not spoil the scan', () => {
  const w = createWedgeBuffer();
  w.key('9', 0); // a stray key, long before the scan
  const code = '5702017417110';
  [...code].forEach((k, i) => w.key(k, 5000 + i * 8));
  expect(w.key('Enter', 5000 + code.length * 8)).toBe(code);
});
