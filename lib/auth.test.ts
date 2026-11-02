import { expect, it } from 'vitest';
import { crossSite } from './auth';

const h = (o: Record<string, string>) => new Headers(o);

it('allows same-origin browser requests and non-browser clients', () => {
  expect(crossSite(h({ host: 'brickfolio.tail1.ts.net', origin: 'https://brickfolio.tail1.ts.net', 'sec-fetch-site': 'same-origin' }))).toBe(false);
  expect(crossSite(h({ host: '127.0.0.1:3000', origin: 'http://127.0.0.1:3000' }))).toBe(false);
  expect(crossSite(h({ host: 'internal:3000', 'x-forwarded-host': 'Bricks.Example.com', origin: 'https://bricks.example.com' }))).toBe(false);
  expect(crossSite(h({ host: 'x' }))).toBe(false); // curl: no Origin, no Sec-Fetch-Site
  expect(crossSite(h({ host: 'x', 'sec-fetch-site': 'none' }))).toBe(false); // typed into the address bar
});

it('blocks requests from other sites', () => {
  expect(crossSite(h({ host: 'brickfolio.tail1.ts.net', origin: 'https://evil.example' }))).toBe(true);
  expect(crossSite(h({ host: 'brickfolio.tail1.ts.net', 'sec-fetch-site': 'cross-site' }))).toBe(true);
  expect(crossSite(h({ host: 'brickfolio.tail1.ts.net', 'sec-fetch-site': 'same-site', origin: 'https://other.tail1.ts.net' }))).toBe(true);
  expect(crossSite(h({ host: '127.0.0.1:3000', origin: 'null' }))).toBe(true); // sandboxed iframe / file://
  expect(crossSite(h({ host: '127.0.0.1:3000', origin: 'http://127.0.0.1:8080' }))).toBe(true); // other port = other origin
});
