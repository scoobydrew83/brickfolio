import { beforeEach, expect, it } from 'vitest';
import { openNodeDb } from '../db/node';
import type { DB } from '../db/types';
import { identifiers } from '../db/schema';
import { CHUNK, elementKey, normalize, remember, resolve, resolveMany, toScheme } from './resolve';

let db: DB;
beforeEach(() => { db = openNodeDb(':memory:').db; });

it('normalises each kind of ID', () => {
  expect(normalize('set', 'gtin', '673419264150')).toBe('0673419264150'); // UPC-A in lookup form
  expect(normalize('set', 'gtin', '673419264151')).toBeNull(); // bad check digit
  expect(normalize('set', 'lego', ' 75192 ')).toBe('75192-1');
  expect(normalize('set', 'bricklink', '10280-2')).toBe('10280-2');
  expect(normalize('set', 'brickset', '26725')).toBe('26725'); // Brickset's own id has no suffix
  expect(normalize('part', 'rebrickable', '3069BPR0001')).toBe('3069bpr0001');
  expect(normalize('part', 'ldraw', '3001.dat')).toBe('3001');
  expect(normalize('minifig', 'bricklink', 'SW0001')).toBe('sw0001');
  expect(normalize('color', 'rebrickable', '04')).toBe('4');
  expect(normalize('color', 'rebrickable', 'red')).toBeNull();
  expect(normalize('element', 'lego_element', '300121')).toBe('300121');
  expect(normalize('element', 'lego_element', '3001-21')).toBeNull();
  expect(normalize('element', 'bricklink', '3001:05')).toBe('3001:5');
  expect(normalize('element', 'bricklink', '3001')).toBeNull();
  expect(normalize('part', 'rebrickable', '')).toBeNull();
  expect(normalize('part', 'rebrickable', 'x'.repeat(65))).toBeNull();
});

it('resolves by trust: confirmed rows win, then yours, the community list, Brickset and the rest', async () => {
  await remember(db, [
    { kind: 'set', scheme: 'gtin', value: '673419264150', canonical: '10179-1', source: 'comparethebricks' },
    { kind: 'set', scheme: 'gtin', value: '673419264150', canonical: '75192-1', source: 'brickset' },
  ]);
  expect(await resolve(db, 'set', 'gtin', '0673419264150')).toMatchObject({ canonical: null, candidates: [{ canonical: '10179-1' }, { canonical: '75192-1' }] }); // ambiguous
  await remember(db, [{ kind: 'set', scheme: 'gtin', value: '673419264150', canonical: '75192-1', source: 'user', verified: true }]);
  expect(await resolve(db, 'set', 'gtin', '673419264150')).toMatchObject({ canonical: '75192-1', candidates: [{ canonical: '75192-1', source: 'user', verified: true }] });

  // Unconfirmed: the best source for each set is the one shown.
  await remember(db, [
    { kind: 'set', scheme: 'gtin', value: '5702015869935', canonical: '10497-1', source: 'brickeconomy' },
    { kind: 'set', scheme: 'gtin', value: '5702015869935', canonical: '10497-1', source: 'community' },
  ]);
  expect((await resolve(db, 'set', 'gtin', '5702015869935')).candidates).toMatchObject([{ canonical: '10497-1', source: 'community', verified: false }]);
  expect(await resolve(db, 'set', 'gtin', '96385074')).toEqual({ canonical: null, candidates: [] });
});

it('handles many-to-many parts', async () => {
  // BrickLink merges two molds Rebrickable keeps apart; one Rebrickable part can also list two BrickLink numbers.
  await remember(db, [
    { kind: 'part', scheme: 'rebrickable', value: '3062a', canonical: '3062', source: 'rebrickable' },
    { kind: 'part', scheme: 'rebrickable', value: '3062b', canonical: '3062', source: 'rebrickable' },
    { kind: 'part', scheme: 'rebrickable', value: '970c00', canonical: '970c00', source: 'rebrickable' },
    { kind: 'part', scheme: 'rebrickable', value: '970c00', canonical: '970', source: 'rebrickable' },
  ]);
  expect((await resolve(db, 'part', 'rebrickable', '3062A')).canonical).toBe('3062');
  expect((await resolve(db, 'part', 'rebrickable', '3062b')).canonical).toBe('3062');
  expect(await resolve(db, 'part', 'rebrickable', '970c00')).toMatchObject({ canonical: null, candidates: [{ canonical: '970c00' }, { canonical: '970' }] });
  expect(await toScheme(db, 'part', '3062', 'rebrickable')).toEqual(['3062a', '3062b']);
  expect(await toScheme(db, 'part', '3062', 'bricklink')).toEqual(['3062']);
});

it('keys elements by BrickLink part and colour', async () => {
  expect(elementKey('3001', 5)).toBe('3001:5');
  await remember(db, [{ kind: 'element', scheme: 'lego_element', value: '300121', canonical: '3001:05', source: 'rebrickable' }]);
  expect((await resolve(db, 'element', 'lego_element', '300121')).canonical).toBe('3001:5');
  expect(await toScheme(db, 'element', '3001:5', 'lego_element')).toEqual(['300121']);
  // An element with a bad canonical isn't saved.
  expect(await remember(db, [{ kind: 'element', scheme: 'lego_element', value: '300122', canonical: '3001', source: 'rebrickable' }])).toBe(0);
});

it('resolves LEGO set numbers and BrickLink IDs by rule, without a row', async () => {
  expect(await resolve(db, 'set', 'lego', '75192')).toMatchObject({ canonical: '75192-1', candidates: [{ id: null }] });
  expect((await resolve(db, 'minifig', 'bricklink', 'SW0001')).canonical).toBe('sw0001');
  expect(await toScheme(db, 'set', '75192-1', 'lego')).toEqual(['75192']);
  expect(await db.select().from(identifiers).all()).toHaveLength(0);
});

it('remembers a mapping once, and a later confirmation sticks', async () => {
  const m = { kind: 'minifig', scheme: 'rebrickable', value: 'fig-000123', canonical: 'sw0001', source: 'user' } as const;
  await remember(db, [m, m]);
  const [first] = await db.select().from(identifiers).all();
  await remember(db, [{ ...m, verified: true, sourceRef: 'r1' }]);
  await remember(db, [m]); // seen again unconfirmed: stays confirmed
  const rows = await db.select().from(identifiers).all();
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ verified: true, sourceRef: 'r1', firstSeenAt: first.firstSeenAt });
  expect(rows[0].verifiedAt).not.toBeNull();
  expect(rows[0].lastSeenAt >= first.lastSeenAt).toBe(true);
});

it('resolves many values in chunks small enough for D1', async () => {
  const n = 250;
  expect(await remember(db, Array.from({ length: n }, (_, i) => ({ kind: 'part' as const, scheme: 'rebrickable' as const, value: `rb${i}`, canonical: `bl${i}`, source: 'rebrickable' as const })))).toBe(n);
  expect(n).toBeGreaterThan(CHUNK * 2);
  const values = [...Array.from({ length: n }, (_, i) => `RB${i}`), 'unknown', ''];
  const r = await resolveMany(db, 'part', 'rebrickable', values);
  expect(r.size).toBe(n + 2);
  expect(r.get('RB0')?.canonical).toBe('bl0');
  expect(r.get(`RB${n - 1}`)?.canonical).toBe(`bl${n - 1}`);
  expect(r.get('unknown')).toEqual({ canonical: null, candidates: [] });
  expect(r.get('')).toEqual({ canonical: null, candidates: [] });
  expect((await resolveMany(db, 'set', 'lego', ['10280'])).get('10280')?.canonical).toBe('10280-1');
});
