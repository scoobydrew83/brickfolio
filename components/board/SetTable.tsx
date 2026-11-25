'use client';
import Image from 'next/image';
import Link from 'next/link';
import { useMemo } from 'react';
import { Box, Pencil, Puzzle, RefreshCw, Trash2 } from 'lucide-react';
import { copiesSummary, displayNo, num, SORT_DESC_FIRST, sortFrom, sortingOf, type SetRow, type SortDir, type SortKey } from '@/lib/sets';
import { locationLabel, type RowActions } from './SetCard';
import { CONDITION_TONE, Chip, DataTable, Menu, MenuTrigger, Tip, confirmAction, useMenuHandle, type ColumnDef, type MenuHandle } from '../ui';
import type { Money } from './ui';

// A little tighter than DataTable's default, so every column fits at 1280px.
const pad = 'px-2';
const right = `${pad} text-right tabular-nums`;

/** Board's sort (#106): the column headers and the Sort select change the same state. */
export type TableSort = { sort: SortKey; dir: SortDir | ''; onSort: (next: { sort: SortKey; dir: SortDir | '' }) => void };

/** Remove after a confirmation. With several copies it removes the newest one (the same words as the card's button). */
async function askRemove(s: SetRow, onRemove: (s: SetRow) => void) {
  const ok = await confirmAction({
    title: s.qty > 1 ? `Remove one copy of ${s.name}?` : `Remove ${s.name}?`,
    body: s.qty > 1 ? `The newest copy goes, with its details and missing parts. ${s.qty - 1} left.` : 'It leaves your collection with its copies, notes and missing parts. This can’t be undone.',
    confirmLabel: s.qty > 1 ? 'Remove one' : 'Remove',
    tone: 'danger',
  });
  if (ok) onRemove(s);
}

const href = (s: SetRow) => `/sets/${encodeURIComponent(displayNo(s.setNo))}`;
// Board sorts the rows; TanStack only needs an accessor to treat a column as sortable.
const sortable = (id: SortKey) => ({ id, accessorFn: () => 0, sortDescFirst: SORT_DESC_FIRST[id] });

