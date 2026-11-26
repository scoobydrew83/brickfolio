---
name: Brickfolio
description: A self-hosted tracker for a brick-set collection, priced from what sets actually sell for.
colors:
  paper: "#e3eaf0"
  callout: "#ffffff"
  paper-inset: "#f1f5f8"
  paper-muted: "#dde5ec"
  rule: "#c9d4dd"
  rule-strong: "#7d8e9c"
  ink-outline: "#2b3a46"
  ink: "#14212b"
  ink-2: "#364552"
  ink-3: "#52626f"
  ink-4: "#8796a3"
  header: "#14212b"
  on-header: "#e3eaf0"
  brick-yellow: "#f6c343"
  brick-yellow-hover: "#eab42c"
  link-blue: "#1d5aa0"
  ok: "#146c43"
  ok-soft: "#e1f3e8"
  warn: "#8a4b00"
  warn-soft: "#fdf0d9"
  danger: "#b42318"
  danger-soft: "#fde8e6"
  danger-solid: "#c8321f"
  photo-tile: "#f5f7f9"
  night-paper: "#0f171d"
  night-callout: "#17222b"
  night-ink: "#e8eef3"
  night-header: "#0a1116"
typography:
  value:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "3.75rem"
    fontWeight: 800
    lineHeight: 1
    letterSpacing: "-0.025em"
  step-numeral:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.875rem"
    fontWeight: 800
    lineHeight: 1
    letterSpacing: "-0.025em"
  page-title:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.875rem"
    fontWeight: 800
    lineHeight: 1.2
    letterSpacing: "-0.025em"
  title:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 600
    lineHeight: 1.375
  body:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.43
  caption:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.33
rounded:
  chip: "6px"
  control: "8px"
  callout: "10px"
  card: "14px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "40px"
components:
  button-primary:
    backgroundColor: "{colors.brick-yellow}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "8px 16px"
  button-primary-hover:
    backgroundColor: "{colors.brick-yellow-hover}"
  button-secondary:
    backgroundColor: "{colors.callout}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "8px 16px"
  filter-chip:
    backgroundColor: "{colors.callout}"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.callout}"
    padding: "4px 12px"
  filter-chip-active:
    backgroundColor: "{colors.brick-yellow}"
    textColor: "{colors.ink}"
  parts-callout:
    backgroundColor: "{colors.callout}"
    textColor: "{colors.ink}"
    rounded: "{rounded.callout}"
    padding: "10px 12px"
  nav-item-active:
    backgroundColor: "{colors.brick-yellow}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "6px 12px"
---

# Design System: Brickfolio

The visual system below is built in code: tokens in `app/globals.css`, components in `components/ui`. Change the code first, then this file. Product truth lives in `PRODUCT.md`.

## Overview

**Creative North Star: "The parts page of the instructions"**

Brickfolio reads like the page of a building-instructions booklet that lists what goes into a step: calm blue-grey paper, white boxes outlined in thin ink, and big confident counts. A collection is a list of things you have and how many, so the interface borrows the booklet's way of saying exactly that and nothing more.

It is an Operate surface: a tool used at a desk while cataloguing, on a phone at the shelves, and for a quick look at the total. The world lends only type, palette, density and one signature move; navigation and controls stay the standard ones. The collection's own photos and numbers carry the page.

Rejected on purpose: the grey SaaS dashboard (a row of KPI tiles, accent-topped cards, a blue button on white), kicker labels above headings, cards inside cards, and toy-box costume (studs, primary-colour confetti).

**Key Characteristics:**
- Blue-grey paper ground; white parts callouts with a 1.5px ink outline.
- One ink header band; brick yellow only for the primary action and whatever is selected.
- Archivo throughout, with heavy, wide tabular numerals for values and set numbers.
- Counts written the booklet way: `2x`.

## Colors

Cool paper and ink, with one warm signal.

