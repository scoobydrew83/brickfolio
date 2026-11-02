import { expect, it } from 'vitest';
import { createRebrickable } from './client';

const BASE = 'https://rebrickable.com/api/v3';

it('sends the key, follows pages and maps sets, themes and minifigs', async () => {
  const seen: { url: string; auth: string | null }[] = [];
  const rb = createRebrickable('k123', async (input, init) => {
    const url = String(input);
    seen.push({ url: url.replace(BASE, ''), auth: new Headers(init?.headers).get('Authorization') });
    if (url.endsWith('/lego/themes/?page_size=1000')) return Response.json({ count: 3, next: `${BASE}/lego/themes/?page=2&page_size=1000`, results: [{ id: 721, parent_id: null, name: 'Icons' }] });
    if (url.includes('/lego/themes/?page=2')) return Response.json({ count: 3, next: null, results: [{ id: 722, parent_id: 721, name: 'Botanical Collection' }] });
    if (url.endsWith('/lego/sets/10280-1/')) return Response.json({ set_num: '10280-1', name: 'Flower Bouquet', year: 2021, theme_id: 722, num_parts: 756, set_img_url: 'https://cdn.rebrickable.com/media/sets/10280-1.jpg' });
    if (url.includes('/lego/sets/10497-1/minifigs/')) return Response.json({ count: 2, next: null, results: [{ quantity: 2 }, { quantity: 1 }] });
    return new Response('{"detail":"Not found."}', { status: 404 });
  }, 0);

  expect(await rb.themes()).toEqual([{ id: 721, parentId: null, name: 'Icons' }, { id: 722, parentId: 721, name: 'Botanical Collection' }]);
  expect(await rb.set('10280-1')).toEqual({ setNo: '10280-1', name: 'Flower Bouquet', year: 2021, themeId: 722, numParts: 756, imageUrl: 'https://cdn.rebrickable.com/media/sets/10280-1.jpg' });
  expect(await rb.set('99999-1')).toBeNull();
  expect(await rb.minifigCount('10497-1')).toBe(3);
  expect(await rb.minifigCount('99999-1')).toBe(0);
  expect(seen.every((s) => s.auth === 'key k123')).toBe(true);
});

it('never follows a pagination link off rebrickable.com, and reports errors', async () => {
  const urls: string[] = [];
  const rb = createRebrickable('k', async (input) => {
    urls.push(String(input));
    if (String(input).includes('/themes/')) return Response.json({ count: 2, next: 'https://evil.example/steal', results: [{ id: 1, parent_id: null, name: 'Town' }] });
    return Response.json({ detail: 'Invalid token.' }, { status: 401, statusText: 'Unauthorized' });
  }, 0);
  expect(await rb.themes()).toHaveLength(1);
  expect(urls.some((u) => u.includes('evil'))).toBe(false);
  await expect(rb.set('10280-1')).rejects.toThrow('Rebrickable: Invalid token.');
});

it('checks the key with one call and explains a refusal', async () => {
  const ok = createRebrickable('good', async () => Response.json({ count: 1, next: null, results: [] }), 0);
  await expect(ok.check!()).resolves.toBeUndefined();
  const bad = createRebrickable('bad', async () => Response.json({ detail: 'Invalid token.' }, { status: 401 }), 0);
  await expect(bad.check!()).rejects.toThrow('Rebrickable: Invalid token.');
});

it('says plainly when rebrickable.com can\'t be reached', async () => {
  const down = createRebrickable('k', async () => { throw new TypeError('fetch failed', { cause: new Error('getaddrinfo ENOTFOUND rebrickable.com') }); }, 0);
  await expect(down.check!()).rejects.toThrow("Couldn't reach rebrickable.com from the server (getaddrinfo ENOTFOUND rebrickable.com)");
});
