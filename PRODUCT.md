# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
Adult brick-set collectors tracking what they own and what it is worth. Selling is occasional; Store and Orders matter only to the minority who also run a BrickLink store. Many run Brickfolio on their own server (Docker, a homelab, Cloudflare), so the person installing it is usually the person using it.

## Product Purpose
Keep an accurate record of a physical collection (which sets, how many copies, where each one lives, its condition and missing pieces) and know what it is worth today, priced from what sets actually sell for. Success: the collector trusts the number, finds any set in seconds, and never goes back to a spreadsheet.

## Positioning
- **Your data, your server.** Self-hosted: no Brickfolio account, no ads, no tracking. The collection lives in a SQLite file the owner controls; the only outside calls use the owner's own BrickLink (and optional Rebrickable) keys.
- **Open and scriptable.** Open source (Apache-2.0), a documented REST API with tokens, OpenAPI spec, and CSV import/export, so collectors can build their own tools on it.

## Operating Context
- **Desk, cataloguing:** evenings at a computer adding sets, editing location/condition/missing %, importing CSVs, reviewing values.
- **Phone at the shelves:** standing at shelves or storage bins, looking up a set, checking or changing where it lives. Installable as a PWA.
- **Quick value check:** glancing at total value and what changed since the last nightly sync.
- A daily sync runs unattended (default 4 AM); prices and parts lists arrive from BrickLink, themes and minifig counts from Rebrickable when its key is set.

## Capabilities and Constraints
- Sets: set number, name, quantity, location, condition (New / Used / Partial), missing %, notes. BrickLink fills name, year, photo, pieces, part lots, min/avg/max sold price, quantity sold.
- Est. Value = average sold price for the set's condition, less Missing %. Value history is stored daily.
- Parts lists per set and a search across all parts; BrickLink store inventory and orders (sold/bought) for sellers.
- Themes, subthemes and minifigure counts from Rebrickable (optional).
- Auth is delegated to the deployment: none, Tailscale or Cloudflare Access. No built-in accounts.
- Budget: BrickLink allows 5,000 API calls a day; Rebrickable about one call a second.
- Terminology: "set number" (10497, shown without the -1 suffix), "pieces", "minifigs", "sold price", "Est. Value", "location", "Partial".
- Undecided: wishlist, set detail page, 3D model viewer, "what can I build", Brickset retail prices.

## Brand Commitments
- Name: Brickfolio. Not affiliated with the LEGO Group or BrickLink; trademarks are acknowledged in NOTICE and must not be used as the product's identity.
- Existing mark: the yellow 2×2 brick badge (`components/ui/primitives.tsx` Logo, `app/badge.tsx`).
- Voice: plain, collector-to-collector, uses hobby terms without explaining them; numbers always say where they come from.

## Evidence on Hand
- Real data comes only from the user's own collection and BrickLink. There are no testimonials, user counts, press or benchmarks; never invent them.
- Set photos are BrickLink catalog images with white backgrounds.

## Product Principles
1. The number must be trustworthy: always show its source and how it was worked out.
2. Finding a set beats browsing: search, location and condition are first-class.
3. The owner is in control: works offline from big services, exports everything, no lock-in.
4. Quiet by default: the collection is the content; the app gets out of the way.

## Accessibility & Inclusion
WCAG 2.1 AA as the floor: keyboard reachable, visible focus, 4.5:1 text contrast in both themes, usable one-handed on a phone.
