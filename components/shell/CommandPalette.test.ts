import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Source scans (vitest has no DOM here, and importing the palette pulls in server actions), as Confirm.test.ts does.
const read = (p: string) => readFileSync(join(__dirname, '..', '..', p), 'utf8');
const palette = read('components/shell/CommandPalette.tsx');

describe('command palette shortcuts over an overlay (#108)', () => {
  const selector = palette.match(/export const OVERLAY_OPEN = '([^']+)';/)?.[1] ?? '';
  const parts = selector.split(',').map((s) => s.trim());

  it('OVERLAY_OPEN covers an open native <dialog> and the open phone menu (sheet)', () => {
    expect(parts).toContain('dialog[open]');
    expect(parts).toContain('[data-slot="sheet-content"][data-open]');
  });

  it('the sheet popup carries the data-slot the selector looks for, and the phone menu is that sheet', () => {
    expect(read('components/ui/sheet.tsx')).toMatch(/<SheetPrimitive\.Popup\s+data-slot="sheet-content"/);
    expect(read('components/shell/MobileMenu.tsx')).toMatch(/<SheetContent\b/);
  });

  it('the keydown guard (⌘K, Ctrl+K, /) checks OVERLAY_OPEN before anything else', () => {
    const onKey = palette.slice(palette.indexOf('const onKey = (e: KeyboardEvent) => {'));
    expect(onKey.length).toBeLessThan(palette.length);
    const guard = onKey.indexOf('if (document.querySelector(OVERLAY_OPEN)) return;');
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(onKey.indexOf("e.key.toLowerCase() === 'k'"));
    expect(guard).toBeLessThan(onKey.indexOf("e.key === '/'"));
    // The old guard, which missed the sheet, is gone.
    expect(palette).not.toContain("querySelector('dialog[open]')");
  });

  it('OPEN_SEARCH (the menu\'s Search row) is not behind the guard', () => {
    expect(palette).toMatch(/const onOpen = \(\) => setOpen\(true\);/);
  });
});
