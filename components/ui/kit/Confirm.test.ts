import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { confirmAction } from './Confirm';

const root = join(__dirname, '..', '..', '..');
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sources(p);
    return /\.tsx?$/.test(name) && !name.endsWith('.test.ts') ? [p] : [];
  });
}

describe('confirmations (#103)', () => {
  it("never uses the browser's confirm dialog", () => {
    // Our styled <Confirm> and confirmAction() replace it; a bare call to the global (window's included) is a regression.
    const call = new RegExp(String.raw`(^|[^\w.]|window\.)confirm` + String.raw`\(`);
    const hits = ['app', 'components'].flatMap((d) => sources(join(root, d)))
      .flatMap((f) => readFileSync(f, 'utf8').split('\n').map((line, i) => ({ f, i, line })))
      .filter(({ line }) => call.test(line))
      .map(({ f, i }) => `${f.slice(root.length + 1)}:${i + 1}`);
    expect(hits).toEqual([]);
  });

  it('confirmAction resolves false when no host is mounted, so nothing destructive runs', async () => {
    await expect(confirmAction({ title: 'Delete?', tone: 'danger' })).resolves.toBe(false);
  });
});
