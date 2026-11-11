'use client';
// The layout as an SVG grid in studs (32 a module), so double modules and rotation are true to scale. Each empty cell
// and each module is a button; one of them is in the tab order at a time and the arrow keys move between them.
import { useEffect, useRef, useState } from 'react';
import { KIND_LABEL, STUDS, covers, footprint, type ModuleKind } from '@/lib/layouts';
import type { LayoutModule } from '@/lib/service/layouts';

/** Screen pixels per stud: a module is 64px, well over the 44px touch target. */
const PX = 2;
/** At most 3px a stud (96px a module) on wide screens. */
const PX_MAX = 3;
/** Road band width, in studs. */
const ROAD = 12;

type Props = {
  cols: number;
  rows: number;
  modules: LayoutModule[];
  selectedId: number | null;
  /** A module is being moved: tapping a cell puts it there. */
  moving: boolean;
  /** Pieces still to buy per module id. */
  needs: Record<number, number>;
  onCell: (x: number, y: number) => void;
  onModule: (m: LayoutModule) => void;
  /** Shift + arrow on the selected module. */
  onNudge: (dx: number, dy: number) => void;
  onRotate: () => void;
  onEscape: () => void;
};

const cellKey = (x: number, y: number) => `c${x},${y}`;
const modKey = (id: number) => `m${id}`;

export const moduleName = (m: Pick<LayoutModule, 'name' | 'kind'>) => m.name || KIND_LABEL[m.kind];

/** What a screen reader hears for a module. */
export function describeModule(m: LayoutModule, need: number | undefined) {
  const parts = [m.name || null, KIND_LABEL[m.kind].toLowerCase(), m.rotation ? `rotated ${m.rotation}°` : null];
  const f = footprint(m);
  if (f.w > 1 || f.h > 1) parts.push(`${f.w} by ${f.h} modules`);
  if (m.items.length) parts.push(`${m.items.length} ${m.items.length === 1 ? 'item' : 'items'}`);
  if (need) parts.push(`needs ${need} ${need === 1 ? 'piece' : 'pieces'}`);
  return parts.filter(Boolean).join(', ');
}

