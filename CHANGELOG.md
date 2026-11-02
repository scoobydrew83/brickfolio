# Changelog

All notable changes are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.2.0] - 2026-11-02

### Added
- Set pages (`/sets/<number>`): photo, value and price history, parts list, notes, edit and remove.
- Wishlist with target prices, an "under target" alert, daily re-pricing, "Got it" to move a set into the collection, and `/api/v1/wishlist`.
- Optional Rebrickable sync for themes, subthemes and minifigure counts (`REBRICKABLE_API_KEY`), with a theme filter.
- Light and dark themes with a toggle, a shared app shell, and a phone tab bar.
- `npm run seed` for demo data.
- What can I build?: alternate builds of your sets from Rebrickable, ranked by how many of their parts you own, with a BrickLink Wanted List of what's missing (`/build`, `/api/v1/builds`).
- Settings → 3D models downloads (and updates) the LDraw parts library into `/data/ldraw` with one click; `npm run ldraw:download` does the same from a terminal.
- Demo mode (`DEMO_MODE=on`): a read-only public demo that fills an empty database with sample data, refuses changes and switches off outside services.
- A tour GIF and refreshed screenshots in the README, and `scripts/screenshots.mjs` to retake them.
- Settings → Rebrickable shows matched sets and builds, tests the key, and runs a Rebrickable-only sync. Sets Rebrickable didn't know are asked again after 30 days, and the daily job runs Rebrickable even without BrickLink keys.
- 3D models from LDraw's Official Model Repository: **Find model on LDraw** on a set's page, and the daily sync fetches models for sets that have none (`LDRAW_OMR_SYNC=off` to stop it).
- 3D model view on set pages: upload an LDraw model, orbit it, and step through the build (`LDRAW_LIBRARY_DIR` or `LDRAW_LIBRARY_URL`).
- Wishlist alerts: one message per drop under target to ntfy, Discord or any JSON webhook (`ALERT_WEBHOOK_URL`), and a count on the Wishlist tab.

### Changed
- New visual design (the "instruction booklet" look): design tokens, shared components in `components/ui`, documented in `docs/design.md`.
- Store and Orders lead with their lists instead of big-number tiles.

### Fixed
- Editing a set no longer drops a location that isn't in Settings.
- Keyboard focus is visible everywhere, including the header.

## [0.1.0]

### Added
- Collection tracking with copies, location, condition and missing %.
- BrickLink sold prices, piece counts, photos and parts lists, refreshed by a daily sync.
- Value history, CSV import/export, REST API with tokens and OpenAPI description.
- BrickLink store inventory and orders.
- Docker (with Tailscale or Cloudflare Tunnel) and Cloudflare Workers + D1 deployments.
