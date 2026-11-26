import { beforeEach, expect, it } from 'vitest';
import { openNodeDb } from '../db/node';
import type { DB } from '../db/types';
import { FxError, rateOn } from './fx';

let db: DB;
beforeEach(() => { db = openNodeDb(':memory:').db; });

it('asks frankfurter.dev for the ECB rate once per date and pair, and keeps it', async () => {
  const urls: string[] = [];
  const f = (async (url: string) => { urls.push(String(url)); return Response.json({ amount: 1, base: 'EUR', date: '2024-01-12', rates: { USD: 1.0942 } }); }) as unknown as typeof fetch;
  expect(await rateOn(db, '2024-01-13', 'EUR', 'USD', f)).toEqual({ rate: 1.0942, on: '2024-01-12' }); // a Saturday: Friday's rate
  expect(await rateOn(db, '2024-01-13', 'EUR', 'USD', f)).toEqual({ rate: 1.0942, on: '2024-01-12' });
  expect(urls).toEqual(['https://api.frankfurter.dev/v1/2024-01-13?base=EUR&symbols=USD']);
  expect(await rateOn(db, '2024-01-13', 'USD', 'USD', f)).toEqual({ rate: 1, on: '2024-01-13' });
});

it('explains currencies and dates it has no rate for, and a service that fails', async () => {
  const never = (async () => { throw new Error('should not be called'); }) as unknown as typeof fetch;
  await expect(rateOn(db, '2024-01-13', 'ARS', 'USD', never)).rejects.toThrow(/No exchange rate for ARS/);
  await expect(rateOn(db, '1998-12-31', 'EUR', 'USD', never)).rejects.toThrow(/start on 1999-01-04/);
  const down = (async () => new Response('', { status: 502 })) as unknown as typeof fetch;
  await expect(rateOn(db, '2024-01-13', 'EUR', 'USD', down)).rejects.toThrow(FxError);
  await expect(rateOn(db, '2024-01-13', 'EUR', 'USD', down)).rejects.toThrow(/enter the price in your collection currency/);
});

it('asks for today when the date is in the future', async () => {
  const urls: string[] = [];
  const f = (async (url: string) => { urls.push(String(url)); return Response.json({ date: '2024-01-12', rates: { USD: 1.1 } }); }) as unknown as typeof fetch;
  await rateOn(db, '2999-01-01', 'EUR', 'USD', f);
  expect(urls[0]).toContain(`/v1/${new Date().toISOString().slice(0, 10)}?`);
});
