'use client';
// A table with search, sorting and paging (#102), from shadcn's data-table pattern: TanStack Table for the state,
// ./table for the markup. Generic so any list can use it (People now, the set table next).
//
// - Columns are TanStack `ColumnDef`s. A column whose `header` is a string sorts when you click it (unless
//   `enableSorting: false`); `meta.className` styles its cells.
// - `search` filters rows with `searchText(row)` (default: every string value), case-insensitive.
// - Phones: it scrolls sideways inside its frame with the first column pinned (`stickyFirst`), or any column with
//   `meta.sticky` (it scrolls normally until it reaches the left edge, then stays).
// - `sorting` + `onSortingChange` make sorting controlled (#106): the caller sorts `data` and owns the state, and a
//   header click asks it to change (columns' `sortDescFirst` picks the first direction). Otherwise the table sorts.
// - `columnsMenu` adds a Columns menu to hide columns, remembered per browser (`./data-table-state`).
// - `stickyHeader`: the table scrolls in a frame as tall as the screen, with the header row fixed.
import { useState } from 'react';
import { flexRender, getCoreRowModel, getFilteredRowModel, getPaginationRowModel, getSortedRowModel, useReactTable, type ColumnDef, type SortingState, type Updater } from '@tanstack/react-table';
import { ArrowDown, ArrowUp, ArrowUpDown, Columns3 } from 'lucide-react';
import { Button, SearchInput, cx } from './kit/primitives';
import { Menu } from './kit/Menu';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './table';
import { useStoredVisibility } from './data-table-state';

export type { ColumnDef, SortingState } from '@tanstack/react-table';
/**
 * Per-column extras: `className` for its header and cells (widths, alignment), `cellClassName` for its cells only
 * (type); `label` names it in the Columns menu when its header isn't a string; `sticky` pins it to the left edge when
 * scrolling sideways.
 */
export type DataTableMeta = { className?: string; cellClassName?: string; label?: string; sticky?: boolean };

type Props<T> = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TanStack's ColumnDef needs `any` for mixed value types
  columns: ColumnDef<T, any>[];
  data: T[];
  /** A stable id per row (keeps state across refreshes). */
  rowId: (row: T) => string;
  /** The table's accessible name. */
  label: string;
  search?: { placeholder: string; text?: (row: T) => string };
  initialSort?: SortingState;
  pageSize?: number;
  /** Shown instead of rows when there are none (after searching too). */
  empty?: React.ReactNode;
  stickyFirst?: boolean;
  /** Extra controls on the search row (e.g. an Add button). */
  toolbar?: React.ReactNode;
  /** Controlled sorting: the caller sorts `data` to match. */
  sorting?: SortingState;
  onSortingChange?: (next: SortingState) => void;
  /** A Columns menu for hiding columns, saved in this browser under `storageKey`. Columns with `enableHiding: false` stay. */
  columnsMenu?: { storageKey: string };
  stickyHeader?: boolean;
};

const allText = (row: unknown) => Object.values(row as Record<string, unknown>).filter((v) => typeof v === 'string').join(' ');

