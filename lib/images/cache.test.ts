import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { diskStore, r2Store, validKey } from './cache';

vi.mock('server-only', () => ({}));

let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'bf-img-')); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

const bytes = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer;
const text = (b: ArrayBuffer) => new TextDecoder().decode(b);

it('accepts only well-formed keys', () => {
  expect(validKey('set/10280-1/0123456789ab')).toBe(true);
  expect(validKey('minifig/fig-000123/0123456789ab')).toBe(true);
  expect(validKey('set/../0123456789ab')).toBe(false);
  expect(validKey('../x')).toBe(false);
  expect(validKey('set/a/b/0123456789ab')).toBe(false);
  expect(validKey('part/3001/0123456789ab')).toBe(false);
  expect(validKey('set/.hidden/0123456789ab')).toBe(false);
});

it('disk: put, get, stats and clear', async () => {
  const s = diskStore(dir);
  expect(await s.get('set/10280-1/0123456789ab')).toBeNull();
  await s.put('set/10280-1/0123456789ab', bytes('png!'), 'image/png');
  await s.put('minifig/sw0001/abcdefabcdef', bytes('jpeg'), 'image/jpeg');
  const got = await s.get('set/10280-1/0123456789ab');
  expect(got && { body: text(got.body), type: got.type }).toEqual({ body: 'png!', type: 'image/png' });
  expect(await s.stats()).toEqual({ count: 2, bytes: 8 });
  await writeFile(join(dir, 'keep.txt'), 'not ours');
  await s.clear();
  expect(await s.stats()).toEqual({ count: 0, bytes: 0 });
  expect(await readdir(dir)).toEqual(['keep.txt']); // only removes what it wrote
});

it('disk: refuses keys that leave the folder', async () => {
  const s = diskStore(dir);
  await expect(s.put('../x', bytes('x'), 'image/png')).rejects.toThrow();
  expect(await s.get('../../etc/passwd')).toBeNull();
});

it('disk: stats on a folder that does not exist yet', async () => {
  expect(await diskStore(join(dir, 'missing')).stats()).toEqual({ count: 0, bytes: 0 });
});

it('r2: put, get, stats and clear over paged listings', async () => {
  const m = new Map<string, { body: ArrayBuffer; type: string }>();
  const bucket = {
    get: async (k: string) => { const o = m.get(k); return o ? { arrayBuffer: async () => o.body, httpMetadata: { contentType: o.type } } : null; },
    put: async (k: string, body: ArrayBuffer, o: { httpMetadata: { contentType: string } }) => { m.set(k, { body, type: o.httpMetadata.contentType }); },
    list: async ({ prefix = '', cursor }: { prefix?: string; cursor?: string }) => {
      const all = [...m.keys()].filter((k) => k.startsWith(prefix)).sort();
      const start = cursor ? Number(cursor) : 0;
      const page = all.slice(start, start + 2);
      return { objects: page.map((key) => ({ key, size: m.get(key)!.body.byteLength })), truncated: start + 2 < all.length, cursor: String(start + 2) };
    },
    delete: async (keys: string[]) => { for (const k of keys) m.delete(k); },
  };
  const s = r2Store(bucket);
  for (const n of ['1', '2', '3']) await s.put(`set/${n}-1/0123456789ab`, bytes('ab'), 'image/png');
  expect((await s.get('set/1-1/0123456789ab'))?.type).toBe('image/png');
  expect(await s.stats()).toEqual({ count: 3, bytes: 6 });
  await s.clear();
  expect(m.size).toBe(0);
});
