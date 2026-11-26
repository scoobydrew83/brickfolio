'use client';
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import Image from 'next/image';
import { usePathname, useRouter } from 'next/navigation';
import {
  Boxes, ChartColumn, ClipboardList, Hammer, Heart, Library, LayoutGrid, Monitor, Moon, Package, Plus, Puzzle, Radar, Receipt, RefreshCw,
  ScanBarcode, Search, Settings, Store, Sun, UserRound, Users, type LucideIcon,
} from 'lucide-react';
import { runSync, selectCollection } from '@/app/actions';
import { CommandDialog, Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Tip } from '@/components/ui';
import { matches, pagesFor, parseQuery, SEARCH_GROUPS, type SearchHit } from '@/lib/search';
import { applyTheme } from './ThemeToggle';

/** Opens the palette from anywhere (the phone menu's Search item). */
export const OPEN_SEARCH = 'brickfolio:search';

/**
 * An overlay over the page where the shortcuts don't open the palette: a native modal <dialog> (a form; the page
 * behind it, where the palette opens, is inert) or the open phone menu (a shadcn `sheet`). The menu's own Search row
 * closes the menu first, then opens the palette with OPEN_SEARCH.
 */
export const OVERLAY_OPEN = 'dialog[open], [data-slot="sheet-content"][data-open]';

const PAGE_ICON: Record<string, LucideIcon> = {
  '/': Boxes, '/wishlist': Heart, '/radar': Radar, '/insights': ChartColumn, '/parts': Puzzle, '/layouts': LayoutGrid, '/store': Store, '/orders': Receipt,
  '/settings': Settings, '/account': UserRound, '/minifigs': Users, '/parts/lots': Package, '/build': Hammer,
};
const GROUP_ICON: Record<string, LucideIcon> = { Sets: Boxes, Minifigures: Users, Wishlist: Heart, Parts: Puzzle, 'Loose parts': Package };
/** Photos only from the hosts next/image already resizes (next.config.ts), so a thumbnail stays small and cached. */
const PHOTO_HOSTS = /^https:\/\/(img\.bricklink\.com|cdn\.rebrickable\.com)\//;
const DEBOUNCE_MS = 150;

type Action = { id: string; label: string; words?: string; icon: LucideIcon; run: () => void | Promise<void> };
type Props = {
  admin: boolean; account: boolean; canAdd: boolean;
  /** The selected collection to search (#49), or undefined for all the caller's. */
  collection?: number;
  /** Collections to switch between (two or more), with the current one. */
  collections: { id: number; name: string }[];
  current: number | 'all';
};

/** Typing in a field: `/` types there instead of opening the palette. */
const typing = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

/**
 * ⌘K / Ctrl+K (anywhere) or `/` (when not typing), the header's search button, or the phone menu's Search item open a
 * palette that jumps to a page, a set, a minifigure, a wishlist item or a part, or runs an action (#107). Search runs
 * on the server (GET /api/v1/search), cut to what this person may read; pages and actions are listed without typing.
 */