function setColumns(rowMenu: MenuHandle<SetRow>, money: Money): ColumnDef<SetRow>[] {
  return [
    {
      id: 'photo', header: () => <span className="sr-only">Photo</span>, enableSorting: false, meta: { label: 'Photo', className: `${pad} w-20`, cellClassName: 'py-1.5' },
      cell: ({ row: { original: s } }) => (
        <span className="flex h-10 w-14 items-center justify-center rounded-chip bg-tile">
          {s.imageUrl && <Image src={s.imageUrl} alt="" width={56} height={40} className="h-10 w-14 object-contain mix-blend-multiply" />}
        </span>
      ),
    },
    {
      ...sortable('setNo'), header: 'Set', enableHiding: false, meta: { sticky: true, className: pad, cellClassName: 'text-base font-extrabold tabular-nums [font-stretch:112%]' },
      cell: ({ row: { original: s } }) => <Link href={href(s)} className="hover:text-link">{displayNo(s.setNo)}</Link>,
    },
    {
      ...sortable('copies'), header: 'Copies', meta: { className: right },
      cell: ({ row: { original: s } }) => <Tip label={copiesSummary(s.copies)}><span className="font-bold">{s.qty}x</span></Tip>,
    },
    {
      ...sortable('name'), header: 'Name', enableHiding: false, meta: { className: pad },
      cell: ({ row: { original: s } }) => (
        <>
          <Link href={href(s)} className="font-medium hover:text-link hover:underline">{s.name}</Link>
          {s.hasModel && (
            <Tip label="Has a 3D model" describe={false}><Link href={`${href(s)}?view=3d`} aria-label="Has a 3D model: open it" className="ml-1.5 inline-flex align-[-2px] text-fg-3 hover:text-link">
              <Box aria-hidden className="size-4" />
            </Link></Tip>
          )}
          {s.blError && (
            <Tip label={s.blError}><span className="mt-0.5 block text-xs text-danger">Lookup failed: retry from the ⋯ menu</span></Tip>
          )}
        </>
      ),
    },
    { ...sortable('theme'), header: 'Theme', meta: { className: pad, cellClassName: 'text-fg-3' }, cell: ({ row: { original: s } }) => s.theme ?? '' },
    { ...sortable('location'), header: 'Location', meta: { className: pad, cellClassName: 'text-fg-2' }, cell: ({ row: { original: s } }) => s.location ?? (s.mixed.location ? locationLabel(s) : '') },
    {
      ...sortable('condition'), header: 'Condition', meta: { className: pad },
      cell: ({ row: { original: s } }) => (
        <>
          {s.condition ? <Chip tone={CONDITION_TONE[s.condition] ?? 'neutral'}>{s.condition}</Chip> : s.mixed.condition ? <Chip>Mixed</Chip> : null}
          {!!s.missingPct && <span className="ml-1.5 text-xs text-warn">{s.missingPct}% missing</span>}
        </>
      ),
    },
    { ...sortable('year'), header: 'Year', meta: { className: right }, cell: ({ row: { original: s } }) => s.year ?? '' },
    { ...sortable('pieces'), header: 'Pieces', meta: { className: right }, cell: ({ row: { original: s } }) => (s.pieces ? num(s.pieces).toLocaleString() : '') },
    { ...sortable('avgSold'), header: 'Avg sold', meta: { className: right }, cell: ({ row: { original: s } }) => money(s.avgSold) },
    {
      ...sortable('value'), header: 'Est. Value', meta: { className: right, cellClassName: 'font-bold' },
      cell: ({ row: { original: s } }) => <Tip label={s.qty > 1 ? `${money(s.estValue)} each` : undefined}><span>{money(s.valueTotal)}</span></Tip>,
    },
    {
      id: 'actions', header: () => <span className="sr-only">Actions</span>, enableSorting: false, enableHiding: false, meta: { className: 'w-12 pr-2 pl-1 text-right', cellClassName: 'py-1' },
      cell: ({ row: { original: s } }) => <MenuTrigger handle={rowMenu} payload={s} label={`Actions for ${displayNo(s.setNo)} ${s.name}`} />,
    },
  ];
}

/** The collection as one dense table: for scanning many sets at a desk. Filtering and sorting happen in Board. */
export function SetTable({ sets, onEdit, onParts, onRemove, onRetry, pending, money, canEdit, sort, dir, onSort }: { sets: SetRow[] } & RowActions & TableSort) {
  // One menu for every row (opened by each row's ⋯ button): 500 rows render 500 buttons, not 500 menus.
  const rowMenu = useMenuHandle<SetRow>();
  // Stable columns matter: TanStack renders each `cell` as a component, so new functions would remount every row.
  // So the cells take nothing that changes with each render; the actions are in the shared menu below.
  const columns = useMemo(() => setColumns(rowMenu, money), [rowMenu, money]);

  return (
    <>
      <DataTable
        label="Sets"
        columns={columns}
        data={sets}
        rowId={(s) => String(s.id)}
        pageSize={0}
        stickyFirst={false}
        stickyHeader
        columnsMenu={{ storageKey: 'set-table-columns' }}
        sorting={sortingOf(sort, dir)}
        onSortingChange={(next) => onSort(sortFrom(next, { sort, dir }))}
        empty="No sets match."
      />
      <Menu
        handle={rowMenu}
        items={(s: SetRow) => {
          const editable = canEdit?.(s) !== false;
          return [
            editable && { label: 'Edit', icon: Pencil, onSelect: () => onEdit(s) },
            { label: 'Parts list', icon: Puzzle, onSelect: () => onParts(s) },
            !!s.blError && { label: 'Retry lookup', icon: RefreshCw, onSelect: () => onRetry(s), disabled: pending },
            editable && 'separator',
            editable && { label: s.qty > 1 ? 'Remove one' : 'Remove', icon: Trash2, tone: 'danger', onSelect: () => void askRemove(s, onRemove), disabled: pending },
          ];
        }}
      />
    </>
  );
}
