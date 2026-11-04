import { beforeEach, expect, it } from 'vitest';
import { barcodeRows, saveBarcode } from '../identifiers/barcodes';
import { openNodeDb } from '../db/node';
import type { DB } from '../db/types';
import { minifigCodes } from '../db/schema';
import { applyCommunity, communityStatus, ensureCommunity, parseCommunity, shareable, shareIssueUrl, syncCommunity } from './community';
import { resolveBarcode } from './resolve';
import { rememberBarcode } from '../service/barcodes';
import { rememberFigCode } from './figcodes';
import repoFile from './data/community.json';

let db: DB;
beforeEach(() => { db = openNodeDb(':memory:').db; });

const file = (sets: object[], minifigs: object[] = []) => ({ license: 'CC0-1.0', sets, minifigs });

// Runs in CI: a pull request that breaks the shared list fails here.
it('the community list in the repository is valid and has no disputes', () => {
  const p = parseCommunity(repoFile);
  expect(p.errors).toEqual([]);
  expect(p.conflicts).toEqual([]);
});

it('checks every entry and reports bad ones, duplicates and conflicts', () => {
  const p = parseCommunity({
    license: 'CC0-1.0',
    sets: [{ barcode: '673419264150', setNo: '75192-1' }, { barcode: '673419264151', setNo: '1-1' }, { barcode: '0673419264150', setNo: '75192-1' }, { barcode: '5702015869935', setNo: '10497' }, { barcode: '5702015869935', setNo: '10179-1' }],
    minifigs: [{ code: '6472866', factory: 'S', year: '3', name: 'Film Noir Detective', series: 'Series 25' }, { code: '647', name: 'x', series: 'y' }, { code: '6472866', factory: 'S', year: '3', name: 'Harpy', series: 'Series 25' }],
  });
  expect(p.sets.map((s) => s.setNo)).toEqual(['75192-1', '10179-1']);
  expect(p.errors).toHaveLength(4); // bad check digit, same barcode twice (as EAN), set number without suffix, short code
  expect(p.conflicts).toEqual(['6472866|S|3: Series 25 / Film Noir Detective and Series 25 / Harpy']);
  expect(parseCommunity({ sets: [] }).errors).toContain('license must be CC0-1.0');
});

it('applies the list, skips disputed codes, and drops entries removed from it', async () => {
  await applyCommunity(db, file([{ barcode: '673419264150', setNo: '75192-1' }, { barcode: '5702015869935', setNo: '10497-1' }], [{ code: '6472866', factory: 'S', year: '3', name: 'Film Noir Detective', series: 'Series 25' }]));
  expect(await resolveBarcode(db, '673419264150', { providers: [] })).toMatchObject({ status: 'matched', candidates: [{ setNo: '75192-1', source: 'community' }] });
  expect(await communityStatus(db, {})).toMatchObject({ sets: 2, minifigs: 1 });
  await applyCommunity(db, file([{ barcode: '673419264150', setNo: '75192-1' }, { barcode: '96385074', setNo: '1-1' }, { barcode: '96385074', setNo: '2-1' }]));
  const rows = await barcodeRows(db);
  expect(rows.map((r) => r.setNo)).toEqual(['75192-1']); // 10497 removed; 96385074 disputed
  expect(await db.select().from(minifigCodes).all()).toHaveLength(0);
});

it('your own confirmation beats the community list', async () => {
  await applyCommunity(db, file([{ barcode: '673419264150', setNo: '10179-1' }]));
  await rememberBarcode(db, '673419264150', '75192');
  expect(await resolveBarcode(db, '673419264150', { providers: [] })).toMatchObject({ candidates: [{ setNo: '75192-1', source: 'user' }] });
});

it('downloads from the public repository by default', async () => {
  const { DEFAULT_URL } = await import('./community');
  expect(DEFAULT_URL).toBe('https://raw.githubusercontent.com/scoobydrew83/brickfolio/main/lib/barcode/data/community.json');
});

it('downloads the list with an ETag, and falls back to the shipped copy on a first failure', async () => {
  const seen: (string | null)[] = [];
  const ok = async (_u: unknown, init?: RequestInit) => { seen.push(new Headers(init?.headers).get('if-none-match')); return Response.json(file([{ barcode: '673419264150', setNo: '75192-1' }]), { headers: { etag: '"v1"' } }); };
  expect(await syncCommunity(db, { fetchImpl: ok as typeof fetch, env: {} })).toBeNull();
  expect(await syncCommunity(db, { fetchImpl: (async () => new Response(null, { status: 304 })) as typeof fetch, env: {} })).toBeNull();
  await syncCommunity(db, { fetchImpl: ok as typeof fetch, env: {} });
  expect(seen).toEqual([null, '"v1"']);
  expect((await communityStatus(db, {})).sets).toBe(1);

  const fresh = openNodeDb(':memory:').db;
  const err = await syncCommunity(fresh, { fetchImpl: (async () => { throw new Error('offline'); }) as typeof fetch, env: {} });
  expect(err).toMatch(/offline/);
  expect((await communityStatus(fresh, {})).syncedAt).not.toBeNull(); // shipped copy applied
  expect(await syncCommunity(fresh, { env: { COMMUNITY_LIST: 'off' } })).toBeNull();

  // Not published at that address yet: no error, and a new install still starts from the shipped copy.
  const unpublished = openNodeDb(':memory:').db;
  expect(await syncCommunity(unpublished, { fetchImpl: (async () => new Response('Not Found', { status: 404 })) as typeof fetch, env: {} })).toBeNull();
  expect((await communityStatus(unpublished, {})).syncedAt).not.toBeNull();
});

it('ensureCommunity loads the shipped list once', async () => {
  await ensureCommunity(db, {});
  expect((await communityStatus(db, {})).syncedAt).not.toBeNull();
});

it('shares only your confirmed codes, with nothing else from the collection', async () => {
  await rememberBarcode(db, '673419264150', '75192');
  await saveBarcode(db, { barcode: '5702015869935', format: 'EAN_13', gtin: '5702015869935', setNo: '10497-1', source: 'comparethebricks' });
  await rememberFigCode(db, '6472866 444S3', { name: 'Film Noir Detective', series: 'Series 25', rbFigNo: 'fig-013525' });
  const f = await shareable(db);
  expect(f).toEqual({ license: 'CC0-1.0', sets: [{ barcode: '673419264150', setNo: '75192-1' }], minifigs: [{ code: '6472866', factory: 'S', year: '3', name: 'Film Noir Detective', series: 'Series 25', rbFigNo: 'fig-013525' }] });
  expect(parseCommunity(f).errors).toEqual([]); // what you share is what the list accepts
  expect(shareIssueUrl(f)).toMatch(/^https:\/\/github\.com\/scoobydrew83\/brickfolio\/issues\/new\?/);
  expect(shareIssueUrl({ ...f, sets: Array.from({ length: 300 }, () => f.sets[0]) })).toBeNull();
});
