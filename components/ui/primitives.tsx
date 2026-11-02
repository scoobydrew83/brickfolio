// Shared UI building blocks. Every view uses these instead of writing its own classes.
// See docs/design.md → Components for when to use each one.
import type { LucideIcon } from 'lucide-react';
import { Loader2, Search, X } from 'lucide-react';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

/* ---------- Buttons ---------- */

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'link' | 'danger-link';
export type ButtonSize = 'sm' | 'md';

const VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-primary font-semibold text-on-primary hover:bg-primary-hover',
  secondary: 'border border-line-strong bg-surface font-medium text-fg hover:bg-subtle',
  ghost: 'font-medium text-fg-2 hover:bg-muted hover:text-fg',
  danger: 'bg-danger-solid font-semibold text-white hover:opacity-90',
  link: 'font-medium text-link hover:underline',
  'danger-link': 'font-medium text-danger hover:underline',
};
const SIZE: Record<ButtonSize, string> = { sm: 'gap-1.5 px-2.5 py-1.5 text-sm', md: 'gap-2 px-4 py-2 text-sm' };

/** Class string for a button look. Use it on <a> links that should look like buttons. */
export const buttonClass = (variant: ButtonVariant = 'secondary', size: ButtonSize = 'md') =>
  cx('inline-flex shrink-0 items-center justify-center rounded-control transition-colors disabled:pointer-events-none disabled:opacity-50', variant === 'link' || variant === 'danger-link' ? 'gap-1.5 text-sm' : SIZE[size], VARIANT[variant]);

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize; icon?: LucideIcon; loading?: boolean };

/** The one button. `loading` swaps the icon for a spinner and disables it. Defaults to type="button". */
export function Button({ variant = 'secondary', size = 'md', icon: Icon, loading, className, children, disabled, type = 'button', ...rest }: ButtonProps) {
  return (
    <button type={type} disabled={disabled || loading} aria-busy={loading || undefined} className={cx(buttonClass(variant, size), className)} {...rest}>
      {loading ? <Loader2 aria-hidden className="size-4 animate-spin" /> : Icon && <Icon aria-hidden className="size-4" />}
      {children}
    </button>
  );
}

/** Square icon-only button. `label` is required: it is the accessible name and the tooltip. */
export function IconButton({ icon: Icon, label, tone = 'default', className, type = 'button', ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { icon: LucideIcon; label: string; tone?: 'default' | 'danger' }) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cx(
        'inline-flex size-8 shrink-0 items-center justify-center rounded-control transition-colors disabled:opacity-50',
        tone === 'danger' ? 'text-fg-3 hover:bg-danger-soft hover:text-danger' : 'text-fg-2 hover:bg-muted hover:text-fg',
        className,
      )}
      {...rest}
    >
      <Icon aria-hidden className="size-4" />
    </button>
  );
}

/* ---------- Surfaces ---------- */

/** White (or dark) panel with a border. `dashed` is for empty states. */
export function Card({ as: Tag = 'section', dashed, className, ...rest }: React.HTMLAttributes<HTMLElement> & { as?: 'section' | 'div' | 'article' | 'ul'; dashed?: boolean }) {
  return <Tag className={cx('rounded-card border bg-surface', dashed ? 'border-dashed border-line-strong' : 'border-line', className)} {...rest} />;
}

export function EmptyState({ title, children, action }: { title?: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <Card dashed className="flex flex-col items-center gap-2 p-8 text-center text-sm text-fg-2">
      {title && <p className="font-semibold text-fg">{title}</p>}
      {children && <div className="max-w-prose">{children}</div>}
      {action}
    </Card>
  );
}

/** Grey placeholder block shown while something loads. */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cx('animate-pulse rounded-control bg-muted motion-reduce:animate-none', className)} />;
}

