'use client';
import { useSyncExternalStore } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';

type Theme = 'system' | 'light' | 'dark';
const KEY = 'brickfolio-theme';
const ORDER: Theme[] = ['system', 'light', 'dark'];
const ICON = { system: Monitor, light: Sun, dark: Moon };

/** Runs before first paint (see app/layout.tsx) so a saved theme never flashes. */
export const THEME_SCRIPT = `try{var t=localStorage.getItem("${KEY}");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

const listeners = new Set<() => void>();
const read = (): Theme => {
  const t = document.documentElement.dataset.theme;
  return t === 'light' || t === 'dark' ? t : 'system';
};
const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };

function apply(t: Theme) {
  const root = document.documentElement;
  if (t === 'system') delete root.dataset.theme; else root.dataset.theme = t;
  try { if (t === 'system') localStorage.removeItem(KEY); else localStorage.setItem(KEY, t); } catch {}
  listeners.forEach((fn) => fn());
}

/** Cycles system → light → dark. */
export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, read, () => 'system' as Theme);
  const next = ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length];
  const Icon = ICON[theme];
  return (
    <button
      type="button"
      onClick={() => apply(next)}
      title={`Theme: ${theme}. Switch to ${next}.`}
      aria-label={`Theme: ${theme}. Switch to ${next}.`}
      className="flex size-9 shrink-0 items-center justify-center rounded-control text-on-header hover:bg-white/10 hover:text-white"
    >
      <Icon aria-hidden className="size-4" />
    </button>
  );
}
