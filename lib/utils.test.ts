import { describe, expect, it } from 'vitest';
import { cn } from './utils';
import { cx } from '@/components/ui';

describe('cn and cx', () => {
  it('join class names and drop falsy values', () => {
    for (const f of [cn, cx]) expect(f('a', false, null, undefined, 'b')).toBe('a b');
  });

  it('let the later of two conflicting Tailwind classes win', () => {
    for (const f of [cn, cx]) {
      expect(f('px-4 py-2', 'px-2')).toBe('py-2 px-2');
      expect(f('bg-primary', 'bg-primary-hover')).toBe('bg-primary-hover');
    }
  });

  it('keep our own token classes that do not conflict', () => {
    // text-2xs is a size and text-fg-3 a colour; rounded-control is ours and must not be dropped for rounded-md.
    expect(cx('text-2xs', 'text-fg-3')).toBe('text-2xs text-fg-3');
    expect(cx('border', 'border-line')).toBe('border border-line');
    expect(cx('rounded-control', 'shadow-raised')).toBe('rounded-control shadow-raised');
  });
});
