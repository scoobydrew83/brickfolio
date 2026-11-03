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
- **Header Ink** (#14212b, night #0a1116): the header band, text on it #e3eaf0.
- **Photo Tile** (#f5f7f9, night #edf1f4): behind set and part photos. Stays light at night because BrickLink photos have white backgrounds.

### State
- **Link / Focus Blue** (#1d5aa0, night #8fbdf2): inline links and the keyboard focus ring. On the header band the ring is Brick Yellow.
- **Ok** (#146c43 on #e1f3e8): New condition, gains. **Warn** (#8a4b00 on #fdf0d9): Partial, missing pieces. **Danger** (#b42318 on #fde8e6; solid #c8321f): lookup errors, losses, confirm-delete.

### Named Rules
**The One Signal Rule.** Brick Yellow marks what you can do next or what is selected, nothing else. If two yellow things compete on a screen, one of them is wrong.

**The Source Rule.** Every money figure says where it came from (BrickLink sold prices, stored or live) within one line of it.

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

- One shell: the ink header band (badge, name, nav, theme toggle) and a 1280px page with 16px gutters on phones, 24px from 640px. Phones swap the header nav for a bottom tab bar.
- The Sets page reads top to bottom: title and actions; the value with its history; search, sort and view; filter rows; the set grid.
- On phones the value collapses to one line with its change, so search is in the first screen; filter rows scroll sideways with a fade at the edge.
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
| `IconButton` | Icon-only actions on cards and in the header | `tone` default · danger; `label` required | `label` is the accessible name and tooltip. |
| `FilterChip` | Toggling a filter | `active` | Selected = Brick Yellow; shows count and value. |
| `Segmented` | 2–4 exclusive views (Cards/Table, Sold/Bought) | `options`, `label` | Selected = Brick Yellow. |
| `SearchInput`, `Select`, `field` | Inputs | — | Rule Strong border, white fill. |
| `Chip` | Read-only status | `tone` ok · warn · danger · info · neutral · primary | Text must make sense without the colour. |
| `Banner` | Results and persistent errors | `kind` ok · error | `role="status"` / `role="alert"`. |
| `EmptyState`, `Skeleton`, `PageSkeleton` | Nothing yet, loading | — | Empty states name the next step. |
| `Dialog` | Forms and the parts list | `title`, `size`, `tall`, `footer` | Native `<dialog>`. |
| `Stat` | A single labelled figure inside a callout | `label`, `value`, `note`, `tone` | Never in a row of tiles. |

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
4. ~~Loading skeletons~~ Shipped. Still to do: friendlier error states (database, BrickLink rate limit at 5,000 calls/day).

### P1: what collectors ask for
- ~~Wishlist~~ Shipped: `/wishlist` and `/api/v1/wishlist`, target prices, an "under target" alert, priced in the daily sync, and "Got it" moves a set into the collection. Alerts shipped too: webhook (ntfy, Discord, JSON) after each sync, and a count on the Wishlist tab.
- **Minifigures** as owned items, not only as parts inside a set.
- ~~Themes and subthemes~~ Shipped (Rebrickable phase 1): theme filter on the Sets page, theme and minifig count on cards.
- ~~Value vs. retail~~ Shipped (Brickset): retail price and gain % per set and for the collection.
- ~~Retirement watch~~ Shipped (Brickset): Retiring/Retired chips on sets and wishlist items, and an Availability filter.
- **Quick add**: paste a list of set numbers, or scan a barcode or box photo on a phone.
- **Read-only share link** for showing a collection without giving out access.

### P2: bigger bets
- ~~What can I build~~ Shipped (`/build`): alternate builds of owned sets matched against all owned parts, with a Wanted List export. Still to do: official sets and community MOCs beyond alternates.
- **Part-out value**: what a set is worth sold as parts vs. complete, using BrickLink part prices.
- ~~Missing parts list~~ Shipped: mark missing parts on a set's page; Missing % is computed from them and they export as a BrickLink Wanted List. Still to do: weight by part price (needs part-out pricing) rather than piece count.
- ~~3D model viewer~~ Shipped on the set page.
- **Multiple collections or users** (family members, a store vs. a personal shelf).

## Integrations

| Service | What it adds | Access | Notes |
| --- | --- | --- | --- |
| **Rebrickable** | Themes, minifigs, LDraw part IDs, set lists and part lists, alternate builds and "can I build it" checks | Free API key, user token for collection sync | Best second data source. Two-way sync of set lists lets people keep using Rebrickable. Credit Rebrickable where its data is shown. |
| **LDraw** | Open 3D parts library and the Official Model Repository (OMR) of set models | Files from ldraw.org | Library is CC BY 2.0: add attribution to `NOTICE`. Render in the browser with three.js `LDrawLoader`. Only sets in the OMR, or with community models, will have a 3D view. |
| **LeoCAD** | Open-source (GPL) desktop builder that opens LDraw files | Link out, no API | Offer "Download .mpd" and "Open in LeoCAD / BrickLink Studio" on the set page. Don't bundle GPL code into this Apache-2.0 app. |
| **Brickset** | Retail prices by region, launch and retirement dates, instructions links, owned/wanted sync | Free API key, user hash for collection sync | Powers value vs. retail and retirement watch. |
| BrickOwl | Second marketplace for prices and store inventory | API key | Later: lets non-BrickLink sellers use the Store and Orders pages. |
| Brickognize | Recognize a part, set or minifig from a photo | Public API | Later: phone "scan to add". |

### How Rebrickable works with BrickLink
- **BrickLink = money.** Sold prices, Est. Value, value history, store and orders come only from BrickLink. Rebrickable has no price data.
- **Rebrickable = catalog.** Phase 1 (shipped): with `REBRICKABLE_API_KEY` set, the daily sync stores the theme list and each set's theme and minifigure count (`lib/rebrickable/client.ts`, `lib/service/catalog.ts`). A set is matched once; later syncs only check new sets. Set numbers are the same format on both sites (`10280-1`).
- **Next phases**, each improving values indirectly:
  1. Parts lists from Rebrickable instead of BrickLink, saving BrickLink calls from the 5,000/day limit.
  2. A part and color ID map (Rebrickable `external_ids` → BrickLink and LDraw), needed for the 3D viewer and part-out pricing.
  3. Missing parts for Partial sets: price the parts that are actually missing instead of a flat Missing %.
  4. Part-out value: Rebrickable parts list priced with BrickLink's per-part price guide (cached; watch the daily limit).
  5. Set-list sync with a Rebrickable user token, and "what can I build" from the parts you own.
- For large collections, Rebrickable's free daily CSV downloads (themes, sets, inventories) can replace API calls entirely.

Integration rules: each one is optional and turned on by env vars (like the BrickLink keys today), sits behind its own client in `lib/<service>/`, respects rate limits in the daily sync, and shows its source next to any number it supplies.

## Open-source launch checklist
- ~~README~~ Done: tour GIF, screenshots in both themes and on a phone, feature list, demo data. Still to do: screenshots with real photos.
- ~~`CODE_OF_CONDUCT.md`, `CHANGELOG.md` and a PR template~~ Done.
- ~~Configurable image name~~ Done: `BRICKFOLIO_IMAGE` (defaults to the project's published image).
- ~~Rename the repo~~ The public repo is `brickfolio`, which keeps the LEGO trademark out of the project name (see `NOTICE`).
- Demo mode (`DEMO_MODE=on`) is done. Still to do: host a public demo.