/** Placeholder for a whole page while its data loads: a big value line, a toolbar, photo-first items. */
export function PageSkeleton({ tiles = 4 }: { tiles?: number }) {
  return (
    <div role="status" aria-label="Loading" className="space-y-6">
      <Skeleton className="h-9 w-40" />
      <Skeleton className="h-16 w-72" />
      <Skeleton className="h-10 w-full" />
      <div className="grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: tiles }, (_, i) => (
          <div key={i} className="space-y-3">
            <Skeleton className="h-44 rounded-card" />
            <Skeleton className="h-7 w-24" />
            <Skeleton className="h-24 rounded-callout" />
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------- Status ---------- */

export type Tone = 'neutral' | 'ok' | 'warn' | 'danger' | 'info' | 'primary';
const TONE: Record<Tone, string> = {
  neutral: 'bg-muted text-fg-2 ring-line',
  ok: 'bg-ok-soft text-ok ring-ok-ring',
  warn: 'bg-warn-soft text-warn ring-warn-ring',
  danger: 'bg-danger-soft text-danger ring-danger-ring',
  info: 'bg-info-soft text-info ring-info-ring',
  primary: 'bg-primary-soft text-link ring-primary-ring',
};

/** Small status tag. */
export function Chip({ tone = 'neutral', className, children }: { tone?: Tone; className?: string; children: React.ReactNode }) {
  return <span className={cx('inline-flex items-center rounded-chip px-1.5 py-0.5 text-xs font-medium ring-1', TONE[tone], className)}>{children}</span>;
}

/** Condition of a set as a chip tone. */
export const CONDITION_TONE: Record<string, Tone> = { New: 'ok', Used: 'neutral', Partial: 'warn' };

/** Pill that toggles a filter on and off. */
export function FilterChip({ active, className, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { active: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={cx('shrink-0 rounded-callout px-3 py-1 text-sm ring-1 transition-colors', active ? 'bg-primary font-medium text-on-primary ring-primary-ring' : 'bg-surface text-fg-2 ring-line hover:bg-subtle hover:text-fg', className)}
      {...rest}
    />
  );
}

/** Success or error message across the page, with a dismiss button. */
export function Banner({ kind, onDismiss, children }: { kind: 'ok' | 'error'; onDismiss?: () => void; children: React.ReactNode }) {
  return (
    <div role={kind === 'error' ? 'alert' : 'status'} className={cx('flex items-start justify-between gap-4 rounded-control px-4 py-3 text-sm', kind === 'ok' ? 'bg-ok-soft text-ok' : 'bg-danger-soft text-danger')}>
      <span>{children}</span>
      {onDismiss && (
        <button type="button" onClick={onDismiss} aria-label="Dismiss" className="-m-1 rounded-control p-1 opacity-70 hover:opacity-100">
          <X aria-hidden className="size-4" />
        </button>
      )}
    </div>
  );
}

/* ---------- Inputs ---------- */

/** Base look for text inputs, selects and textareas inside forms. */
export const field = 'mt-1 w-full rounded-control border border-line-strong bg-surface px-3 py-2 text-sm text-fg placeholder:text-fg-4';

/** Search box with a magnifier icon. Fills the row. */
export function SearchInput({ className, ...rest }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className={cx('relative flex min-w-56 flex-1 items-center', className)}>
      <Search aria-hidden className="pointer-events-none absolute left-3 size-4 text-fg-4" />
      <input type="search" className="w-full rounded-control border border-line-strong bg-surface py-2 pr-3 pl-9 text-sm text-fg placeholder:text-fg-4" {...rest} />
    </label>
  );
}

/** Dropdown with an optional visible label. Without `label`, pass `aria-label`. */
export function Select({ label, options, className, ...rest }: React.SelectHTMLAttributes<HTMLSelectElement> & { label?: string; options: readonly (readonly string[])[] }) {
  const select = (
    <select className={cx('rounded-control border border-line-strong bg-surface px-2 py-2 text-sm text-fg', className)} {...rest}>
      {options.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
    </select>
  );
  return label ? <label className="flex items-center gap-2 text-sm text-fg-2">{label}{select}</label> : select;
}

/** Two to four mutually exclusive options, e.g. Cards / Table. */
export function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: readonly { value: T; label: string; icon?: LucideIcon }[]; label: string }) {
  return (
    <div role="group" aria-label={label} className="flex rounded-control border border-line-strong bg-surface p-0.5 text-sm">
      {options.map(({ value: v, label: l, icon: Icon }) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          aria-pressed={value === v}
          className={cx('inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 transition-colors', value === v ? 'bg-primary font-medium text-on-primary' : 'text-fg-2 hover:text-fg')}
        >
          {Icon && <Icon aria-hidden className="size-4" />}
          {l}
        </button>
      ))}
    </div>
  );
}

/* ---------- Data ---------- */

/**
 * The parts callout from a building-instructions booklet: a white box with a thin ink outline.
 * Brickfolio's signature. Use it for "what you have" summaries (a set's value, a parts list), not for layout.
 */
export function Callout({ className, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cx('rounded-callout border-[1.5px] border-outline bg-surface', className)} {...rest} />;
}

/** A quantity written the booklet way: 2x. */
export function Count({ n, className }: { n: number; className?: string }) {
  return <span className={cx('font-bold tabular-nums', className)}>{n}x</span>;
}

/** A labelled figure: value in heavy wide numerals, with how it was worked out underneath. */
export function Stat({ label, value, note, tone }: { label: string; value: string; note?: string; tone?: 'danger' }) {
  return (
    <Callout className="p-4">
      <p className="text-sm text-fg-3">{label}</p>
      <p className={cx('mt-1 text-2xl font-extrabold tracking-tight tabular-nums [font-stretch:112%]', tone === 'danger' && 'text-danger')}>{value}</p>
      {note && <p className="mt-0.5 text-xs text-fg-3">{note}</p>}
    </Callout>
  );
}

/** Square brick badge used in the header and app icons. Brand colors stay the same in both themes. */
export function Logo() {
  return (
    <span aria-hidden className="grid size-8 grid-cols-2 gap-0.5 rounded-md bg-amber-400 p-1.5">
      {[0, 1, 2, 3].map((i) => <span key={i} className="rounded-full bg-amber-300 ring-1 ring-amber-500/40" />)}
    </span>
  );
}
