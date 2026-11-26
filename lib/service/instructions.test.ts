import { beforeEach, expect, it } from 'vitest';
import type { RetailSource } from '../brickset/client';
import { clearInstructionCache, setInstructions } from './instructions';

const pdf = { url: 'https://www.lego.com/cdn/product-assets/product.bi.core.pdf/6362469.pdf', description: 'Book 1' };
const source = (fn: RetailSource['instructions']): RetailSource => ({ check: async () => {}, sets: async () => ({ found: [], asked: [] }), instructions: fn });
beforeEach(() => clearInstructionCache());

it('fetches once and serves the cached list for a week', async () => {
  let calls = 0;
  const src = source(async () => { calls++; return [pdf]; });
  expect(await setInstructions('10280-1', { source: src, now: 0 })).toEqual([pdf]);
  expect(await setInstructions('10280-1', { source: src, now: 6 * 86_400_000 })).toEqual([pdf]);
  expect(calls).toBe(1);
  await setInstructions('10280-1', { source: src, now: 8 * 86_400_000 });
  expect(calls).toBe(2);
});

it('shows nothing without a key, and keeps the last list when Brickset fails or is slow', async () => {
  expect(await setInstructions('10280-1', { source: null })).toEqual([]);
  expect(await setInstructions('1-1', { source: source(async () => { throw new Error('down'); }) })).toEqual([]);
  await setInstructions('2-1', { source: source(async () => [pdf]), now: 0 });
  const slow = source(() => new Promise(() => {}));
  expect(await setInstructions('2-1', { source: slow, now: 8 * 86_400_000, timeoutMs: 10 })).toEqual([pdf]);
});