export function LayoutGrid({ cols, rows, modules, selectedId, moving, needs, onCell, onModule, onNudge, onRotate, onEscape }: Props) {
  const at = (x: number, y: number) => modules.find((m) => covers(m, x, y));
  const [focus, setFocus] = useState<string>(() => (modules[0] ? modKey(modules[0].id) : cellKey(0, 0)));
  const [focused, setFocused] = useState(false);
  const refs = useRef(new Map<string, SVGGElement>());

  // Keep the roving focus on something that exists after modules move, appear or go.
  const valid = focus.startsWith('m') ? modules.some((m) => modKey(m.id) === focus) : (() => {
    const [x, y] = focus.slice(1).split(',').map(Number);
    return x < cols && y < rows && !at(x, y);
  })();
  const first = at(0, 0);
  const current = valid ? focus
    : selectedId != null && modules.some((m) => m.id === selectedId) ? modKey(selectedId)
      : first ? modKey(first.id) : cellKey(0, 0);

  useEffect(() => {
    if (focused) refs.current.get(current)?.focus();
  }, [current, focused]);

  /** The cell the focus is on (a module's top-left). */
  const focusCell = (): [number, number] => {
    if (current.startsWith('m')) {
      const m = modules.find((x) => modKey(x.id) === current)!;
      return [m.x, m.y];
    }
    return current.slice(1).split(',').map(Number) as [number, number];
  };

  const step = (dx: number, dy: number) => {
    let [x, y] = focusCell();
    const from = current.startsWith('m') ? footprint(modules.find((m) => modKey(m.id) === current)!) : { x, y, w: 1, h: 1 };
    // Step off the far side of a wide module.
    x = dx > 0 ? from.x + from.w : dx < 0 ? from.x - 1 : x;
    y = dy > 0 ? from.y + from.h : dy < 0 ? from.y - 1 : y;
    if (x < 0 || y < 0 || x >= cols || y >= rows) return;
    const m = at(x, y);
    setFocus(m ? modKey(m.id) : cellKey(x, y));
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const arrows: Record<string, [number, number]> = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
    const a = arrows[e.key];
    if (a) {
      e.preventDefault();
      if (e.shiftKey && selectedId != null) onNudge(a[0], a[1]);
      else step(a[0], a[1]);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (current.startsWith('m')) onModule(modules.find((m) => modKey(m.id) === current)!);
      else onCell(...focusCell());
    } else if ((e.key === 'r' || e.key === 'R') && selectedId != null && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      onRotate();
    } else if (e.key === 'Escape') {
      onEscape();
    }
  };

  const W = cols * STUDS, H = rows * STUDS;
  const focusRing = (x: number, y: number, w: number, h: number) =>
    <rect x={x - 1.5} y={y - 1.5} width={w + 3} height={h + 3} rx={4} className="pointer-events-none fill-none stroke-focus" strokeWidth={2} vectorEffect="non-scaling-stroke" />;

  const cells: React.ReactNode[] = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (at(x, y)) continue;
      const k = cellKey(x, y);
      cells.push(
        <g
          key={k}
          ref={(el) => { if (el) refs.current.set(k, el); else refs.current.delete(k); }}
          role="button"
          tabIndex={k === current ? 0 : -1}
          aria-label={`Row ${y + 1}, column ${x + 1}: empty. ${moving ? 'Move the module here.' : 'Add a module.'}`}
          onClick={() => { setFocus(k); onCell(x, y); }}
          onFocus={() => { setFocus(k); setFocused(true); }}
          onBlur={() => setFocused(false)}
          className="cursor-pointer outline-none"
        >
          <rect x={x * STUDS + 1} y={y * STUDS + 1} width={STUDS - 2} height={STUDS - 2} rx={2} className={moving ? 'fill-primary-soft stroke-primary-ring' : 'fill-subtle stroke-line-strong hover:fill-muted'} strokeWidth={1} strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />
          {focused && k === current && focusRing(x * STUDS + 1, y * STUDS + 1, STUDS - 2, STUDS - 2)}
        </g>,
      );
    }
  }

  return (
    <div className="max-h-[70dvh] overflow-auto rounded-callout bg-canvas p-2 ring-1 ring-line">
      <svg
        viewBox={`-2 -2 ${W + 4} ${H + 4}`}
        width={(W + 4) * PX}
        height={(H + 4) * PX}
        // 64px a module at least (scrolls in the frame when wider), up to 96px when there's room.
        style={{ width: `clamp(${(W + 4) * PX}px, 100%, ${(W + 4) * PX_MAX}px)`, height: 'auto' }}
        role="group"
        aria-label={`Layout grid, ${cols} by ${rows} modules. Arrow keys move between squares, Enter adds or selects, Shift and an arrow moves the selected module, R rotates it.`}
        onKeyDown={onKeyDown}
        className="block max-w-none select-none"
      >
        {cells}
        {modules.map((m) => {
          const f = footprint(m);
          const x = f.x * STUDS, y = f.y * STUDS, w = f.w * STUDS, h = f.h * STUDS;
          const k = modKey(m.id);
          const selected = m.id === selectedId;
          const need = needs[m.id];
          const label = moduleName(m);
          const maxChars = Math.max(4, Math.floor((w - 6) / 3));
          return (
            <g
              key={k}
              ref={(el) => { if (el) refs.current.set(k, el); else refs.current.delete(k); }}
              role="button"
              tabIndex={k === current ? 0 : -1}
              aria-pressed={selected}
              aria-label={`Row ${f.y + 1}, column ${f.x + 1}: ${describeModule(m, need)}${selected ? ', selected' : ''}`}
              onClick={() => { setFocus(k); onModule(m); }}
              onFocus={() => { setFocus(k); setFocused(true); }}
              onBlur={() => setFocused(false)}
              className="cursor-pointer outline-none"
            >
              <rect x={x + 0.5} y={y + 0.5} width={w - 1} height={h - 1} rx={3} className="fill-surface stroke-outline" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
              <Road kind={m.kind} rotation={m.rotation} x={x + 0.5} y={y + 0.5} w={m.w * STUDS - 1} h={m.h * STUDS - 1} fw={w - 1} fh={h - 1} />
              <text x={x + 3} y={y + 8} className="fill-fg stroke-surface text-[5px] font-semibold" strokeWidth={3} paintOrder="stroke" vectorEffect="non-scaling-stroke">
                {label.length > maxChars ? `${label.slice(0, maxChars - 1)}…` : label}
              </text>
              {m.items.length > 0 && (
                <text x={x + 3} y={y + 14} className="fill-fg-3 stroke-surface text-[4.5px]" strokeWidth={3} paintOrder="stroke" vectorEffect="non-scaling-stroke">
                  {m.items.length} {m.items.length === 1 ? 'item' : 'items'}
                </text>
              )}
              {need > 0 && (
                <g aria-hidden>
                  <rect x={x + 2.5} y={y + h - 10} width={String(need).length * 3 + 6} height={7.5} rx={1.5} className="fill-warn-soft stroke-warn-ring" strokeWidth={1} vectorEffect="non-scaling-stroke" />
                  <text x={x + 5} y={y + h - 4.3} className="fill-warn text-[4.5px] font-bold tabular-nums">{need}x</text>
                </g>
              )}
              {selected && <rect x={x + 0.5} y={y + 0.5} width={w - 1} height={h - 1} rx={3} className="pointer-events-none fill-none stroke-primary" strokeWidth={3.5} vectorEffect="non-scaling-stroke" />}
              {focused && k === current && focusRing(x + 0.5, y + 0.5, w - 1, h - 1)}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/**
 * The road on a module, drawn in the module's own frame (w × h studs, road running top to bottom) and turned about the
 * centre of its footprint (fw × fh on the grid).
 */
function Road({ kind, rotation, x, y, w, h, fw, fh }: { kind: ModuleKind; rotation: number; x: number; y: number; w: number; h: number; fw: number; fh: number }) {
  if (kind === 'plain' || kind === 'custom') return null;
  const cx = w / 2, cy = h / 2, b = ROAD / 2;
  const bands: [number, number, number, number][] = [];
  const lines: string[] = [];
  const down = () => { bands.push([cx - b, 0, ROAD, h]); lines.push(`M${cx} 0V${h}`); };
  if (kind === 'road_straight') down();
  if (kind === 'road_corner') {
    bands.push([cx - b, 0, ROAD, cy + b], [cx - b, cy - b, w - cx + b, ROAD]);
    lines.push(`M${cx} 0V${cy}H${w}`);
  }
  if (kind === 'road_t') {
    down();
    bands.push([cx, cy - b, w - cx, ROAD]);
    lines.push(`M${cx + b} ${cy}H${w}`);
  }
  if (kind === 'road_cross') {
    down();
    bands.push([0, cy - b, w, ROAD]);
    lines.push(`M0 ${cy}H${cx - b}M${cx + b} ${cy}H${w}`);
  }
  const mx = x + fw / 2, my = y + fh / 2;
  return (
    <g aria-hidden transform={`rotate(${rotation} ${mx} ${my}) translate(${mx - w / 2} ${my - h / 2})`} className="pointer-events-none">
      {bands.map(([bx, by, bw, bh], i) => <rect key={i} x={bx} y={by} width={bw} height={bh} className="fill-muted" />)}
      <path d={lines.join('')} className="fill-none stroke-fg-4" strokeWidth={1} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
    </g>
  );
}
