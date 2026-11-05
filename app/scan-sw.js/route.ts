// The service worker that lets the Scan page open and work without a connection. Its scope is /scan only: the rest
// of the app always loads fresh. It keeps the page itself (network first, so it's never stale while online), the
// built scripts and styles it uses (cache first; their names change with every build), the OCR files, photos of
// items you own (/api/v1/images/, cache first, about 300 kept) and the saved barcodes (GET /api/v1/barcodes/offline). Scans and adds made offline wait on the device (components/scan/outbox.ts).
import pkg from '@/package.json';

const script = (version: string) => `
const PAGES = 'brickfolio-scan-pages-${version}';
const ASSETS = 'brickfolio-scan-assets-${version}';
const PHOTOS = 'brickfolio-scan-photos';
const PHOTO_MAX = 300;
const STATIC = (u) => u.origin === self.location.origin && (u.pathname.startsWith('/_next/static/') || u.pathname.startsWith('/ocr/'));
const PHOTO = (u) => u.origin === self.location.origin && u.pathname.startsWith('/api/v1/images/');

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(PAGES).then((c) => c.add(new Request('/scan', { credentials: 'same-origin' }))).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('brickfolio-scan-') && k !== PAGES && k !== ASSETS && k !== PHOTOS) await caches.delete(k);
    await self.clients.claim();
  })());
});

// The page sends the scripts it loaded before this worker took over, so they're cached for next time.
self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'precache' && Array.isArray(e.data.urls)) {
    e.waitUntil(caches.open(ASSETS).then((c) => Promise.all(e.data.urls.slice(0, 300).map((s) => {
      const u = new URL(s, self.location.origin);
      return STATIC(u) ? c.match(u.href).then((hit) => hit || c.add(u.href)).catch(() => {}) : null;
    }))));
  }
});

const networkFirst = async (req, cacheName, key) => {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(req);
    if (res.ok) await cache.put(key || req, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(key || req, { ignoreSearch: true });
    if (hit) return hit;
    throw err;
  }
};

// Cache first; the oldest photos go once there are more than PHOTO_MAX (keys come back in insertion order).
const photo = async (req) => {
  const c = await caches.open(PHOTOS);
  const hit = await c.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) {
    await c.put(req, res.clone());
    const keys = await c.keys();
    for (const k of keys.slice(0, Math.max(0, keys.length - PHOTO_MAX))) await c.delete(k);
  }
  return res;
};

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const u = new URL(req.url);
  if (u.origin !== self.location.origin) return;
  if (req.mode === 'navigate' && u.pathname === '/scan') return e.respondWith(networkFirst(req, PAGES, '/scan'));
  if (u.pathname === '/api/v1/barcodes/offline') return e.respondWith(networkFirst(req, PAGES));
  if (PHOTO(u)) return e.respondWith(photo(req));
  if (STATIC(u)) {
    e.respondWith(caches.open(ASSETS).then(async (c) => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) await c.put(req, res.clone());
      return res;
    }));
  }
});
`;

export function GET() {
  return new Response(script(pkg.version), { headers: { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-cache' } });
}
