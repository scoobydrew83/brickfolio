import { describe, expect, it } from 'vitest';
import { parseBarcode, type Barcode } from './gtin';
import { barcodeCapabilities, createBrickEconomy, createCompareTheBricks, providerOrder, providersFromEnv, safeImage, toSetNo } from './providers';

const bc = (s: string): Barcode => { const p = parseBarcode(s); if (!p.ok) throw new Error(p.error); const { ok: _, ...b } = p; return b; };
const falcon = bc('673419264150');

describe('CompareTheBricks', () => {
  const ctbSet = { id: '75192-1', setNumber: '75192', variant: '1', name: 'Millennium Falcon', theme: 'Star Wars', year: 2017, pieceCount: 7541, image: { url: 'https://img.example/f.webp', url300: null } };

  it('looks up the 12-digit UPC with a bearer key and maps the set', async () => {
    let seen: { url: string; auth: string | null } | null = null;
    const p = createCompareTheBricks('ctb_key', { fetchImpl: async (url, init) => { seen = { url: String(url), auth: new Headers(init?.headers).get('authorization') }; return Response.json({ data: ctbSet }); } });
    const r = await p.lookup(falcon);
    expect(seen).toEqual({ url: 'https://api.comparethebricks.com/v1/sets/barcode/673419264150', auth: 'Bearer ctb_key' });
    expect(r).toEqual({ outcome: 'found', candidates: [{ setNo: '75192-1', name: 'Millennium Falcon', year: 2017, pieces: 7541, theme: 'Star Wars', imageUrl: 'https://img.example/f.webp', sourceRef: '75192-1' }] });
  });

  it('tells not found, bad key, rate limit and used-up quota apart', async () => {
    const answer = (status: number, code = '') => createCompareTheBricks('k', { fetchImpl: async () => Response.json({ error: { code } }, { status }) }).lookup(falcon);
    expect((await answer(404, 'not_found')).outcome).toBe('not_found');
    expect((await answer(401, 'invalid_api_key')).outcome).toBe('auth');
    expect((await answer(403, 'scope_required')).outcome).toBe('auth');
    expect((await answer(429, 'rate_limit_exceeded')).outcome).toBe('rate_limited');
    expect((await answer(429, 'quota_exceeded')).outcome).toBe('quota');
    expect((await answer(500)).outcome).toBe('network');
  });

  it('handles timeouts, network errors and replies it can’t read', async () => {
    const timeout = createCompareTheBricks('k', { fetchImpl: async () => { throw new DOMException('timed out', 'TimeoutError'); } });
    expect((await timeout.lookup(falcon)).outcome).toBe('timeout');
    const down = createCompareTheBricks('k', { fetchImpl: async () => { throw new TypeError('fetch failed'); } });
    expect((await down.lookup(falcon)).outcome).toBe('network');
    const junk = createCompareTheBricks('k', { fetchImpl: async () => new Response('<html>', { status: 200 }) });
    expect((await junk.lookup(falcon)).outcome).toBe('invalid_response');
    const noNumber = createCompareTheBricks('k', { fetchImpl: async () => Response.json({ data: { name: 'Mystery' } }) });
    expect((await noNumber.lookup(falcon)).outcome).toBe('invalid_response');
  });

  it('skips EAN-8 without a call', async () => {
    let calls = 0;
    const p = createCompareTheBricks('k', { fetchImpl: async () => { calls++; return Response.json({}); } });
    expect((await p.lookup(bc('96385074'))).outcome).toBe('unsupported');
    expect(calls).toBe(0);
  });

  it('drops unsafe image links and missing fields', async () => {
    const p = createCompareTheBricks('k', { fetchImpl: async () => Response.json({ data: { setNumber: '10497', name: 'Galaxy Explorer', image: { url: 'javascript:alert(1)' } } }) });
    expect(await p.lookup(falcon)).toMatchObject({ outcome: 'found', candidates: [{ setNo: '10497-1', imageUrl: null, year: null, pieces: null }] });
  });
});

describe('BrickEconomy', () => {
  it('sends the key as x-apikey and reads a list of sets', async () => {
    let seen = '';
    const p = createBrickEconomy('be_key', {
      fetchImpl: async (url, init) => {
        seen = `${url} ${new Headers(init?.headers).get('x-apikey')}`;
        return Response.json({ data: [{ set_number: '75192-1', name: 'Millennium Falcon', year: 2017, pieces_count: 7541 }, { set_number: 'bogus' }] });
      },
    });
    const r = await p.lookup(falcon);
    expect(seen).toBe('https://www.brickeconomy.com/api/v1/search/sets?barcode=673419264150 be_key');
    expect(r).toMatchObject({ outcome: 'found', candidates: [{ setNo: '75192-1', name: 'Millennium Falcon', pieces: 7541 }] });
  });

  it('reports an empty list as not found', async () => {
    const p = createBrickEconomy('k', { fetchImpl: async () => Response.json({ data: [] }) });
    expect((await p.lookup(falcon)).outcome).toBe('not_found');
  });
});

it('normalizes set numbers and image links', () => {
  expect(toSetNo('75192')).toBe('75192-1');
  expect(toSetNo('75192', 2)).toBe('75192-2');
  expect(toSetNo('75192-1')).toBe('75192-1');
  expect(toSetNo('sw0001')).toBeNull();
  expect(safeImage('https://a.example/x.png')).toBe('https://a.example/x.png');
  expect(safeImage('http://a.example/x.png')).toBeNull();
});

it('builds providers from env in the configured order, only those with keys', () => {
  expect(providersFromEnv({}).length).toBe(0);
  expect(providersFromEnv({ COMPARETHEBRICKS_API_KEY: 'a', BRICKECONOMY_API_KEY: 'b' }).map((p) => p.id)).toEqual(['comparethebricks', 'brickeconomy']);
  expect(providersFromEnv({ COMPARETHEBRICKS_API_KEY: 'a', BRICKECONOMY_API_KEY: 'b', BARCODE_PROVIDERS: 'brickeconomy, comparethebricks' }).map((p) => p.id)).toEqual(['brickeconomy', 'comparethebricks']);
  expect(providerOrder({ BARCODE_PROVIDERS: 'brickeconomy,nope' })).toEqual(['brickeconomy']);
  const caps = barcodeCapabilities({ BRICKECONOMY_API_KEY: 'b' });
  expect(caps).toEqual({ scanning: true, brickset: false, providers: [{ id: 'comparethebricks', name: 'CompareTheBricks', enabled: false }, { id: 'brickeconomy', name: 'BrickEconomy', enabled: true }] });
  expect(JSON.stringify(caps)).not.toContain('"b"'); // never the key itself
  expect(barcodeCapabilities({ BARCODE_SCANNING: 'off' }).scanning).toBe(false);
});
