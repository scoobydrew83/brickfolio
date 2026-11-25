'use client';
// A menu of actions behind one button (#106): shadcn's dropdown-menu (Base UI) with our look. Keyboard: Enter, Space
// or the arrow keys open it; arrows move, Enter picks, Escape closes and returns focus to the button. Taps work too.
//
// One menu:   <Menu label="Columns" items={[…]} />
// Many rows:  one menu shared by every row's button, so a long table renders one menu instead of one per row.
//             const rows = useMenuHandle<Row>();
//             <MenuTrigger handle={rows} payload={row} label="Actions for …" />   (in each row)
//             <Menu handle={rows} items={(row) => […]} />                         (once)
import type { LucideIcon } from 'lucide-react';
import { MoreHorizontal } from 'lucide-react';
import { memo, useState } from 'react';
import { Menu as MenuPrimitive } from '@base-ui/react/menu';
import { Button as ShadButton } from '../button';
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '../dropdown-menu';
import { cx } from './primitives';

/** An action, a checkbox (stays open when ticked), or a line between groups. Falsy entries are skipped. */
export type MenuItem =
  | { label: string; icon?: LucideIcon; onSelect: () => void; tone?: 'danger'; disabled?: boolean }
  | { label: string; checked: boolean; onCheckedChange: (checked: boolean) => void; disabled?: boolean }
  | 'separator';
type Items = (MenuItem | false | null | undefined)[];

export type MenuHandle<P> = MenuPrimitive.Handle<P>;
/** A handle that ties many `MenuTrigger`s to one shared `Menu`. */
export function useMenuHandle<P>(): MenuHandle<P> {
  const [handle] = useState(() => MenuPrimitive.createHandle<P>());
  return handle;
}

const iconTrigger = <ShadButton variant="ghost" size="icon" />;

/**
 * A ⋯ button that opens the shared menu for `payload` (its row). Memoized: a long table re-renders its rows on every
 * sort, and the triggers' props don't change then.
 */
function MenuTriggerImpl<P>({ handle, payload, label, disabled }: { handle: MenuHandle<P>; payload: P; label: string; disabled?: boolean }) {
  return (
    <DropdownMenuTrigger handle={handle} payload={payload} disabled={disabled} aria-label={label} render={iconTrigger}>
      <MoreHorizontal aria-hidden />
    </DropdownMenuTrigger>
  );
}
export const MenuTrigger = memo(MenuTriggerImpl) as typeof MenuTriggerImpl;

function MenuItems({ items, heading }: { items: Items; heading?: string }) {
  const list = items.filter((i): i is MenuItem => !!i);
  return (
    <DropdownMenuGroup>
      {heading && <DropdownMenuLabel>{heading}</DropdownMenuLabel>}
      {list.map((item, i) => {
        if (item === 'separator') return <DropdownMenuSeparator key={`sep-${i}`} />;
        if ('checked' in item) {
          return (
            <DropdownMenuCheckboxItem key={item.label} checked={item.checked} onCheckedChange={item.onCheckedChange} disabled={item.disabled} className="py-1.5">
              {item.label}
            </DropdownMenuCheckboxItem>
          );
        }
        const Icon = item.icon;
        return (
          <DropdownMenuItem key={item.label} onClick={item.onSelect} disabled={item.disabled} variant={item.tone === 'danger' ? 'destructive' : 'default'} className="py-1.5">
            {Icon && <Icon aria-hidden />}
            {item.label}
          </DropdownMenuItem>
        );
      })}
    </DropdownMenuGroup>
  );
}

type Common = { heading?: string; align?: 'start' | 'center' | 'end'; className?: string };
type Own = Common & {
  /** The button's accessible name, e.g. "Columns" or "Actions for 10280 Flower Bouquet". */
  label: string;
  items: Items;
  /** The button: a ⋯ icon button by default. Give an element (our `Button`) for a labelled one, with `children` as its content. */
  trigger?: React.ReactElement;
  children?: React.ReactNode;
  disabled?: boolean;
  handle?: never;
};
type Shared<P> = Common & { handle: MenuHandle<P>; items: (payload: P) => Items };

export function Menu<P>(props: Own | Shared<P>) {
  const { heading, align = 'end', className } = props;
  const content = (items: Items) => (
    <DropdownMenuContent align={align} className={cx('w-auto min-w-44', className)}>
      <MenuItems items={items} heading={heading} />
    </DropdownMenuContent>
  );
  if (props.handle) {
    const { handle, items } = props;
    return <DropdownMenu handle={handle}>{({ payload }) => (payload === undefined ? null : content(items(payload as P)))}</DropdownMenu>;
  }
  const { label, items, trigger, children, disabled } = props;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger disabled={disabled} aria-label={trigger ? undefined : label} render={trigger ?? iconTrigger}>
        {trigger ? children : <MoreHorizontal aria-hidden />}
      </DropdownMenuTrigger>
      {content(items)}
    </DropdownMenu>
  );
}