### Primary
- **Brick Yellow** (#f6c343): the primary action (Add set, Save), the active nav item, active filters, the selected segment, text selection and the last point of the value chart. Always with ink text on it (10:1). Never decorative.

### Neutral
- **Booklet Paper** (#e3eaf0, night #0f171d): the page ground.
- **Callout White** (#ffffff, night #17222b): callouts, dialogs, inputs, chips.
- **Ink** (#14212b, night #e8eef3): text and numerals. Ink 2 (#364552) secondary text, Ink 3 (#52626f) captions and labels (4.9:1 or better on every ground), Ink 4 (#8796a3) decoration only, never text.
- **Ink Outline** (#2b3a46, night #5d7282): the 1.5px callout outline. **Rule** (#c9d4dd) for dividers, **Rule Strong** (#7d8e9c, 3:1) for input and control borders.
- **Header Ink** (#14212b, night #0a1116): the header band, text on it #e3eaf0 (`on-header`). The brand and hovered header text are white (`on-header-strong`), and a header button's hover fill is 10% white (`header-hover`).
- **Photo Tile** (#f5f7f9, night #edf1f4): behind set and part photos. Stays light at night because BrickLink photos have white backgrounds. A chip or field on it is white in both themes (`tile-raised`).
- **Scrim** (black at 50%, night 65%; `scrim`): the dimmed page behind dialogs, sheets and the phone menu (`bg-scrim`, or `backdrop:bg-scrim` on a native `<dialog>`).

**Tokens only.** Views use these tokens (`bg-surface`, `text-fg-3`, `bg-scrim`, `text-on-danger`), never `black`, `white` or a hex value; a colour with a job gets a token in `app/globals.css`, with its night value. A test (`components/ui/kit/tokens.test.ts`) enforces it. The exceptions are colours that mean a physical colour, not a theme role, each listed in that test with its reason: the black scrim and white marks over the live camera picture (`scan/Scanner`), and the hex values the browser's theme colour, the web app manifest and the generated app icon need, where CSS variables don't work.

### State
- **Link / Focus Blue** (#1d5aa0, night #8fbdf2): inline links and the keyboard focus ring. On the header band the ring is Brick Yellow.
- **Ok** (#146c43 on #e1f3e8): New condition, gains. **Warn** (#8a4b00 on #fdf0d9): Partial, missing pieces. **Danger** (#b42318 on #fde8e6; solid #c8321f with white text, `on-danger`): lookup errors, losses, confirm-delete.

### Named Rules
**The One Signal Rule.** Brick Yellow marks what you can do next or what is selected, nothing else. If two yellow things compete on a screen, one of them is wrong.

**The Source Rule.** Every money figure says where it came from (BrickLink sold prices, a retailer offer, a BrickEconomy estimate, stored or live) within one line of it. Sources are listed side by side, never averaged into one number.

## Typography

**Display, body and numerals:** Archivo (with ui-sans-serif, system-ui), loaded through `next/font` with its weight and width axes.

**Character:** one workhorse sans that turns into a poster face for numbers: values and set numbers are set extrabold and 112–115% wide, everything else at normal width.

- **Value** (3.75rem / 800 / 115% wide): the collection's Est. Value on the Sets page. One per page.
- **Step numeral** (1.875rem / 800 / 115% wide): the set number heading each set card, like a step number in a booklet.
- **Page title** (1.875rem / 800 / 110% wide).
- **Title** (1rem / 600): set names, dialog titles.
- **Body** (0.875rem / 400): UI text, buttons, inputs.
- **Caption** (0.75rem / 400): meta lines and sources.

All numerals are tabular. No uppercase micro-labels; labels are sentence case in Ink 3.

## Layout

- One shell: the ink header band (badge, name, nav, theme toggle) and a 1280px page with 16px gutters on phones, 24px from 640px. Phones swap the header nav for a menu button that opens a side panel with every page (`components/shell/MobileMenu`, shadcn `sheet` from the right on Base UI: `min(20rem, 85vw)` wide, full height, Scrim backdrop; Escape, a tap outside, a link, a route change or the screen reaching 640px close it); the theme switch and account link move into it. While it is open, ⌘K, Ctrl+K and `/` don't open the command palette (as over a form's dialog); its **Search** row closes the menu and opens the palette.
- The command palette (`components/shell/CommandPalette`, shadcn `command` in a `dialog`): ⌘K / Ctrl+K, `/`, a search icon in the header from 640px, and **Search** at the top of the phone menu. A callout-white dialog with the one dialog shadow; the highlighted result is Muted (like a hover), not Brick Yellow, since it isn't a selection yet.
- The Sets page reads top to bottom: title and actions; the value with its history; search, sort and view; filter rows; the set grid.
- On phones the value collapses to one line with its change, so search is in the first screen; the filters are one **Filters (n)** button that opens a sheet from the bottom with every group wrapped (Clear all, Show N sets); from 640px the groups sit inline and wrap. Each group takes several values (any matches; groups combine), and the chosen ones show as removable Brick Yellow chips with Clear all (`components/board/FilterPanel`).
- The set grid has no card chrome: 24px column gap, 40px row gap, so each set is grouped by space, not boxes.
- Spacing steps: 4, 8, 16, 24, 40px. More space above a group than inside it.

## Elevation & Depth

Flat print. Depth comes from paper versus white callout and the ink outline, not shadows. The only shadow is on dialogs (`0 10px 30px -12px rgb(0 0 0 / 0.18)`), which also dim the page behind.

## Shapes

- **Callout** 10px: parts callouts, filter chips.
- **Card** 14px: photo tiles, dialogs, panels like the filter-less empty state.
- **Control** 8px: buttons, inputs, selects, banners.
- **Chip** 6px: status chips.
- Lines: 1.5px ink outline for callouts, 1px rule for dividers and inputs.

## Components

All shared UI lives in `components/ui` (`import { Button, Callout, … } from '@/components/ui'`). Views compose these; they don't write their own button, card or dialog classes.

| Component | Use it for | Variants / props | Notes |
| --- | --- | --- | --- |
| `Callout` | The signature: what you have and how many (a set's value, a parts list) | `className` | White, 1.5px ink outline, 10px corners. Not a layout container; never inside a bordered card. |
| `Count` | Quantities | `n` | Renders `2x`, bold, tabular. |
| `Button` | Every action | `variant` primary · secondary · ghost · danger · link · danger-link; `size` sm · md; `icon`; `loading` | One primary per view. `danger-link` for inline destructive text actions (Remove, Delete, Revoke). Defaults to `type="button"`. |
| `IconButton` | Icon-only actions on cards and in the header | `tone` default · danger; `label` required | `label` is the accessible name and its `Tip`. |
| `Tip` | Naming an icon, or showing a value that's cut off or needs its source | `label`, `side`, `describe`, `whenCut` (only while the child overflows) | `<Tip label="…">{child}</Tip>`; shadcn `tooltip` (Base UI). The tooltip mounts on first hover, focus or tap, so long lists stay fast. Inverse ink with On-inverse text, Chip radius, no shadow: ink in light, light ink at night, so it stands out on either page. Hover, keyboard focus and a tap (the tap still acts); hides on the next tap, Escape or scroll. Never the HTML `title` attribute, which phones never show (a test enforces it). A plain element child is made focusable. |
| `FilterChip` | Toggling a filter | `active` | Selected = Brick Yellow; shows count and value. |
| `Segmented` | 2–4 exclusive views (Cards/Table, Sold/Bought) | `options`, `label` | Selected = Brick Yellow. shadcn `toggle-group` (Base UI): one Tab stop, arrow keys between the options, `aria-pressed`; pressing the selected option keeps it. |
| `SearchInput`, `Select`, `field` | Inputs | — | Rule Strong border, white fill. |
| `Combobox` | A list that can run past about 12 entries or needs typing (locations, themes and series, colours) | `options` (`value`, `label`, `hint`), `value` / `defaultValue`, `onChange`, `label`, `name`, `placeholder`, `allowCreate`, `onCreate` | A `field`-look button opens a popup with a search box (Base UI combobox): type to filter, arrows, Enter, Escape. Callout white, 1.5px ink outline, Control radius, the dialog shadow; the highlighted row is Muted. `name` posts the value through a hidden input. `allowCreate` offers what was typed (`onCreate` can save it first, as `LocationPicker` adds a location). Inside a native `Dialog` it renders in that dialog. Short lists keep the native `Select`: phones show the system picker. |
| `DatePicker` | Dates | `value` / `defaultValue` (YYYY-MM-DD), `onChange`, `label`, `name`, `required`, `min` | From 640px a `field`-look button opens a calendar popover (shadcn `calendar`, loaded on first open); the week starts on the browser locale's first day; a clear button empties it. Below 640px it is the native date input. Posts the same YYYY-MM-DD string. The chosen day is Brick Yellow. |
| `Chip` | Read-only status | `tone` ok · warn · danger · info · neutral · primary | Text must make sense without the colour. |
| `Banner` | Errors, warnings, persistent state, and results to read or copy (a reset link, a new token, an import's counts) | `kind` ok · error | `role="status"` / `role="alert"`. A short "it worked" is a toast instead. |
| `toast` | Short successes: Saved, Added …, Removed …, Copied | `toast.success(text)`, `{ description, duration }` | Sonner, mounted once (`ToastHost` in the root layout). Callout white, 1.5px ink outline, Control radius, the dialog shadow; Brick Yellow only for an action button. Bottom-centre on phones, bottom-right from 640px, clear of safe areas, in the top layer above the phone menu. A polite live region: read out, never takes focus. |
| `Confirm`, `confirmAction` | Asking before anything that loses data and can't be undone | `title`, `body`, `confirmLabel`, `cancelLabel`, `tone` danger · default, `onConfirm` | `<Confirm …>{trigger}</Confirm>` wraps a button; `await confirmAction({…})` returns true or false in an event handler (`ConfirmHost` in the root layout). Base UI alert dialog; `danger` gives a red button and starts focus on Cancel. Never the browser's `confirm()`. Not for actions that can be undone. Inside a native `Dialog` it renders in that dialog; a two-step footer (Keep / Remove) works there too. |
| `EmptyState`, `Skeleton`, `PageSkeleton` | Nothing yet, loading | — | Empty states name the next step. |
| `Dialog` | Forms and the parts list | `title`, `size`, `tall`, `footer` | Native `<dialog>`. |
| `DataTable` | Lists people and sets with search, sorting and paging | `columns` (TanStack `ColumnDef`s; a string `header` sorts; `meta`: `className`, `label`, `sticky`), `data`, `rowId`, `label`, `search`, `initialSort`, `pageSize` (0 = no paging), `empty`, `stickyFirst`, `toolbar`, `sorting` + `onSortingChange` (controlled: the caller sorts), `columnsMenu` (`storageKey`), `stickyHeader` | shadcn's data-table pattern on `./table`. In a white card with a rule border; on phones it scrolls sideways with the first column (or `meta.sticky` ones) pinned. **Columns** hides columns, saved in localStorage. `stickyHeader` scrolls it in a screen-high frame with the header row fixed. |
| `Menu`, `MenuTrigger`, `useMenuHandle` | A row's actions behind one ⋯ button; a short list of choices (Columns) | `label`, `items` (actions with `icon`, `tone: 'danger'`, `disabled`; checkboxes; `'separator'`), `heading`, `trigger` | shadcn's `dropdown-menu` (Base UI): callout white, 1.5px ink outline, no shadow; the focused item is Muted, Remove is Danger. A long table shares one menu (`useMenuHandle`, a `MenuTrigger` per row). Remove still asks with `confirmAction`. |
| `Stat` | A single labelled figure inside a callout | `label`, `value`, `note`, `tone` | Never in a row of tiles. |
| `LayoutGrid` (`components/layouts`) | The MILS layout editor | `cols`, `rows`, `modules`, `selectedId`, `moving`, `needs` | An SVG in studs (a module is 32), so sizes are true to scale; 64px a module at least, scrolling in its own frame. Empty squares are dashed Rule Strong on Subtle; modules are callouts (Surface, 1.5px Ink Outline); roads are Muted with a dashed Ink 4 centre line; only the selection is Brick Yellow. One square or module is in the tab order at a time (arrow keys move it). |

### shadcn and Base UI underneath

New components come from [shadcn/ui](https://ui.shadcn.com) (`npx shadcn add <name>`, configured in `components.json`: style `base-nova`, so the behaviour comes from [Base UI](https://base-ui.com)). shadcn copies the source into `components/ui/<name>.tsx` (lowercase), where we own and restyle it; our hand-written kit above lives in `components/ui/kit/` (PascalCase) and `@/components/ui` stays the one import for views. shadcn's variable names are pointed at our tokens in `app/globals.css`, never given colours of their own: `--background` → paper (`--canvas`), `--foreground` → ink (`--fg`), `--card` and `--popover` → callout white (`--surface`), `--primary` → Brick Yellow with `--primary-foreground` → `--on-primary`, `--secondary` → `--subtle`, `--muted` and `--accent` → `--muted`, `--muted-foreground` → Ink 3, `--destructive` → `--danger`, `--border` → rule (`--line`), `--input` → rule strong, `--ring` → focus blue, `--radius` → Control (8px), and the chart and sidebar variables likewise. They are references, so both dark modes follow automatically. shadcn's base layer (border colour on every element, body colours, font) and its radius scale are left out, so nothing changes until a component is used. Everything in this file still applies to shadcn components: flat print (remove their shadows except on dialogs), Brick Yellow only for the primary action and the selection, Archivo, and our radii; restyle a generated component rather than accept its defaults.

Which `@/components/ui` exports run on shadcn / Base UI, and which stay ours (#108). Views import the same names either way.

| Export | Decision | Why |
| --- | --- | --- |
| `Button`, `buttonClass` | Keep | Our six variants and padding sizes differ from shadcn's height-based sizes, and Base UI's button adds nothing to a native `<button>`. `buttonClass` also styles links. |
| `IconButton` | Keep | Already Base UI underneath, through `Tip`. |
| `Card`, `Chip`, `FilterChip`, `Banner`, `Callout`, `Count`, `Stat`, `Logo`, `EmptyState` | Keep | Our design, static markup. `FilterChip` is a native `aria-pressed` button. |
| `Skeleton`, `PageSkeleton` | Keep | The same as shadcn's skeleton, already without motion when reduced motion is asked for. |
| `SearchInput`, `field` | Keep | Native inputs; `field` is a class string used across forms. `input-group` would change the markup for nothing. |
| `Select` | Keep | The native select stays for short lists: phones show the system picker. |
| `Segmented` | shadcn `toggle-group` (Base UI) | One Tab stop with arrow keys (roving focus, the WAI-ARIA toolbar pattern). Same props, `role="group"`, `aria-label`, `aria-pressed` and look (screenshots identical); `toggle.tsx` and `toggle-group.tsx` restyled to our tokens. |
| `Dialog` | Keep (native `<dialog>`) | `Tip`, `Combobox`, `DatePicker` and `Confirm` render inside the open `<dialog>`, `ToastHost` re-raises over it, and the command palette's shortcuts check for it. Moving 20+ forms to a Base UI dialog would change focus, Escape and stacking for all of them. |
| `Tip`, `Confirm`, `confirmAction`, `toast`, `Menu`, `Combobox`, `DatePicker`, `DataTable` | Already shadcn (Base UI or Sonner) | Stage 1 (#103 to #106). |
| `cx` | Keep, as an alias of `cn` | About 20 files use it; it is already `cn` inside. |
| `MobileMenu` (shell) | shadcn `sheet`, `side="right"` | Base UI's focus trap, Escape and outside press, and the trigger's `aria-expanded` / `aria-controls`. Looks the same as the old `<dialog>` (screenshots identical). |

## Do's and Don'ts

**Do:**
- Put the number first and its source right under it.
- Write counts as `1x`, `24x · +2 spare`.
- Let empty pages show only their empty state and the next step.
- Keep photo tiles light in both themes.

**Don't:**
- Build a row of big-number tiles, or a big number over a label over supporting stats with an accent.
- Put a label above a heading, or number sections that aren't a sequence.
- Put a callout inside a bordered card, or border the set cards.
- Use Brick Yellow for decoration, or blue for the primary action.
- Use studs, bricks or primary-colour confetti as ornament.
- Use uppercase micro-labels or monospace for set numbers.

## Feature roadmap

### P0: before the public launch
1. ~~Set detail page~~ Shipped: `/sets/[setNo]` with photo, value callout and price history, parts list with counts, notes, edit and remove. Cards and table rows link to it. The 3D and step views shipped too (upload an LDraw model; parts from `LDRAW_LIBRARY_DIR` / `LDRAW_LIBRARY_URL`).
2. ~~First-run checklist~~ Shipped: the empty Sets page walks through keys → first set → sync.
3. ~~Demo data~~ Shipped: `npm run seed`, used for the screenshots, the README tour GIF and demo mode (`DEMO_MODE=on`).
4. ~~Loading skeletons~~ Shipped. BrickLink errors now say what's wrong (daily limit used up, keys rejected, token registered for another IP, unknown item), and a sync stops its BrickLink calls once the daily limit is reached. Still to do: friendlier database error states.

### P1: what collectors ask for
- ~~Wishlist~~ Shipped: `/wishlist` and `/api/v1/wishlist`, target prices, an "under target" alert, priced in the daily sync, and "Got it" moves a set into the collection. Alerts shipped too: webhook (ntfy, Discord, JSON) after each sync, and a count on the Wishlist tab.
- ~~Minifigures~~ Shipped (0.5.0): `/minifigs` with BrickLink prices, and a Collectible Minifigures checklist per series from Rebrickable. Still to do: minifigs in the CSV export and the collection history.
- ~~Themes and subthemes~~ Shipped (Rebrickable phase 1): theme filter on the Sets page, theme and minifig count on cards.
- ~~Value vs. retail~~ Shipped (Brickset): retail price and gain % per set and for the collection.
- ~~Retirement watch~~ Shipped (Brickset): Retiring/Retired chips on sets and wishlist items, and an Availability filter.
- ~~Quick add~~ Shipped (0.5.0): **Paste a list** and `POST /api/v1/sets/bulk`. ~~Barcode scan~~ Shipped (0.7.0): `/scan`, one at a time or many in a row, saved barcodes, optional CompareTheBricks and BrickEconomy lookups. Shipped (0.8.0): offline scanning (service worker, saved barcodes on the device, an outbox), the community barcode list (CC0 file in the repo, reviewed by PR), minifigure box codes (Data Matrix, L-Scan table), and reading the set number from the box (OCR). Still to do: USB/Bluetooth barcode scanners, minifigure codes resolved offline, and automatic trust rules for community submissions.
- ~~**Read-only share link**~~ for showing a collection without giving out access (shipped, see Next ideas #1).

### P2: bigger bets
- ~~What can I build~~ Shipped (`/build`): alternate builds of owned sets, Rebrickable MOCs and your own builds, matched against set parts and loose parts, with reservations and a Wanted List export. Still to do: official sets as builds.
- ~~Part-out value~~ Shipped (0.5.0): set pages show part-out vs. complete from cached BrickLink part prices, priced within the daily budget.
- ~~Missing parts list~~ Shipped: mark missing parts on a set's page; Missing % is computed from them and they export as a BrickLink Wanted List. Weighted by part price once 90% of the set's pieces are priced (0.5.0).
- ~~3D model viewer~~ Shipped on the set page.
- ~~**Multiple collections or users**~~ shipped: collections (#49), users and per-collection permissions (#50).

- ~~Retirement Radar~~ Shipped (0.5.0): `/radar`, retiring timeline, growth per year since retiring, Designer Program and SMART Play flags, and retire-soon alerts. ~~Sealed vs. used value gap~~ shipped: both BrickLink guides per set, the gap per set and as a median.

### Next ideas (ranked, November 2026)
Trends behind them: the BrickLink Designer Program is the fastest-growing area of the resale market (about 16% a year against about 6% overall, BrickEconomy mid-2026); 2026 retirement dates were reshuffled across many themes; some SMART Play sets retire early. The order below also follows a gap review: the biggest trust problem in the number is condition blindness (sealed vs. built), and the biggest technical limit is the BrickLink call budget.

Already shipped from earlier lists: ~~Designer Program tracker~~ (0.6.0, still to do: fill projects automatically if BrickLink offers a feed), ~~MCP server~~ (0.6.0, still to do: OAuth for a claude.ai connector and opt-in write tools), ~~Insurance and valuation report~~ (0.6.0; photos optional since the image cache).

1. ~~**Read-only share link**~~ Shipped: `/share/<token>`, hashed tokens, opt-in values, locations and notes, a Funnel overlay and Access bypass rules. ~~Image cache~~ shipped too: share pages and offline scanning show photos from `/data/images` (R2 on Cloudflare), not BrickLink. Still to do: move the rest of the app's photos to the cache, and photos in the valuation report.
2. ~~**Copies, not just quantities.**~~ Shipped: a `set_copies` table (status, condition, location, dates, cost basis, gift with purchase, per-copy value, `collection_id` for step 10), with missing parts per copy. `sets.qty`, `condition`, `location` and `missing_pct` were dropped with `ALTER TABLE DROP COLUMN` (migration 0025, after the 0.9.0 backfill; no table rebuild).
3. **One identifier table and a local catalog.** See [Identifiers](#identifiers). ~~Ingest Rebrickable's daily CSVs~~ Shipped (#37): `lib/service/rbcatalog.ts` streams themes, sets, parts, colours, elements, inventories and inventory_parts into `rb_*` tables (`REBRICKABLE_CATALOG=full`, Docker), writing only changed rows (upserts with a `where` on changed columns; inventories rewritten only when their parts' hash changes) and fetching each file at most daily with ETags. Elements become `identifiers` rows (`lego_element` → `<blPart>:<blColour>`) through the part and colour map. On D1 (`owned`) only themes, colours and the owned, wishlisted and alternate-build sets are kept. Set parts lists moved to Rebrickable in #38; Rebrickable → BrickLink minifigure numbers learned there are shared through the community list (`minifigNumbers`, #85), where a pair learned from BrickLink's own list beats a community one.
4. **Prices from several sources, and the sealed vs. used gap.** ~~One price table~~ Shipped: `price_observations` holds every price, Est. Value comes from one primary source (Settings → Value source), and the set page lists the other sources. See [Prices from several sources](#prices-from-several-sources). ~~New vs. used gap~~ Shipped too: the other guide is fetched weekly with one price call per set (`lib/service/other-guide.ts`, within a shared `Budget`), the set page shows both with the gap, and Radar shows it per set and as a median. Calls freed by step 3 will go to it.
5. ~~**Loose-parts lots and build allocations.**~~ Shipped: `part_lots` (`lib/service/lots.ts`; BrickLink XML and Rebrickable CSV in `lib/service/partfile.ts`, Rebrickable numbers mapped through the identifiers map), parted-out copies become lots, and `part_allocations` reserve lots for builds (`lib/service/allocations.ts`, whose `availability()` is the one count of set parts, free lots and reservations, used by `/build` and layouts). `builds.kind` adds MOCs and your own builds (`source_set_no` is `''` for them rather than null, so `builds` is never rebuilt). Originally: Storage locations for parts outside sets (a `part_lots` table: part, color, qty, location, source bin or set copy), filled by BrickLink XML or Rebrickable CSV import and by marking a copy "parted out". Builds reserve parts from it, so parts set aside for a MOC don't count as free in "What can I build?".
6. **Brickognize photo scan** to add minifigs (now) and loose parts (after step 5) from a phone. Off unless turned on, since photos go to a third party.
7. ~~**Retailer deal alerts**~~ Shipped: your own flows (example: `docs/examples/n8n-retailer-offers.json`) post `offer` prices to `POST /api/v1/prices` (`lib/service/offers.ts`, idempotent via `lib/service/idempotency.ts`); the wishlist's "under target" alert also reads the lowest offer from the last `OFFER_MAX_AGE_DAYS`, once per offer, kept apart from the BrickLink alert (`wishlist.offer_alerted_at`). Offers are never a value. No scraping inside the app.
8. **More value sources:** ~~BrickOwl~~ not possible (#45): Brick Owl doesn't offer its prices (`catalog/availability`) to third-party tools, and its API terms forbid AI-generated code. BrickEconomy (a client in `lib/brickeconomy/` writing price rows, shown next to the primary value) is deferred: its API needs a Premium subscription for each user, and its reference and terms are only visible to Premium members (#46).
9. ~~**MILS / layout planner**~~ Shipped: `/layouts`, a 2D grid of 32 × 32-stud modules (plain, road, corner, T, crossing, custom; single, double or quad; turned in 90° steps), each linked to set copies and builds, one module per copy or build (`lib/layouts.ts` for the grid maths, shared by the editor and `lib/service/layouts.ts`). The combined "what I still need" list and its Wanted List shipped too (`layoutNeeds`): builds' whole parts lists plus set copies' missing parts. It reads step 5's free lots and reservations through `availability()`, and **Reserve from loose parts for every build** reserves for each build on it. 3D rendering of the layout comes later, if at all. MILS is a community standard, not licensed data.
10. ~~**Multiple collections**~~ Shipped (#49): a `collections` table (id 1 "My collection" seeded, everything backfilled to it), `set_copies.collection_id` and `minifigs.collection_id` (no FK, checked in `lib/service/collections.ts`; a figure has one row per collection, unique on `(collection_id, fig_no)`), `share_links.collection_id` and `collection_history` (the global `history` stays the "All" series). The selected collection is the `bf_collection` cookie (`currentCollection()` in `lib/session.ts`), so server components render filtered; REST and MCP take `collection`. Sets, minifigs, history, Radar, What can I build?, parts search, exports, the report and share links are scoped; the wishlist, store, orders, Designer projects, loose parts, barcodes and prices stay shared. ~~**Then users**~~ Shipped (#50): `users`, `collection_members` (viewer, editor, owner) and `api_tokens.owner`; `ADMIN_USERS` names admins (unset = everyone, as before). `lib/service/permissions.ts` resolves an identity to its access; `api(need, …)` and `act(need, …)` make every route and action declare what it needs, collection checks happen inside, and reads are cut to the caller's collections (`ReadScope` can be a list).

### Identifiers
One `identifiers` table maps every ID scheme to one item, replacing `set_barcodes` and the inline Rebrickable → BrickLink mapping in `lib/rebrickable/client.ts`.
- **Kinds:** set, minifig, part, color, element.
- **Schemes:** `lego` (75192), `bricklink` (75192-1, sw0001, 3001), `rebrickable` (fig-000123), `brickset`, `brickowl`, `brickeconomy`, `ldraw` (3001.dat), `gtin` (UPC/EAN), `lego_element` (element ID = part + color).
- **Canonical key:** the BrickLink ID, because prices and missing parts use it. Every other ID maps to it.
- **Other columns:** source (user, community, rebrickable, brickset, …), verified, region, source ref, timestamps.
- **Not one-to-one:** a UPC can cover regional boxes, parts are many-to-many (BrickLink merges molds Rebrickable splits), and element IDs map to a part + color pair. So the unique key is (kind, scheme, value, canonical ID, source), as in `set_barcodes` today.
- **Filled from:**
  - Rebrickable API `external_ids` (colors in one call, parts in about 60 pages). Rebrickable's CSVs carry no BrickLink IDs (checked November 2026).
  - Rebrickable `elements.csv` for element IDs.
  - Brickset.
  - ~~BrickOwl's ID lookup~~ (not used: see #45).
  - Your scans.
- **Barcode details and the community list:** provider details for barcodes (name, year, image) go in a small side table. The community barcode file and its review by PR don't change.
- **Box codes:** minifigure box codes stay in `minifig_codes`; they need the factory letter and year digit.
- **One lookup:** every import, export and scan resolves IDs through one function.

### Prices from several sources
Shipped: one `price_observations` table holds every price the app knows (`lib/service/prices.ts`).
- **Row:** the item (kind + canonical ID), source, type, condition (N/U), currency, amount, sample size, date and link.
  - **Sources:** bricklink, brickowl, brickeconomy, brickset, retailer:<name>, manual.
  - **Types:** sold average, asking, estimate, retail, offer.
- **Est. Value:** comes from one primary source, chosen in Settings (BrickLink by default). The set page lists the other sources next to it, each with its label, sample size and date. Sources are never blended.
- **History:** keyed by the canonical ID, not a row ID, so it survives removing and re-adding a set. One row per item, source, type, condition, currency and day.
- **Minifigures** stay valued from BrickLink for now; the setting covers sets.
- **Migration:** `price_snapshots` and `minifig_price_snapshots` moved in as BrickLink sold rows (labelled with the Settings currency, as they had none of their own). `part_prices` stays as it is (a high-volume cache, not history).
- **What's then just a query:** the sealed vs. used gap, deal alerts and a second marketplace.

## Integrations

| Service | What it adds | Access | Notes |
| --- | --- | --- | --- |
| **Rebrickable** | Themes, minifigs, LDraw part IDs, set lists and part lists, alternate builds and "can I build it" checks | Free API key, user token for collection sync | Best second data source. Two-way sync of set lists lets people keep using Rebrickable. Credit Rebrickable where its data is shown. |
| **LDraw** | Open 3D parts library and the Official Model Repository (OMR) of set models | Files from ldraw.org | Library is CC BY 2.0: add attribution to `NOTICE`. Render in the browser with three.js `LDrawLoader`. Only sets in the OMR, or with community models, will have a 3D view. |
| **LeoCAD** | Open-source (GPL) desktop builder that opens LDraw files | Link out, no API | Offer "Download .mpd" and "Open in LeoCAD / BrickLink Studio" on the set page. Don't bundle GPL code into this Apache-2.0 app. |
| **Brickset** | Retail prices by region, launch and retirement dates, instructions links, owned/wanted sync | Free API key, user hash for collection sync | Powers value vs. retail and retirement watch. |
| BrickOwl | Second marketplace | API key | Not possible (#45): prices aren't available to third-party tools, and the API terms forbid AI-generated code (store and orders too). |
| Brickognize | Recognize a part, set or minifig from a photo | Public API | Later: phone "scan to add". |
| BrickEconomy | Value estimates and growth; already an optional barcode lookup (unverified) | API key with a Premium subscription | Deferred (#46): needs the API reference and terms, which only Premium members can see. |

### How Rebrickable works with BrickLink
- **BrickLink = money.** Sold prices, Est. Value, value history, store and orders come only from BrickLink. Rebrickable has no price data.
- **Rebrickable = catalog.** Phase 1 (shipped): with `REBRICKABLE_API_KEY` set, the daily sync stores the theme list and each set's theme and minifigure count (`lib/rebrickable/client.ts`, `lib/service/catalog.ts`). A set is matched once; later syncs only check new sets. Set numbers are the same format on both sites (`10280-1`).
- **Next phases**, each improving values indirectly:
  1. ~~Parts lists from Rebrickable~~ Shipped (#38): `rebrickableParts()` in `lib/service/parts.ts` takes a set's inventory from the local catalog (#37) or `/lego/sets/{no}/parts/`, maps it through `identifiers`, merges spares into `extra`, and adds minifigs. Rebrickable gives no BrickLink minifig numbers: a set with an unknown figure takes BrickLink's MINIFIG lines from the same `subsets` call and `pairFigs()` remembers the certain pairs (last one left, unique quantity, mutual clear name match) as `identifiers` (minifig, rebrickable, source bricklink), so the map grows with each collection; a figure neither side can place stays `mapped: false`. BrickLink's `subsets` is the fallback (unknown set, or over `REBRICKABLE_PARTS_MAX_UNMAPPED`). `set_parts.source`/`mapped` and `sets.parts_source` record it; unmapped lines are left out of part-out, owned parts and Wanted Lists. A refresh keeps the list's source while parts are marked missing and never drops a mark.
  2. ~~A part and color ID map~~ Shipped: Rebrickable `external_ids` → BrickLink and LDraw, stored in the `identifiers` table (`lib/identifiers/`). The daily sync maps every colour in one call and walks the parts catalog `REBRICKABLE_ID_PAGES_PER_SYNC` pages at a time (`lib/service/identifiers.ts`); each alternate build's parts list adds the mappings it came with. Needed for the 3D viewer and part-out pricing.
  3. Missing parts for Partial sets: price the parts that are actually missing instead of a flat Missing %.
  4. Part-out value: Rebrickable parts list priced with BrickLink's per-part price guide (cached; watch the daily limit).
  5. Set-list sync with a Rebrickable user token, and "what can I build" from the parts you own.
- Rebrickable's free daily CSV downloads (shipped, `lib/service/rbcatalog.ts`) give themes and set themes without API calls, every set inventory on Docker, and LEGO element IDs. They have no BrickLink IDs, so part and color ID maps still come from the API (see [Identifiers](#identifiers)), and element IDs fill in as that map does.

Integration rules: each one is optional and turned on by env vars (like the BrickLink keys today), sits behind its own client in `lib/<service>/`, respects rate limits in the daily sync, and shows its source next to any number it supplies.

## Open-source launch checklist
- ~~README~~ Done: tour GIF, screenshots in both themes and on a phone, feature list, demo data. Still to do: screenshots with real photos.
- ~~`CODE_OF_CONDUCT.md`, `CHANGELOG.md` and a PR template~~ Done.
- ~~Configurable image name~~ Done: `BRICKFOLIO_IMAGE` (defaults to the project's published image).
- ~~Rename the repo~~ The public repo is `brickfolio`, which keeps the LEGO trademark out of the project name (see `NOTICE`).
- Demo mode (`DEMO_MODE=on`) is done. Still to do: host a public demo.
