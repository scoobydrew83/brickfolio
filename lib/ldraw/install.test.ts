import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { installLibrary, readLibrary } from './install.mjs';

const zip = readFileSync(new URL('./fixtures/complete-fixture.zip', import.meta.url));
const ok: typeof fetch = async () => new Response(zip, { headers: { 'content-length': String(zip.length) } });
const tmp = () => mkdtempSync(join(tmpdir(), 'ldraw-'));

it('downloads, unzips and installs the library, with progress', async () => {
  const dir = join(tmp(), 'ldraw');
  const phases: string[] = [];
  await installLibrary(dir, { url: 'https://example.test/complete.zip', fetchImpl: ok, onProgress: (p) => phases.push(p.phase) });
  expect(readFileSync(join(dir, 'parts', 'testbrick.dat'), 'utf8')).toContain('Test Brick');
  expect(phases).toContain('download');
  expect(phases.at(-1)).toBe('extract');
  const st = await readLibrary(dir);
  expect(st.ready).toBe(true);
  expect(st.downloadedAt).toMatch(/^\d{4}-/);
  expect(existsSync(`${dir}.download.zip`) || existsSync(`${dir}.tmp`) || existsSync(`${dir}.old`)).toBe(false);
});

it('replaces an installed library on update', async () => {
  const dir = join(tmp(), 'ldraw');
  mkdirSync(join(dir, 'parts'), { recursive: true });
  writeFileSync(join(dir, 'LDConfig.ldr'), '0 old');
  writeFileSync(join(dir, 'parts', 'old.dat'), '0 old part');
  await installLibrary(dir, { fetchImpl: ok });
  expect(existsSync(join(dir, 'parts', 'old.dat'))).toBe(false);
  expect(existsSync(join(dir, 'parts', 'testbrick.dat'))).toBe(true);
});

it('leaves a working library alone when the download fails or is not the library', async () => {
  const dir = join(tmp(), 'ldraw');
  mkdirSync(join(dir, 'parts'), { recursive: true });
  writeFileSync(join(dir, 'LDConfig.ldr'), '0 keep me');
  await expect(installLibrary(dir, { fetchImpl: async () => new Response('nope', { status: 503, statusText: 'Service Unavailable' }) }))
    .rejects.toThrow('Download failed: 503 Service Unavailable');
  await expect(installLibrary(dir, { fetchImpl: async () => new Response('not a zip') })).rejects.toThrow(/unzip/i);
  expect(readFileSync(join(dir, 'LDConfig.ldr'), 'utf8')).toBe('0 keep me');
  expect((await readLibrary(dir)).ready).toBe(true);
});

it('reports a missing library', async () => {
  expect(await readLibrary(join(tmp(), 'nothing'))).toEqual({ ready: false, downloadedAt: null });
});
