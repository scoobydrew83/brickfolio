import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Base UI's Portal treats `container={null}` as "render nowhere" (undefined means <body>). Our kit components look up
// the native <dialog> they sit in (`closest('dialog') ?? null`), so outside a dialog they must pass `?? undefined`, or
// the popup opens (aria-expanded="true") but never appears. That shipped once (#105, found in #120): the date picker and
// the searchable dropdowns did nothing on the scan page, the loose-parts filter, the share page and Settings.
describe('kit popups render outside dialogs too', () => {
  it('never passes a possibly-null container to a portal', () => {
    const dir = __dirname;
    const hits = readdirSync(dir)
      .filter((f) => f.endsWith('.tsx'))
      .flatMap((f) => readFileSync(join(dir, f), 'utf8').split('\n').map((line, i) => ({ f, i, line })))
      .filter(({ line }) => /<\w+Content\b[^>]*container=\{container\}/.test(line)) // a Base UI popup's own Portal prop
      .map(({ f, i }) => `${f}:${i + 1}`);
    expect(hits).toEqual([]);
  });
});
