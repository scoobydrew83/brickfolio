import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(__dirname, '..', '..', '..');
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sources(p);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [p] : [];
  });
}

/**
 * Files allowed raw colours, and why. Everything else uses a token from app/globals.css (docs/design.md, "Colour").
 * A colour that means a physical colour, not a theme role, can be literal; a colour with a role gets a token.
 */
const EXCEPTIONS: Record<string, string> = {
  'components/scan/Scanner.tsx': 'a black scrim and white marks over the live camera picture, the same in every theme',
  'app/layout.tsx': "the browser's theme-color meta tag needs hex values (no CSS variables)",
  'app/badge.tsx': 'the generated app icon is an image (no CSS variables)',
  'app/manifest.ts': 'the web app manifest needs literal colours',
};

describe('colour tokens', () => {
  it('uses tokens, not raw black, white or hex colours', () => {
    const raw = /(?:^|[\s"'`:])(?:[a-z-]+:)*(?:bg|text|border|ring|outline|from|via|to|fill|stroke|shadow|decoration|divide|caret|accent)-(?:black|white)\b|#[0-9a-fA-F]{6}\b|['"`]#[0-9a-fA-F]{3}['"`]/; // a 3-digit hex only quoted, so issue numbers (#107) pass
    const hits = ['app', 'components'].flatMap((d) => sources(join(root, d)))
      .map((f) => f.slice(root.length + 1))
      .filter((f) => !(f in EXCEPTIONS))
      .flatMap((f) => readFileSync(join(root, f), 'utf8').split('\n').map((line, i) => ({ f, i, line })))
      .filter(({ line }) => raw.test(line))
      .map(({ f, i, line }) => `${f}:${i + 1}: ${line.trim().slice(0, 100)}`);
    expect(hits).toEqual([]);
  });

  it('each exception still has a raw colour to excuse', () => {
    for (const f of Object.keys(EXCEPTIONS)) expect(readFileSync(join(root, f), 'utf8'), f).toMatch(/-(?:black|white)\b|#[0-9a-fA-F]{6}\b/);
  });
});
