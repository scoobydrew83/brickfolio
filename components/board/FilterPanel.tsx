'use client';
// The Sets page's filters. Each group (Location, Condition, Theme, Availability, Status) takes several values: a set
// matches any value in a group and every group that has one. Phones get one Filters button that opens a sheet from the
// bottom with every group, wrapped; from 640px the groups sit inline, wrapped. Both show the active filters as
// removable chips with Clear all.
import { SlidersHorizontal, X } from 'lucide-react';
import { useState } from 'react';
import type { Facet } from '@/lib/sets';
import { Sheet, SheetClose, SheetContent, SheetTitle, SheetTrigger } from '../ui/sheet';
import { Button, FilterChip, buttonClass } from '../ui';

export type FilterOption = { value: string; label: string; detail?: React.ReactNode };
/** A row of chips. A facet's chips toggle that facet; `onPick` rows (Collection) act instead and are never active. */
export type FilterGroup = { key: Facet | 'collection'; label: string; options: FilterOption[]; onPick?: (value: string) => void };
type Selected = Partial<Record<Facet, string[]>>;

type Props = {
  groups: FilterGroup[];
  selected: Selected;
  onToggle: (key: Facet, value: string) => void;
  onClear: () => void;
  /** Sets shown with the current filters, for the sheet's Show button. */
  shown: number;
};

const isActive = (selected: Selected, g: FilterGroup, v: string) => g.key !== 'collection' && !!selected[g.key]?.includes(v);

function Groups({ groups, selected, onToggle, stacked }: Pick<Props, 'groups' | 'selected' | 'onToggle'> & { stacked?: boolean }) {
  return groups.map((g) => (
    <div key={g.key} role="group" aria-label={g.label} className={stacked ? 'space-y-2' : 'flex items-start gap-2'}>
      <span className={stacked ? 'block text-sm font-semibold text-fg' : 'w-24 shrink-0 pt-1 text-sm text-fg-3'}>{g.label}</span>
      <div className="flex min-w-0 flex-1 flex-wrap gap-2">
        {g.options.map((o) => (
          <FilterChip key={o.value} active={isActive(selected, g, o.value)} onClick={() => (g.onPick ? g.onPick(o.value) : onToggle(g.key as Facet, o.value))}>
            {o.label}{o.detail}
          </FilterChip>
        ))}
      </div>
    </div>
  ));
}

/** "Theme: Harry Potter ×" for each chosen value, then Clear all. Nothing when no filter is on. */
function ActiveFilters({ groups, selected, onToggle, onClear }: Omit<Props, 'shown'>) {
  const active = groups.flatMap((g) => (g.key === 'collection' ? [] : (selected[g.key] ?? []).map((v) => ({ g, v, label: g.options.find((o) => o.value === v)?.label ?? v }))));
  if (!active.length) return null;
  return (
    <ul aria-label="Active filters" className="flex flex-wrap items-center gap-2">
      {active.map(({ g, v, label }) => (
        <li key={`${g.key}:${v}`}>
          <button
            type="button"
            onClick={() => onToggle(g.key as Facet, v)}
            aria-label={`Remove filter ${g.label}: ${label}`}
            className="inline-flex items-center gap-1 rounded-callout bg-primary px-3 py-1 text-sm font-medium text-on-primary ring-1 ring-primary-ring"
          >
            <span className="font-normal">{g.label}:</span> {label}
            <X aria-hidden className="size-3.5" />
          </button>
        </li>
      ))}
      <li><Button variant="link" onClick={onClear}>Clear all</Button></li>
    </ul>
  );
}

export function FilterPanel({ groups, selected, onToggle, onClear, shown }: Props) {
  const [open, setOpen] = useState(false);
  const count = groups.reduce((n, g) => n + (g.key === 'collection' ? 0 : (selected[g.key]?.length ?? 0)), 0);
  if (!groups.length) return null;
  return (
    <section aria-label="Filters" className="space-y-3 text-sm">
      {/* Phones: one button, the groups in a sheet from the bottom. */}
      <div className="sm:hidden">
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger className={buttonClass()}>
            <SlidersHorizontal aria-hidden className="size-4" />
            <span className="ml-2">Filters{count ? ` (${count})` : ''}</span>
          </SheetTrigger>
          <SheetContent
            side="bottom"
            showCloseButton={false}
            className="max-h-[85dvh] gap-0 rounded-t-card p-0 sm:hidden"
          >
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <SheetTitle>Filters{count ? ` (${count})` : ''}</SheetTitle>
              <SheetClose aria-label="Close filters" className="-mr-2 rounded-control p-2 text-fg-3 hover:bg-muted hover:text-fg">
                <X aria-hidden className="size-5" />
              </SheetClose>
            </div>
            <div className="space-y-5 overflow-y-auto px-4 py-4">
              <Groups groups={groups} selected={selected} onToggle={onToggle} stacked />
            </div>
            <div className="flex items-center justify-between gap-3 border-t border-line px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
              <Button variant="link" onClick={onClear} disabled={!count}>Clear all</Button>
              <Button variant="primary" onClick={() => setOpen(false)}>Show {shown} set{shown === 1 ? '' : 's'}</Button>
            </div>
          </SheetContent>
        </Sheet>
      </div>
      {/* From 640px: the groups inline, wrapped. */}
      <div className="hidden space-y-2 sm:block">
        <Groups groups={groups} selected={selected} onToggle={onToggle} />
      </div>
      <ActiveFilters groups={groups} selected={selected} onToggle={onToggle} onClear={onClear} />
    </section>
  );
}
