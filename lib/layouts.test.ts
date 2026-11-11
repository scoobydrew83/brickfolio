import { describe, expect, it } from 'vitest';
import { fits, footprint, nextRotation, overlaps, placementError, sizeLabel } from './layouts';

const m = (x: number, y: number, w = 1, h = 1, rotation = 0) => ({ x, y, w, h, rotation });

describe('footprint', () => {
  it('keeps w and h at 0 and 180, swaps them at 90 and 270', () => {
    expect(footprint(m(1, 2, 1, 2, 0))).toEqual({ x: 1, y: 2, w: 1, h: 2 });
    expect(footprint(m(1, 2, 1, 2, 90))).toEqual({ x: 1, y: 2, w: 2, h: 1 });
    expect(footprint(m(1, 2, 1, 2, 180))).toEqual({ x: 1, y: 2, w: 1, h: 2 });
    expect(footprint(m(1, 2, 1, 2, 270))).toEqual({ x: 1, y: 2, w: 2, h: 1 });
  });
  it('a square module is the same at every rotation', () => {
    for (const r of [0, 90, 180, 270]) expect(footprint(m(0, 0, 2, 2, r))).toEqual({ x: 0, y: 0, w: 2, h: 2 });
  });
});

describe('fits', () => {
  const layout = { cols: 4, rows: 3 };
  it('accepts modules wholly inside, up to the far edge', () => {
    expect(fits(layout, m(0, 0))).toBe(true);
    expect(fits(layout, m(3, 2))).toBe(true);
    expect(fits(layout, m(2, 1, 2, 2))).toBe(true);
  });
  it('refuses anything past an edge or at a negative cell', () => {
    expect(fits(layout, m(4, 0))).toBe(false);
    expect(fits(layout, m(0, 3))).toBe(false);
    expect(fits(layout, m(-1, 0))).toBe(false);
    expect(fits(layout, m(3, 0, 2, 1))).toBe(false);
  });
  it('checks the turned footprint', () => {
    expect(fits(layout, m(0, 2, 2, 1, 0))).toBe(true);
    expect(fits(layout, m(0, 2, 2, 1, 90))).toBe(false); // now 1 wide, 2 tall: past the bottom
  });
});

describe('overlaps', () => {
  it('finds shared cells', () => {
    expect(overlaps(m(0, 0), m(0, 0))).toBe(true);
    expect(overlaps(m(0, 0, 2, 2), m(1, 1))).toBe(true);
    expect(overlaps(m(0, 0, 2, 1), m(1, 0))).toBe(true);
  });
  it('lets modules touch edge to edge and corner to corner', () => {
    expect(overlaps(m(0, 0), m(1, 0))).toBe(false);
    expect(overlaps(m(0, 0), m(0, 1))).toBe(false);
    expect(overlaps(m(0, 0), m(1, 1))).toBe(false);
    expect(overlaps(m(0, 0, 2, 1), m(2, 0))).toBe(false);
  });
  it('uses the turned footprint', () => {
    expect(overlaps(m(0, 0, 2, 1, 0), m(0, 1))).toBe(false);
    expect(overlaps(m(0, 0, 2, 1, 90), m(0, 1))).toBe(true);
  });
});

describe('placementError', () => {
  const layout = { cols: 3, rows: 3 };
  it('names what is in the way, and ignores the module being moved', () => {
    const others = [{ id: 1, name: 'Fire Station', ...m(1, 1) }];
    expect(placementError(layout, m(1, 1), others)).toMatch(/Fire Station/);
    expect(placementError(layout, m(1, 1), others, 1)).toBeNull();
    expect(placementError(layout, m(3, 0), others)).toMatch(/doesn't fit inside the 3 × 3/);
  });
});

it('turns clockwise in quarter steps', () => {
  expect([0, 90, 180, 270].map(nextRotation)).toEqual([90, 180, 270, 0]);
});

it('labels a size in modules, studs and centimetres (8 mm a stud)', () => {
  expect(sizeLabel(4, 3)).toBe('4 × 3 modules · 128 × 96 studs · 102 × 77 cm');
  expect(sizeLabel(1, 1)).toBe('1 × 1 module · 32 × 32 studs · 26 × 26 cm');
});
