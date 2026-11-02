import { readFileSync } from 'node:fs';
import { afterEach, expect, it, vi } from 'vitest';
import { fetchOmrModel, modelAuthor, omrUrl } from './omr';

const fixture = readFileSync(new URL('./fixtures/test-model.ldr', import.meta.url), 'utf8');
const withAuthor = `0 FILE 8855-1.mpd\n0 Prop Plane\n0 Name: 8855-1.mpd\n0 Author: Jane Builder [jbuilder]\n${fixture}`;
const answer = (body: string, status = 200): typeof fetch => async () => new Response(body, { status });

afterEach(() => vi.unstubAllEnvs());

it('builds the OMR address with the set suffix', () => {
  expect(omrUrl('8855')).toBe('https://library.ldraw.org/library/omr/8855-1.mpd');
  expect(omrUrl('6890-1')).toBe('https://library.ldraw.org/library/omr/6890-1.mpd');
  vi.stubEnv('LDRAW_OMR_BASE', 'http://localhost:9/omr');
  expect(omrUrl('8855-1')).toBe('http://localhost:9/omr/8855-1.mpd');
});

it('fetches a model and reads its author', async () => {
  const m = await fetchOmrModel('8855', answer(withAuthor));
  expect(m).toMatchObject({ fileName: '8855-1.mpd', author: 'Jane Builder [jbuilder]' });
  expect(m?.content).toBe(withAuthor);
  expect(modelAuthor(fixture)).toBeNull();
});

it('returns null when the OMR has no model, and throws on other failures', async () => {
  expect(await fetchOmrModel('99999', answer('', 404))).toBeNull();
  await expect(fetchOmrModel('8855', answer('', 503))).rejects.toThrow(/503/);
  await expect(fetchOmrModel('8855', answer('<html>Not a model</html>'))).rejects.toThrow(/No parts/);
  await expect(fetchOmrModel('8855', async () => new Response('x', { headers: { 'content-length': '3000000' } }))).rejects.toThrow(/over 2 MB/);
});
