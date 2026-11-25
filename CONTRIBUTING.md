# Contributing

Thanks for helping! Bug reports, fixes and small features are all welcome.

## Before you start

- For anything bigger than a bug fix, open an issue first so we can agree on the approach.
- Keep pull requests focused: one change per PR.

## Setup

```bash
npm ci
cp .env.example .env.local   # BrickLink keys are optional for most work
npm run dev
```

## Checks

CI runs these on every pull request. Run them locally first:

```bash
npm run lint
npm test
npm run build
```

## Guidelines

- Adding or upgrading a runtime dependency? Run `npm run notices` and commit the updated `THIRD_PARTY_NOTICES.md`. A new data source or bundled asset also gets a line in `NOTICE` and the Credits in `README.md` and Settings.

- **One code path for both targets.** Code must run on Node (Docker) and on Cloudflare Workers. Use Web APIs (`fetch`, `crypto.subtle`) over Node-only modules outside `lib/db/node.ts` and `lib/scheduler.ts`. Always `await` database calls: D1 is async.
- **Logic goes in `lib/service`**, so the UI, the REST API and the scheduler share it. Add tests with an in-memory database (see `lib/service/sets.test.ts`).
- **Validate at the edge.** Server actions and API routes parse input with `parseSetInput` and check the user before doing anything.
- **Schema changes:** edit `lib/db/schema.ts`, run `npm run db:generate`, and commit the new file in `drizzle/`. Never edit a migration that has already been released.
- **Next.js 16** has breaking changes from earlier versions. Check `node_modules/next/dist/docs/` rather than relying on older examples (see AGENTS.md).

## Adding a component

Shared UI lives in `components/ui` and views import it from `@/components/ui` (see the Components table in [docs/design.md](docs/design.md)). For a new component, use [shadcn/ui](https://ui.shadcn.com) rather than writing it from scratch:

```bash
npx shadcn add <name>          # e.g. tooltip; writes components/ui/<name>.tsx
npx shadcn add <name> --dry-run   # see which files it would write first
```

- The setup is in `components.json` (Base UI primitives, lucide icons, our aliases). Better Auth UI's registry is configured too: `npx shadcn add @better-auth-ui/<name>`.
- Generated files are lowercase (`components/ui/tooltip.tsx`) and are ours to edit. Our own kit is in `components/ui/kit/`; don't overwrite or rename it.
- Colours come from the tokens in `app/globals.css`. shadcn's names (`bg-background`, `text-muted-foreground`, `border-input`, …) already map to them, so use those or ours, never raw colours, and remove shadows or effects that `docs/design.md` doesn't allow.
- Import the new file by path (`@/components/ui/tooltip`), or export it from `components/ui/index.ts` when it replaces or joins the shared kit.
- Use `cn` from `@/lib/utils` (or `cx` from `@/components/ui`, the same function) to combine classes; the later of two conflicting Tailwind classes wins.
- Attach phone and desktop screenshots, light and dark, to the pull request.

Using an AI agent? `.mcp.json` starts the shadcn MCP server (`npx shadcn@latest mcp`) for Claude Code, and the shadcn agent skill is committed in `.claude/skills/shadcn` (restore or update it with `npx skills add shadcn/ui`; `skills-lock.json` records the version). For other agents, `npx shadcn@latest mcp init --client <cursor|vscode|codex|opencode>` writes their config.

## Community barcodes

`lib/barcode/data/community.json` in the [public repository](https://github.com/scoobydrew83/brickfolio) is the shared list of barcodes and Collectible Minifigures box codes every installation downloads (from its `main` branch). It's CC0, so anyone can use it. To add codes:

1. Scan the boxes in Brickfolio and confirm them: type the set number for an unknown barcode, or pick the figure for an opened minifigure box.
2. **Settings → Barcode scanning → Share my codes** opens a prefilled issue on [scoobydrew83/brickfolio](https://github.com/scoobydrew83/brickfolio/issues), or downloads a file. Add its entries to `community.json` in a pull request there.
3. `npm test` checks the file: valid check digits, set numbers like `75192-1`, 7-digit box codes, and no barcode given to two different sets.

Reviewers merge an entry when one of these holds:
- two people sent it independently;
- it matches the barcode on LEGO's or a retailer's product page;
- it comes with a photo of the box showing both the code and the set number.

**Minifigure numbers** (`minifigNumbers`: `{ "rbFigNo": "fig-012345", "figNo": "lor115" }`) tell every installation which BrickLink minifigure a Rebrickable one is, so parts lists from Rebrickable need no BrickLink call for it. Brickfolio learns these from BrickLink's own parts lists of the sets you own; **Share my codes** offers them with a checkbox (off by default, since they hint at which sets you own). Merge a pair when two people sent it independently, when Rebrickable's or BrickLink's website shows the other number for that figure (Rebrickable's minifigure pages list BrickLink IDs), or when it comes from a figure the contributor owns and checked. One Rebrickable figure given two BrickLink numbers, or two given one, is a conflict: settle it before merging (Rebrickable sometimes splits printed variants that BrickLink lists once).

Never add codes copied from a paid barcode service: those belong to their provider. `scripts/import-lscan.mjs` refreshes the bundled L-Scan table (`lib/barcode/data/cmf-codes.json`, MIT) from a checkout of that project.

## License

By contributing, you agree that your contributions are licensed under the [Apache License 2.0](LICENSE).
