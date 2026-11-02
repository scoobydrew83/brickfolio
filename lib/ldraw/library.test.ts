import { afterEach, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const { librarySource } = await import('./library');

afterEach(() => vi.unstubAllEnvs());

it('uses LDRAW_LIBRARY_URL over the default folder when both are set', () => {
  vi.stubEnv('LDRAW_LIBRARY_DIR', '/data/ldraw');
  vi.stubEnv('LDRAW_LIBRARY_URL', 'https://bucket.example/ldraw');
  expect(librarySource()).toEqual({ kind: 'url', url: 'https://bucket.example/ldraw/' });
});

it('uses the folder when no URL is set', () => {
  vi.stubEnv('LDRAW_LIBRARY_DIR', '/data/ldraw');
  vi.stubEnv('LDRAW_LIBRARY_URL', '');
  expect(librarySource()).toEqual({ kind: 'dir', dir: '/data/ldraw' });
});
