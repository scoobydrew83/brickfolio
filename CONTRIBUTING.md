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

## License

By contributing, you agree that your contributions are licensed under the [Apache License 2.0](LICENSE).
