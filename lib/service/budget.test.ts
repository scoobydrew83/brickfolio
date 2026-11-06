import { afterEach, expect, it } from 'vitest';
import { Budget, DAILY_LIMIT, otherGuideDailyCalls, RESERVE } from './budget';
import { partoutBudget } from './partout';

afterEach(() => { delete process.env.PARTOUT_DAILY_CALLS; });

it('counts calls and never hands out more than is left', () => {
  const b = new Budget();
  expect(b.left()).toBe(DAILY_LIMIT - RESERVE);
  b.spend(4000);
  expect(b.take(1000)).toBe(500);
  expect(b.left()).toBe(0);
  b.spend(10); // the primary lookups always run, even past the limit
  expect([b.used, b.left(), b.take(5)]).toEqual([4510, 0, 0]);
});

it('sizes the other guide to about a week, capped, or off', () => {
  expect(otherGuideDailyCalls(0, undefined)).toBe(10);
  expect(otherGuideDailyCalls(70, undefined)).toBe(20);
  expect(otherGuideDailyCalls(100_000, undefined)).toBe(1000);
  expect(otherGuideDailyCalls(70, '0')).toBe(0);
  expect(otherGuideDailyCalls(70, '25')).toBe(25);
  expect(otherGuideDailyCalls(70, '99999')).toBe(DAILY_LIMIT - RESERVE);
  expect(otherGuideDailyCalls(70, 'nope')).toBe(0);
});

it('leaves part prices what the rest used', () => {
  expect(partoutBudget(0)).toBe(1500);
  expect(partoutBudget(4000)).toBe(500);
  expect(partoutBudget(5000)).toBe(0);
});
