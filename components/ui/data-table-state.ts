// Which of a DataTable's columns are hidden, remembered per browser in localStorage (#106). Storage can be missing
// or throw (private windows, blocked site data), so every read and write is guarded and the table falls back to its
// default: every column shown.
import { useCallback, useMemo, useSyncExternalStore } from 'react';

export type VisibilityState = Record<string, boolean>;

/** The stored value as TanStack visibility: only known, hideable ids, only `false` kept (shown is the default). */
export function parseVisibility(raw: string | null, hideable: readonly string[]): VisibilityState {
  if (!raw) return {};
  try {
    const hidden: unknown = JSON.parse(raw);
    if (!Array.isArray(hidden)) return {};
    return Object.fromEntries(hidden.filter((id): id is string => typeof id === 'string' && hideable.includes(id)).map((id) => [id, false]));
  } catch {
    return {};
  }
}

/** What's stored: the ids of the hidden columns, sorted, or null when nothing is hidden. */
export function serializeVisibility(v: VisibilityState): string | null {
  const hidden = Object.keys(v).filter((id) => v[id] === false).sort();
  return hidden.length ? JSON.stringify(hidden) : null;
}

const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  const onStorage = (e: StorageEvent) => { if (e.key === null || e.key.startsWith('bf:')) fn(); };
  window.addEventListener('storage', onStorage);
  return () => { listeners.delete(fn); window.removeEventListener('storage', onStorage); };
};

/** Values that couldn't be saved: they last until the page reloads. */
const unsaved = new Map<string, string | null>();

export function readStored(key: string): string | null {
  if (unsaved.has(key)) return unsaved.get(key) ?? null;
  try { return globalThis.localStorage?.getItem(key) ?? null; } catch { return null; }
}

export function writeStored(key: string, value: string | null) {
  try {
    if (!globalThis.localStorage) throw new Error('no storage');
    if (value === null) globalThis.localStorage.removeItem(key);
    else globalThis.localStorage.setItem(key, value);
    unsaved.delete(key);
  } catch {
    unsaved.set(key, value);
  }
  for (const fn of listeners) fn();
}

/**
 * Column visibility saved under `key` (prefixed `bf:`). The server render and the first browser render show every
 * column; the saved choice applies right after hydration.
 */
export function useStoredVisibility(key: string | undefined, hideable: readonly string[]): [VisibilityState, (v: VisibilityState) => void] {
  const storageKey = key ? `bf:${key}` : '';
  const raw = useSyncExternalStore(subscribe, () => (storageKey ? readStored(storageKey) : null), () => null);
  const ids = hideable.join('\n');
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `ids` stands for `hideable`
  const visibility = useMemo(() => parseVisibility(raw, hideable), [raw, ids]);
  const set = useCallback((v: VisibilityState) => { if (storageKey) writeStored(storageKey, serializeVisibility(v)); }, [storageKey]);
  return [visibility, set];
}
