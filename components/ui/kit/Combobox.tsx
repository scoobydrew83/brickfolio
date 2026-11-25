'use client';
import { useMemo, useRef, useState } from 'react';
import { Combobox as Base } from '@base-ui/react/combobox';
import { ChevronDown, Loader2, Plus } from 'lucide-react';
import { ComboboxContent, ComboboxEmpty, ComboboxItem, ComboboxList } from '../combobox';
import { cx, field } from './primitives';

export type ComboboxOption = { value: string; label: string; hint?: string };
type Item = ComboboxOption & { create?: string };

type Props = {
  options: readonly ComboboxOption[];
  /** Controlled value. Leave it out and use `defaultValue` inside a form that reads FormData. */
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  /** Shown on the button when nothing is chosen. */
  placeholder?: string;
  /** The accessible name (the visible label can be a wrapping <label>). */
  label: string;
  /** Posts the value under this name, through a hidden input, so it works in server-action forms. */
  name?: string;
  /**
   * Offer what was typed when nothing matches. With `onCreate`, it runs first (e.g. adding a location on the server)
   * and returns an error to show, or nothing when it worked; without it, the typed text simply becomes the value.
   */
  allowCreate?: boolean;
  onCreate?: (text: string) => Promise<string | void> | string | void;
  /** Words for the create row: `Add "…"`. */
  createLabel?: (text: string) => string;
  disabled?: boolean;
  className?: string;
  id?: string;
};

/**
 * The value a combobox starts with, so a converted <select> posts what it did: a value that isn't an option falls back
 * to the first option, as a select's does. Free text (`allowCreate` without `onCreate`, like a colour number) keeps it.
 */
export function startValue(options: readonly ComboboxOption[], value: string, freeText = false): string {
  return freeText || options.some((o) => o.value === value) ? value : (options[0]?.value ?? '');
}

/** The create row is offered when the text is not already an option's value or label (ignoring case). */
export function canCreate(options: readonly ComboboxOption[], text: string): boolean {
  const t = text.trim().toLocaleLowerCase();
  return t !== '' && !options.some((o) => o.value.toLocaleLowerCase() === t || o.label.toLocaleLowerCase() === t);
}

/**
 * A searchable dropdown for long lists (themes, locations, colours). A button that looks like our `field` opens a
 * popup with a search box: type to filter, arrow keys, Enter to choose, Escape to close. Short lists keep the native
 * `Select`, which phones show with the system picker.
 */
export function Combobox({ options, value, defaultValue = '', onChange, placeholder = 'Choose…', label, name, allowCreate, onCreate, createLabel = (t) => `Add "${t}"`, disabled, className, id }: Props) {
  const freeText = !!allowCreate && !onCreate;
  const [own, setOwn] = useState(() => startValue(options, defaultValue, freeText));
  const current = value ?? own;
  const [added, setAdded] = useState<ComboboxOption[]>([]);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  const all = useMemo(() => {
    const list: ComboboxOption[] = [...options, ...added.filter((a) => !options.some((o) => o.value === a.value))];
    // Free text that isn't an option (a colour number with no colour names yet) still shows and posts as it is.
    if (freeText && current && !list.some((o) => o.value === current)) list.push({ value: current, label: current });
    return list;
  }, [options, added, current, freeText]);
  const items: Item[] = allowCreate && canCreate(all, query) ? [...all, { value: query.trim(), label: createLabel(query.trim()), create: query.trim() }] : all;
  const selected = all.find((o) => o.value === current) ?? null;

  const choose = (v: string) => {
    if (value === undefined) setOwn(v);
    onChange?.(v);
  };

  const pick = async (item: Item | null) => {
    setError('');
    if (!item) return;
    if (!item.create) return choose(item.value);
    const text = item.create;
    if (onCreate) {
      setBusy(true);
      try {
        const err = await onCreate(text);
        if (err) { setError(err); return; }
      } finally { setBusy(false); }
    }
    setAdded((a) => [...a, { value: text, label: text }]);
    choose(text);
  };

  return (
    <>
      <Base.Root<Item>
        items={items}
        value={selected}
        onValueChange={(v) => { void pick(v); }}
        inputValue={query}
        onInputValueChange={setQuery}
        onOpenChange={(open) => {
          if (open) { setContainer(trigger.current?.closest('dialog') ?? null); setError(''); } else setQuery('');
        }}
        isItemEqualToValue={(a, b) => a.value === b.value && !a.create === !b.create}
        itemToStringLabel={(i) => i.label}
        itemToStringValue={(i) => i.value}
        // The create row always matches what was typed.
        filter={(item, q) => !!item.create || `${item.label} ${item.hint ?? ''}`.toLocaleLowerCase().includes(q.trim().toLocaleLowerCase())}
        disabled={disabled || busy}
        autoHighlight
      >
        <Base.Trigger
          ref={trigger}
          id={id}
          aria-label={label}
          className={cx(field, 'flex min-h-[38px] cursor-default items-center justify-between gap-2 text-left disabled:opacity-50', className)}
        >
          <span className={cx('min-w-0 truncate', !selected && 'text-fg-4')}>{selected ? selected.label : placeholder}</span>
          {busy ? <Loader2 aria-hidden className="size-4 shrink-0 animate-spin text-fg-3 motion-reduce:animate-none" /> : <ChevronDown aria-hidden className="size-4 shrink-0 text-fg-3" />}
        </Base.Trigger>
        <ComboboxContent container={container ?? undefined} aria-label={label} className="min-w-56" onKeyDown={(e) => { if (e.key === 'Escape') e.preventDefault(); }}>
          <div className="border-b border-line p-1">
            <Base.Input
              aria-label={`Search ${label.toLocaleLowerCase()}`}
              placeholder={allowCreate ? 'Search or add…' : 'Search…'}
              className="w-full rounded-control bg-surface px-2 py-1.5 text-base text-fg outline-none placeholder:text-fg-4 sm:text-sm"
            />
          </div>
          <ComboboxEmpty>No matches.</ComboboxEmpty>
          <ComboboxList>
            {(item: Item) => (
              <ComboboxItem key={item.create ? `+${item.value}` : item.value} value={item}>
                {item.create && <Plus aria-hidden className="size-4 text-fg-3" />}
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                {item.hint && <span className="shrink-0 text-xs text-fg-3 tabular-nums">{item.hint}</span>}
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Base.Root>
      {name !== undefined && <input type="hidden" name={name} value={current} />}
      {error && <span role="alert" className="mt-1 block text-xs text-danger">{error}</span>}
    </>
  );
}
