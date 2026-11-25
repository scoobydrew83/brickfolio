// Brickfolio's component API. Import from '@/components/ui', never from the files behind it.
// Our own kit lives in ./kit/ (PascalCase components, hand-written). shadcn's generated components
// (`npx shadcn add <name>`) are written next to this file as lowercase files (./separator.tsx, …) and
// are imported by path, e.g. '@/components/ui/separator', until a stage-1 issue promotes one here.
export * from './kit/primitives';
export { Dialog } from './kit/Dialog';
export { Tip } from './kit/Tip';
export { Confirm, confirmAction, ConfirmHost, type ConfirmOptions } from './kit/Confirm';
export { toast, ToastHost } from './kit/Toast';
export { DataTable, type ColumnDef, type DataTableMeta, type SortingState } from './data-table';
export { Menu, MenuTrigger, useMenuHandle, type MenuHandle, type MenuItem } from './kit/Menu';
export { Combobox, type ComboboxOption } from './kit/Combobox';
export { DatePicker } from './kit/DatePicker';
