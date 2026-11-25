'use client';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import dynamic from 'next/dynamic';
import { CalendarDays, X } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '../popover';
import { cx, field } from './primitives';
import { dayPickerLocaleCodes, firstWeekday, formatYmd, parseYmd } from './dates';

type Props = {
  /** YYYY-MM-DD, or '' for none. Controlled; leave it out and use `defaultValue` inside a form. */
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  /** Posts the YYYY-MM-DD value (or '') under this name through a hidden input, as `<input type="date">` did. */
  name?: string;
  /** The accessible name (the visible label can be a wrapping <label>). */
  label: string;
  placeholder?: string;
  required?: boolean;
  /** Earliest allowed date, YYYY-MM-DD. */
  min?: string;
  disabled?: boolean;
  className?: string;
};

const noop = () => () => {};
const browserLocale = () => navigator.language;
const SM = '(min-width: 640px)';
const onResize = (fn: () => void) => { const m = window.matchMedia(SM); m.addEventListener('change', fn); return () => m.removeEventListener('change', fn); };

// The calendar (react-day-picker and date-fns, about 33 KB gzip) loads in the browser when a picker first opens, so
// it stays out of the server bundle (the Cloudflare Worker) and out of pages until it's needed. With it comes
// react-day-picker's locale for the browser language (#119): month and weekday names were already the browser's, and
// this also translates what screen readers hear (previous/next month, the month and year menus, "today", "selected").
// Each locale is its own small chunk; English is the built-in default and loads nothing.
const Calendar = dynamic(async () => {
  // Everything here, the locale import included, is browser-only: with `ssr: false` Next leaves this loader out of the
  // server bundle. (A locale loader outside it put all 96 locales in the Worker.)
  const load = async (): Promise<DayPickerLocale | undefined> => {
    for (const code of dayPickerLocaleCodes(navigator.language)) {
      try {
        const mod: Record<string, unknown> = await import(`react-day-picker/locale/${code}`);
        const found = Object.values(mod).find((v): v is DayPickerLocale => !!v && typeof v === 'object' && 'code' in v);
        if (found) return found;
      } catch { /* no file for this code: try the next */ }
    }
    return undefined;
  };
  const [{ Calendar: C }, locale] = await Promise.all([import('../calendar'), load()]);
  return function FocusedCalendar(props: React.ComponentProps<typeof C>) {
    // Start keyboard focus on the chosen day (or today, or the first day you can pick), not on the month controls.
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => { const t = requestAnimationFrame(() => focusDay(ref.current)); return () => cancelAnimationFrame(t); }, []);
    return <div ref={ref}><C locale={locale} {...props} /></div>;
  };
}, {
  ssr: false,
  loading: () => <div role="status" aria-label="Loading the calendar" className="h-72 w-64" />,
});

/** react-day-picker's locale type (a date-fns locale plus its own translated labels). */
type DayPickerLocale = NonNullable<React.ComponentProps<typeof import('../calendar').Calendar>['locale']>;

function focusDay(root: HTMLElement | null) {
  const day = root?.querySelector<HTMLButtonElement>('button[data-selected-single="true"]:not([disabled])')
    ?? root?.querySelector<HTMLButtonElement>('[data-today] button:not([disabled])')
    ?? root?.querySelector<HTMLButtonElement>('button[data-day]:not([disabled])');
  day?.focus();
}

/**
 * A date field in our look: a button showing the date in the browser's format opens a calendar (arrow keys move by
 * day and week, Page Up/Down by month, Enter picks, Escape closes). The week starts on the browser locale's first
 * day. A clear button empties it. The value is the same YYYY-MM-DD string the native date input posted.
 * Below 640px (and before hydration) it is the native date input: phones show their own date wheel, which is better.
 */
export function DatePicker({ value, defaultValue = '', onChange, name, label, placeholder = 'Pick a date', required, min, disabled, className }: Props) {
  const [own, setOwn] = useState(defaultValue);
  const current = value ?? own;
  const [open, setOpen] = useState(false);
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const locale = useSyncExternalStore(noop, browserLocale, () => undefined);
  const wide = useSyncExternalStore(onResize, () => window.matchMedia(SM).matches, () => false);
  const date = parseYmd(current);
  const earliest = parseYmd(min);

  const set = (v: string) => {
    if (value === undefined) setOwn(v);
    onChange?.(v);
  };
  const shown = date ? date.toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' }) : '';

  if (!wide) {
    return <input type="date" name={name} value={current} onChange={(e) => set(e.target.value)} required={required} min={min} disabled={disabled} aria-label={label} className={cx(field, className)} />;
  }

  return (
    <span className={cx('relative mt-1 flex items-stretch', className)}>
      <Popover open={open} onOpenChange={(o) => { if (o) setContainer(trigger.current?.closest('dialog') ?? null); setOpen(o); }}>
        <PopoverTrigger
          ref={trigger}
          disabled={disabled}
          aria-label={`${label}${shown ? `: ${shown}` : ''}`}
          className={cx(field, 'mt-0 flex min-h-[38px] cursor-default items-center gap-2 text-left disabled:opacity-50', current && 'pr-9')}
        >
          <CalendarDays aria-hidden className="size-4 shrink-0 text-fg-3" />
          <span className={cx('min-w-0 truncate', !shown && 'text-fg-4')}>{shown || placeholder}</span>
        </PopoverTrigger>
        <PopoverContent container={container ?? undefined} align="start" className="w-auto p-1" aria-label={label} onKeyDown={(e) => { if (e.key === 'Escape') e.preventDefault(); }}>
          <Calendar
            mode="single"
            selected={date}
            defaultMonth={date ?? earliest}
            onSelect={(d) => { set(d ? formatYmd(d) : ''); setOpen(false); }}
            disabled={earliest ? { before: earliest } : undefined}
            weekStartsOn={firstWeekday(locale)}
            captionLayout="dropdown"
            startMonth={new Date(1949, 0)}
            endMonth={new Date(new Date().getFullYear() + 10, 11)}
            formatters={{
              formatWeekdayName: (d) => d.toLocaleDateString(locale, { weekday: 'narrow' }),
              formatMonthDropdown: (d) => d.toLocaleDateString(locale, { month: 'short' }),
            }}
            className="[--cell-size:--spacing(9)] sm:[--cell-size:--spacing(8)]"
          />
        </PopoverContent>
      </Popover>
      {current && !disabled && (
        <button type="button" onClick={() => set('')} aria-label={`Clear ${label.toLocaleLowerCase()}`} className="absolute inset-y-0 right-0 flex w-9 items-center justify-center rounded-control text-fg-3 hover:text-fg">
          <X aria-hidden className="size-4" />
        </button>
      )}
      {name !== undefined && (
        // Not type="hidden", so `required` still blocks the submit; it sits under the button, out of the tab order.
        <input name={name} value={current} required={required} onChange={() => {}} tabIndex={-1} aria-hidden className="pointer-events-none absolute inset-0 -z-10 opacity-0"
          onInvalid={() => trigger.current?.focus()} />
      )}
    </span>
  );
}
