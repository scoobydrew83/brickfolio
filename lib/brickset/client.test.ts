import { expect, it } from 'vitest';
import { createBrickset, toBsSet, type ApiSet } from './client';

const galaxy: ApiSet = {
  number: '10497', numberVariant: 1, availability: 'Retail', launchDate: '2022-08-01T00:00:00Z', exitDate: '2026-12-31T00:00:00Z',
  LEGOCom: { US: { retailPrice: 99.99, dateFirstAvailable: '2022-08-01T00:00:00Z' }, UK: { retailPrice: 89.99 }, DE: { retailPrice: 99.99 } },
};
const castle: ApiSet = { number: '6080', numberVariant: 1, availability: 'Retired', LEGOCom: {} };
const reply = (sets: ApiSet[]) => Response.json({ status: 'success', matches: sets.length, sets });
const params = (url: string) => JSON.parse(new URL(url).searchParams.get('params') ?? '{}');

it('maps retail prices by currency, dates, and retirement', () => {
  expect(toBsSet(galaxy, '2026-11-02')).toEqual({ setNo: '10497-1', retail: { USD: 99.99, GBP: 89.99, EUR: 99.99 }, launchDate: '2022-08-01', exitDate: '2026-12-31', retired: false, ean: null, upc: null });
  expect(toBsSet(galaxy, '2027-01-05').retired).toBe(true); // past its exit date
  expect(toBsSet(castle).retired).toBe(true);
  expect(toBsSet({ ...castle, barcode: { EAN: '5702015869935', UPC: ' 673419264150 ' } })).toMatchObject({ ean: '5702015869935', upc: '673419264150' });
  expect(toBsSet({ ...castle, barcode: { EAN: 'n/a', UPC: '' } })).toMatchObject({ ean: null, upc: null });
  expect(toBsSet({ number: '1', LEGOCom: { US: { retailPrice: 5, dateLastAvailable: '2020-06-30T00:00:00Z' } } }, '2026-01-01')).toMatchObject({ exitDate: '2020-06-30', retired: true });
});

it('asks for sets in batches of 50 and stays within the call budget', async () => {
  const urls: string[] = [];
  const bs = createBrickset('key', async (url) => { urls.push(String(url)); return reply([galaxy]); });
  const numbers = Array.from({ length: 120 }, (_, i) => `${i + 1}-1`);
  const r = await bs.sets(numbers, { maxCalls: 2 });
  expect(urls).toHaveLength(2);
  expect(params(urls[0]).setNumber.split(',')).toHaveLength(50);
  expect(new URL(urls[0]).searchParams.get('apiKey')).toBe('key');
  expect(r.asked).toHaveLength(100); // the last 20 wait for the next sync
  expect(r.found.map((s) => s.setNo)).toEqual(['10497-1', '10497-1']);
});

it('falls back to one set per call when Brickset ignores a list', async () => {
  const bs = createBrickset('key', async (url) => {
    const n = params(String(url)).setNumber as string;
    if (n.includes(',')) return reply([]);
    return reply(n === '10497-1' ? [galaxy] : n === '6080-1' ? [castle] : []);
  });
  const r = await bs.sets(['10497-1', '6080-1', '99999-1']);
  expect(r.found.map((s) => s.setNo)).toEqual(['10497-1', '6080-1']);
  expect(r.asked).toEqual(['10497-1', '6080-1', '99999-1']);
});

it('reports Brickset errors and an unreachable server plainly', async () => {
  const limit = createBrickset('key', async () => Response.json({ status: 'error', message: 'Daily API limit exceeded' }));
  await expect(limit.sets(['10497-1'])).rejects.toThrow('Brickset: Daily API limit exceeded');
  const bad = createBrickset('bad', async () => Response.json({ status: 'error', message: 'Invalid API key' }));
  await expect(bad.check()).rejects.toThrow('Brickset: Invalid API key');
  const down = createBrickset('key', async () => { throw new TypeError('fetch failed', { cause: new Error('getaddrinfo ENOTFOUND brickset.com') }); });
  await expect(down.check()).rejects.toThrow("Couldn't reach brickset.com from the server (getaddrinfo ENOTFOUND brickset.com)");
});
