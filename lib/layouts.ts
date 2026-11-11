// MILS layouts: pure grid maths shared by the service and the grid editor, so the editor can refuse a bad move at once.
// A layout is cols × rows modules of 32 × 32 studs. A module covers w × h cells from its top-left (x, y); turned 90° or
// 270° it covers h × w.

export const MODULE_KINDS = ['plain', 'road_straight', 'road_corner', 'road_t', 'road_cross', 'custom'] as const;
export type ModuleKind = (typeof MODULE_KINDS)[number];

export const KIND_LABEL: Record<ModuleKind, string> = {
  plain: 'Plain', road_straight: 'Straight road', road_corner: 'Road corner', road_t: 'T-junction', road_cross: 'Crossing', custom: 'Custom',
};

export const ROTATIONS = [0, 90, 180, 270] as const;
export type Rotation = (typeof ROTATIONS)[number];

/** Grid size limits, in modules. */
export const MAX_CELLS = 24;
/** Module size limits, in modules (2 = a double module). */
export const MAX_MODULE = 2;

/** Studs per module side, and millimetres per stud. */
export const STUDS = 32;
export const MM_PER_STUD = 8;

export type Placement = { x: number; y: number; w: number; h: number; rotation: number };
export type Rect = { x: number; y: number; w: number; h: number };

/** The cells a module covers: its top-left corner, with w and h swapped when turned a quarter. */
export function footprint(m: Placement): Rect {
  const turned = m.rotation === 90 || m.rotation === 270;
  return { x: m.x, y: m.y, w: turned ? m.h : m.w, h: turned ? m.w : m.h };
}

/** Whether a module lies wholly inside the layout. */
export function fits(layout: { cols: number; rows: number }, m: Placement): boolean {
  const f = footprint(m);
  return f.x >= 0 && f.y >= 0 && f.x + f.w <= layout.cols && f.y + f.h <= layout.rows;
}

/** Whether two modules share a cell. Touching edges don't overlap. */
export function overlaps(a: Placement, b: Placement): boolean {
  const p = footprint(a), q = footprint(b);
  return p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h;
}

/** Whether a cell is inside a module's footprint. */
export function covers(m: Placement, x: number, y: number): boolean {
  const f = footprint(m);
  return x >= f.x && x < f.x + f.w && y >= f.y && y < f.y + f.h;
}

/** Why a module can't go where it's asked (outside the layout, or on another module), or null when it can. */
export function placementError<M extends Placement & { id?: number; name?: string | null }>(
  layout: { cols: number; rows: number }, m: Placement, others: readonly M[], ignoreId?: number,
): string | null {
  if (!fits(layout, m)) return `That doesn't fit inside the ${layout.cols} × ${layout.rows} layout.`;
  const hit = others.find((o) => o.id !== ignoreId && overlaps(m, o));
  if (hit) return `That overlaps ${hit.name ? hit.name : `the module at row ${hit.y + 1}, column ${hit.x + 1}`}.`;
  return null;
}

/** The next rotation clockwise. */
export const nextRotation = (r: number): Rotation => (((r + 90) % 360) as Rotation);

/** "4 × 3 modules · 128 × 96 studs · 102 × 77 cm". */
export function sizeLabel(cols: number, rows: number): string {
  const cm = (n: number) => Math.round((n * STUDS * MM_PER_STUD) / 10);
  return `${cols} × ${rows} ${cols * rows === 1 ? 'module' : 'modules'} · ${cols * STUDS} × ${rows * STUDS} studs · ${cm(cols)} × ${cm(rows)} cm`;
}
