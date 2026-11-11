import { expect, it } from 'vitest';
import { createBrickLink } from './client';

const keys = { consumerKey: 'ck', consumerSecret: 'cs', token: 't', tokenSecret: 'ts' };
const ok = (data: unknown) => Response.json({ meta: { code: 200, message: 'OK' }, data });

it('maps a set lookup like the n8n workflow did', async () => {
  const urls: string[] = [];
  const bl = createBrickLink(keys, async (input) => {
    const url = String(input);
    urls.push(url.replace('https://api.bricklink.com/api/store/v1', ''));
    if (url.includes('/price')) return ok({ avg_price: '22.8833', min_price: '16.7095', max_price: '28.0000', total_quantity: 17, unit_quantity: 9 });
    if (url.includes('/subsets')) return ok([
      { match_no: 0, entries: [{ item: { no: '3001', name: 'Brick 2 x 4', type: 'PART' }, color_id: 5, quantity: 10, extra_quantity: 1, is_alternate: false, is_counterpart: false }] },
      { match_no: 0, entries: [{ item: { no: 'col123', name: 'Gardener &amp; Friend', type: 'MINIFIG' }, quantity: 1, is_alternate: false, is_counterpart: false }] },
      { match_no: 1, entries: [{ item: { no: '3002', name: 'Brick 2 x 3', type: 'PART' }, color_id: 5, quantity: 5, is_alternate: true, is_counterpart: false }] },
    ]);
    return ok({ name: 'Flower Bouquet &#40;Botanical&#41;', year_released: 2021, category_id: 1122, image_url: '//img.bricklink.com/SL/10280-1.jpg' });
  });
  const r = await bl.lookup('10280-1', 'U', 'USD', { parts: true });
  expect(r).toEqual({
    blName: 'Flower Bouquet (Botanical)', year: 2021, categoryId: 1122, imageUrl: 'https://img.bricklink.com/SL/10280-1.jpg',
    avgSold: 22.8833, minSold: 16.7095, maxSold: 28, qtySold: 17, pieces: 11, partLots: 3,
    parts: [
      { matchNo: 0, partNo: '3001', name: 'Brick 2 x 4', type: 'PART', colorId: 5, qty: 10, extra: 1, alternate: false, counterpart: false },
      { matchNo: 0, partNo: 'col123', name: 'Gardener & Friend', type: 'MINIFIG', colorId: null, qty: 1, extra: 0, alternate: false, counterpart: false },
      { matchNo: 1, partNo: '3002', name: 'Brick 2 x 3', type: 'PART', colorId: 5, qty: 5, extra: 0, alternate: true, counterpart: false },
    ],
  });
  expect(urls).toEqual(['/items/SET/10280-1', '/items/SET/10280-1/price?guide_type=sold&new_or_used=U&currency_code=USD', '/items/SET/10280-1/subsets']);
});

it('maps store inventory and orders, and reports API errors', async () => {
  const bl = createBrickLink(keys, async (input) => {
    const url = String(input);
    if (url.endsWith('/colors')) return ok([{ color_id: 5, color_name: 'Red', color_code: 'B40000' }, { color_id: 0, color_name: '(Not Applicable)' }]);
    if (url.endsWith('/inventories')) return ok([{ inventory_id: 9, item: { no: '3001', name: 'Brick 2 x 4', type: 'PART' }, color_id: 5, color_name: 'Red', quantity: 4, new_or_used: 'N', unit_price: '0.1500', description: '', remarks: 'bin 3' }]);
    if (url.includes('direction=in')) return ok([{ order_id: 1, date_ordered: '2026-10-01T00:00:00.000Z', status: 'SHIPPED', buyer_name: 'buyer1', seller_name: 'me', total_count: 3, unique_count: 2, cost: { currency_code: 'USD', subtotal: '10.00', grand_total: '12.50' } }]);
    return Response.json({ meta: { code: 401, message: 'BAD_OAUTH_REQUEST', description: 'Invalid IP' } });
  });
  expect(await bl.store.inventory()).toEqual([{ inventoryId: 9, itemNo: '3001', name: 'Brick 2 x 4', type: 'PART', colorId: 5, colorName: 'Red', qty: 4, condition: 'N', unitPrice: 0.15, description: null, remarks: 'bin 3' }]);
  expect(await bl.store.orders('in')).toEqual([{ orderId: 1, direction: 'in', dateOrdered: '2026-10-01T00:00:00.000Z', status: 'SHIPPED', counterparty: 'buyer1', items: 3, lots: 2, currency: 'USD', subtotal: 10, grandTotal: 12.5 }]);
  await expect(bl.store.orders('out')).rejects.toThrow("BrickLink refused the access token from this server's IP address");
  expect(await bl.colors()).toEqual([{ id: 5, name: 'Red', rgb: 'B40000' }, { id: 0, name: '(Not Applicable)', rgb: null }]);
});