export function CommandPalette({ admin, account, canAdd, collection, collections, current }: Props) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  // `failed`: the request didn't get an answer (offline, network error, server error); tried again when back online.
  const [found, setFound] = useState<{ q: string; hits: SearchHit[]; failed?: boolean } | null>(null);
  const [online, setOnline] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const path = usePathname();
  const ctrl = useRef<AbortController | null>(null);

  // Keyboard: ⌘K / Ctrl+K toggles, even in a field; `/` opens when not typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Not over a form's <dialog> or the phone menu (OVERLAY_OPEN).
      if (document.querySelector(OVERLAY_OPEN)) return;
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen((o) => !o); return; }
      if (e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey && !typing(e.target)) { e.preventDefault(); setOpen(true); }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener(OPEN_SEARCH, onOpen);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener(OPEN_SEARCH, onOpen); };
  }, []);

  // Server search, 150 ms after typing stops; a newer query cancels the one in flight.
  const query = parseQuery(q);
  const term = query.ok ? query.q : null;
  useEffect(() => {
    if (!open || !term) return;
    const t = setTimeout(async () => {
      ctrl.current?.abort();
      const c = (ctrl.current = new AbortController());
      const params = new URLSearchParams({ q: term, ...(collection ? { collection: String(collection) } : {}) });
      try {
        const res = await fetch(`/api/v1/search?${params}`, { signal: c.signal, headers: { accept: 'application/json' } });
        const body = await res.json().catch(() => null);
        if (!c.signal.aborted) setFound({ q: term, hits: res.ok ? (body?.results ?? []) : [], failed: !res.ok });
      } catch {
        // Aborted by a newer query: nothing to do. Otherwise (offline, network error) stop "Searching…" and say so.
        if (!c.signal.aborted) setFound({ q: term, hits: [], failed: true });
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [term, open, collection, online]);

  // Back online: search again for what's typed (the effect above reruns).
  useEffect(() => {
    const onOnline = () => setOnline((n) => n + 1);
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, []);

  const close = () => setOpen(false);
  const go = (href: string) => { close(); router.push(href); };

  const actions = useMemo<Action[]>(() => {
    const list: Action[] = [];
    if (canAdd) {
      list.push({ id: 'add', label: 'Add set', words: 'new', icon: Plus, run: () => go('/?add=set') });
      list.push({ id: 'scan', label: 'Scan a barcode', words: 'camera box', icon: ScanBarcode, run: () => go('/scan') });
      list.push({ id: 'paste', label: 'Paste a list', words: 'bulk import add', icon: ClipboardList, run: () => go('/?add=list') });
    }
    if (admin) list.push({
      id: 'sync', label: 'Sync now', words: 'prices bricklink refresh', icon: RefreshCw,
      run: () => start(async () => { const r = await runSync(); if (r.ok) go('/'); else setError(r.error); }),
    });
    if (collections.length > 1) {
      for (const c of [{ id: 'all' as const, name: 'All collections' }, ...collections]) {
        if (c.id === current) continue;
        list.push({ id: `col-${c.id}`, label: `Switch to ${c.name}`, words: 'collection', icon: Library,
          run: () => start(async () => { const r = await selectCollection(c.id); if (r.ok) { close(); router.refresh(); } else setError(r.error); }) });
      }
    }
    list.push(
      { id: 'light', label: 'Theme: light', words: 'appearance day', icon: Sun, run: () => { applyTheme('light'); close(); } },
      { id: 'dark', label: 'Theme: dark', words: 'appearance night', icon: Moon, run: () => { applyTheme('dark'); close(); } },
      { id: 'system', label: 'Theme: system', words: 'appearance auto', icon: Monitor, run: () => { applyTheme('system'); close(); } },
    );
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- go/close only close the palette and navigate
  }, [admin, canAdd, collections, current]);

  const text = q.trim();
  const pages = pagesFor(admin, account).filter((p) => matches(text, p.label, p.words));
  const acts = actions.filter((a) => matches(text, a.label, a.words));
  const hits = term && found?.q === term ? found.hits.filter((h) => h.group !== 'Pages') : [];
  const searching = !!term && found?.q !== term;
  const count = pages.length + acts.length + hits.length;

  const onOpenChange = (o: boolean) => {
    setOpen(o);
    if (!o) { setQ(''); setError(null); ctrl.current?.abort(); }
  };

  return (
    <>
      <Tip label="Search (⌘K or /)" side="bottom">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Search (⌘K)"
          aria-haspopup="dialog"
          aria-keyshortcuts="Meta+K Control+K /"
          className="hidden size-9 shrink-0 items-center justify-center rounded-control text-on-header hover:bg-header-hover hover:text-on-header-strong sm:flex"
        >
          <Search aria-hidden className="size-4" />
        </button>
      </Tip>
      <CommandDialog
        open={open}
        onOpenChange={onOpenChange}
        title="Search"
        description="Jump to a page, a set, a minifigure or a part, or run an action."
        className="top-[max(0.75rem,env(safe-area-inset-top))] max-w-[calc(100%-1.5rem)] sm:top-[12vh] sm:max-w-xl"
      >
        <Command shouldFilter={false} loop label="Search">
          <CommandInput autoFocus value={q} onValueChange={(v) => { setQ(v); setError(null); }} placeholder="Search sets, parts, pages…" aria-label="Search" maxLength={64} />
          <CommandList className="max-h-[min(26rem,60dvh)] px-1 pb-1">
            {!query.ok && <p role="alert" className="px-3 py-6 text-center text-sm text-danger">{query.error}</p>}
            {error && <p role="alert" className="px-3 pt-3 text-sm text-danger">{error}</p>}
            {query.ok && !searching && <CommandEmpty className="py-8 text-fg-3">Nothing found for “{text}”.</CommandEmpty>}
            {pages.length > 0 && (
              <CommandGroup heading="Pages">
                {pages.map((p) => {
                  const Icon = PAGE_ICON[p.href] ?? Boxes;
                  return (
                    <CommandItem key={p.href} value={`page:${p.href}`} onSelect={() => go(p.href)}>
                      <Icon aria-hidden className="text-fg-3" />
                      <span className="flex-1 truncate">{p.label}</span>
                      {path === p.href && <span className="text-xs text-fg-3">Here</span>}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            )}
            {SEARCH_GROUPS.filter((g) => g !== 'Pages').map((g) => {
              const rows = hits.filter((h) => h.group === g);
              if (!rows.length) return null;
              const Icon = GROUP_ICON[g] ?? Boxes;
              return (
                <CommandGroup key={g} heading={g}>
                  {rows.map((h, i) => (
                    <CommandItem key={`${h.href}:${i}`} value={`${g}:${h.href}:${h.label}:${i}`} onSelect={() => go(h.href)}>
                      {h.image && PHOTO_HOSTS.test(h.image)
                        ? <span className="flex size-8 shrink-0 items-center justify-center rounded-chip bg-tile"><Image src={h.image} alt="" width={32} height={32} className="max-h-7 w-auto object-contain mix-blend-multiply" /></span>
                        : <span className="flex size-8 shrink-0 items-center justify-center"><Icon aria-hidden className="text-fg-3" /></span>}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{h.label}</span>
                        {h.hint && <span className="block truncate text-xs text-fg-3">{h.hint}</span>}
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              );
            })}
            {acts.length > 0 && (
              <CommandGroup heading="Actions">
                {acts.map((a) => (
                  <CommandItem key={a.id} value={`action:${a.id}`} disabled={pending} onSelect={() => a.run()}>
                    <a.icon aria-hidden className="text-fg-3" />
                    <span className="flex-1 truncate">{a.label}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {searching && <p className="px-3 py-2 text-xs text-fg-3">Searching…</p>}
            {!searching && term && found?.q === term && found.failed && <p role="alert" className="px-3 py-2 text-xs text-danger">Couldn’t search right now. Check your connection; it tries again when you’re back online.</p>}
          </CommandList>
          <p role="status" aria-live="polite" className="sr-only">
            {searching ? 'Searching' : `${count} result${count === 1 ? '' : 's'}`}
          </p>
        </Command>
      </CommandDialog>
    </>
  );
}