export function DataTable<T>({ columns, data, rowId, label, search, initialSort = [], pageSize = 20, empty = 'Nothing here.', stickyFirst = true, toolbar, sorting: sortingProp, onSortingChange, columnsMenu, stickyHeader }: Props<T>) {
  const [ownSorting, setOwnSorting] = useState<SortingState>(initialSort);
  const controlled = sortingProp !== undefined;
  const sorting = controlled ? sortingProp : ownSorting;
  const setSorting = (u: Updater<SortingState>) => {
    const next = typeof u === 'function' ? u(sorting) : u;
    if (controlled) onSortingChange?.(next);
    else setOwnSorting(next);
  };
  const [filter, setFilter] = useState('');
  const paged = pageSize > 0;
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: paged ? pageSize : Number.MAX_SAFE_INTEGER });
  const text = search?.text ?? allText;
  const colId = (c: ColumnDef<T>) => c.id ?? ('accessorKey' in c ? String(c.accessorKey) : '');
  const nameOf = (c: ColumnDef<T>) => (c.meta as DataTableMeta | undefined)?.label ?? (typeof c.header === 'string' ? c.header : colId(c));
  const hideable = columnsMenu ? columns.filter((c) => c.enableHiding !== false).map(colId) : [];
  const [visibility, setVisibility] = useStoredVisibility(columnsMenu?.storageKey, hideable);
  // TanStack Table returns new functions every render, which the React Compiler can't memoize; that's expected here.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data, columns, getRowId: rowId,
    state: { sorting, globalFilter: filter, pagination, columnVisibility: visibility },
    onSortingChange: setSorting, onGlobalFilterChange: setFilter, onPaginationChange: setPagination,
    onColumnVisibilityChange: (u) => setVisibility(typeof u === 'function' ? u(visibility) : u),
    manualSorting: controlled, enableSortingRemoval: !controlled,
    globalFilterFn: (row, _id, value: string) => text(row.original).toLowerCase().includes(value.trim().toLowerCase()),
    getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel(), getFilteredRowModel: getFilteredRowModel(),
    ...(paged ? { getPaginationRowModel: getPaginationRowModel() } : {}),
    autoResetPageIndex: true,
  });
  const rows = table.getRowModel().rows;
  const total = table.getFilteredRowModel().rows.length;
  const { pageIndex } = table.getState().pagination;
  const first = total ? pageIndex * pagination.pageSize + 1 : 0;
  const last = Math.min(total, (pageIndex + 1) * pagination.pageSize);
  const isSticky = (i: number, meta: DataTableMeta | undefined) => (stickyFirst && i === 0) || !!meta?.sticky;
  const sticky = (i: number, meta: DataTableMeta | undefined) => isSticky(i, meta) && 'sticky left-0 z-10 bg-surface';
  // A sticky header keeps its rule with an ::after line: a row border would stay behind when it scrolls.
  const head = stickyHeader && 'sticky top-0 z-20 bg-surface after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-line';
  const columnsButton = columnsMenu && (
    <Menu label="Columns" heading="Show columns" trigger={<Button size="sm" icon={Columns3} className="ml-auto" />}
      items={table.getAllLeafColumns().filter((c) => c.getCanHide()).map((c) => ({ label: nameOf(c.columnDef), checked: c.getIsVisible(), onCheckedChange: (v: boolean) => c.toggleVisibility(v) }))}>
      Columns
    </Menu>
  );

  return (
    <div className="flex flex-col gap-3">
      {(search || toolbar || columnsButton) && (
        <div className="flex flex-wrap items-center gap-2">
          {search && <SearchInput value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={search.placeholder} aria-label={search.placeholder} />}
          {toolbar}
          {columnsButton}
        </div>
      )}
      <div className="overflow-hidden rounded-card border border-line bg-surface">
        <Table aria-label={label} containerClassName={stickyHeader ? 'max-h-[calc(100dvh-5rem)] overflow-auto overscroll-x-contain' : undefined}>
          <TableHeader>
            {table.getHeaderGroups().map((g) => (
              <TableRow key={g.id} className="hover:bg-transparent">
                {g.headers.map((h, i) => {
                  const sorted = h.column.getIsSorted();
                  const title = h.column.columnDef.header;
                  const meta = h.column.columnDef.meta as DataTableMeta | undefined;
                  return (
                    <TableHead key={h.id} aria-sort={sorted ? (sorted === 'asc' ? 'ascending' : 'descending') : undefined} className={cx('px-3', sticky(i, meta), head, stickyHeader && isSticky(i, meta) && 'z-30', meta?.className)}>
                      {h.isPlaceholder ? null : typeof title === 'string' && h.column.getCanSort() ? (
                        <button type="button" onClick={h.column.getToggleSortingHandler()} className="-mx-1 inline-flex items-center gap-1 rounded-control px-1 py-0.5 font-medium hover:text-fg">
                          {title}
                          {sorted === 'asc' ? <ArrowUp aria-hidden className="size-3.5" /> : sorted === 'desc' ? <ArrowDown aria-hidden className="size-3.5" /> : <ArrowUpDown aria-hidden className="size-3.5 text-fg-4" />}
                        </button>
                      ) : flexRender(title, h.getContext())}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {rows.length ? rows.map((r) => (
              <TableRow key={r.id} className="group/row">
                {r.getVisibleCells().map((c, i) => {
                  const meta = c.column.columnDef.meta as DataTableMeta | undefined;
                  return (
                    <TableCell key={c.id} className={cx('px-3 py-2.5', sticky(i, meta), isSticky(i, meta) && 'group-hover/row:bg-subtle group-has-aria-expanded/row:bg-subtle', meta?.className, meta?.cellClassName)}>
                      {flexRender(c.column.columnDef.cell, c.getContext())}
                    </TableCell>
                  );
                })}
              </TableRow>
            )) : (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={table.getVisibleLeafColumns().length} className="px-3 py-8 text-center whitespace-normal text-fg-3">{empty}</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      {paged && total > pagination.pageSize && (
        <div className="flex items-center justify-between gap-2 text-sm text-fg-3">
          <span className="tabular-nums">{first}–{last} of {total}</span>
          <span className="flex gap-2">
            <Button size="sm" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>Previous</Button>
            <Button size="sm" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>Next</Button>
          </span>
        </div>
      )}
    </div>
  );
}