it('turns BrickLink errors into readable ones', async () => {
  const { brickLinkError, QUOTA_MESSAGE } = await import('./client');
  expect(brickLinkError(200, { code: 429, message: 'TOO_MANY_REQUESTS' }, '/items/SET/1-1')).toMatchObject({ kind: 'quota', message: QUOTA_MESSAGE });
  expect(brickLinkError(429, undefined, '/items/SET/1-1').kind).toBe('quota');
  expect(brickLinkError(200, { code: 401, message: 'BAD_OAUTH_REQUEST', description: 'TOKEN_IP_MISMATCHED' }, '/items/SET/1-1')).toMatchObject({ kind: 'ip' });
  expect(brickLinkError(200, { code: 401, message: 'BAD_OAUTH_REQUEST', description: 'SIGNATURE_INVALID' }, '/items/SET/1-1')).toMatchObject({ kind: 'auth', message: expect.stringContaining('BRICKLINK_*') });
  expect(brickLinkError(200, { code: 404, message: 'RESOURCE_NOT_FOUND' }, '/items/SET/99999-1')).toMatchObject({ kind: 'not_found', message: 'BrickLink has no set 99999-1 (RESOURCE_NOT_FOUND).' });
  expect(brickLinkError(500, undefined, '/items/SET/1-1/price', 'Server Error')).toMatchObject({ kind: 'other', message: 'price: Server Error (HTTP 500)' });
  expect(brickLinkError(200, { code: 400 }, '/items/SET/1-1/price').message).toBe('price: request failed (HTTP 400)');
});

it('says what came back when the reply is not API data, and why a request got no answer', async () => {
  const page = '<html><head><title>Attention Required! | Cloudflare</title></head><body><h1>Sorry, you have been blocked</h1></body></html>';
  const blocked = createBrickLink(keys, async () => new Response(page, { status: 403, headers: { 'content-type': 'text/html', 'cf-ray': 'abc' } }));
  await expect(blocked.price('SET', '1-1', 'N', 'USD')).rejects.toMatchObject({
    kind: 'other',
    message: `price: BrickLink answered HTTP 403 with a page instead of API data ("Attention Required! | Cloudflare"). BrickLink's firewall may be blocking this server's address; try again later or from another network.`,
  });
  const page2 = '<html><head><title>BrickLink</title></head><body><h2>BrickLink is temporarily unavailable</h2><p>We expect the site to remain unavailable until at least 18:00 CET / 09:00 PST on Wednesday, 11th November 2026.</p></body></html>';
  const maintenance = 'BrickLink is down for maintenance (We expect the site to remain unavailable until at least 18:00 CET / 09:00 PST on Wednesday, 11th November 2026.). Prices update at the next sync.';
  const followed = createBrickLink(keys, async () => Object.defineProperty(new Response(page2, { status: 200, headers: { 'content-type': 'text/html' } }), 'url', { value: 'https://maintenance.bricklink.com/recovery.html' }));
  await expect(followed.price('SET', '1-1', 'N', 'USD')).rejects.toMatchObject({ kind: 'maintenance', message: maintenance });
  const redirect = createBrickLink(keys, async () => new Response('<html>302 Found</html>', { status: 302, headers: { location: 'https://maintenance.bricklink.com:443/recovery.html' } }));
  await expect(redirect.price('SET', '1-1', 'N', 'USD')).rejects.toThrow('BrickLink is down for maintenance. Prices update at the next sync.');
  const limit = createBrickLink(keys, async () => new Response('<html>Too Many Requests</html>', { status: 429 }));
  await expect(limit.price('SET', '1-1', 'N', 'USD')).rejects.toMatchObject({ kind: 'quota' });
  const empty = createBrickLink(keys, async () => new Response('', { status: 200 }));
  await expect(empty.price('SET', '1-1', 'N', 'USD')).rejects.toThrow('price: BrickLink answered HTTP 200 with an empty reply.');
  const down = createBrickLink(keys, async () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND', message: 'getaddrinfo ENOTFOUND api.bricklink.com' } }); });
  await expect(down.price('SET', '1-1', 'N', 'USD')).rejects.toThrow("price: couldn't reach BrickLink (ENOTFOUND getaddrinfo ENOTFOUND api.bricklink.com).");
});

it('price: one call for one guide, and no sales is null', async () => {
  const urls: string[] = [];
  let sold = 4;
  const bl = createBrickLink(keys, async (input) => {
    urls.push(String(input).replace('https://api.bricklink.com/api/store/v1', ''));
    return ok({ avg_price: sold ? '50.5000' : '0.0000', min_price: sold ? '40.0000' : '0.0000', max_price: sold ? '60.0000' : '0.0000', total_quantity: sold });
  });
  expect(await bl.price('SET', '10280-1', 'N', 'EUR')).toEqual({ avgSold: 50.5, minSold: 40, maxSold: 60, qtySold: 4 });
  expect(urls).toEqual(['/items/SET/10280-1/price?guide_type=sold&new_or_used=N&currency_code=EUR']);
  sold = 0;
  expect(await bl.price('MINIFIG', 'sw0001', 'U', 'USD')).toEqual({ avgSold: null, minSold: null, maxSold: null, qtySold: 0 });
  expect(urls).toHaveLength(2);
});
