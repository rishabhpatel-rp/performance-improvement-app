# Contributing to PagePulse

## Before opening a PR

1. `npm ci` in the repo root and in `admin-panel/`.
2. `npm run lint`, `npm run typecheck`, `npm run format:check`, `npm test`, `npm run build`.
3. `npm test` in `admin-panel/` plus its lint/typecheck/format checks.
4. Add or update a test for every behaviour change.
5. If the Prisma schema changed, add a migration and run `npm run check:schema`.

## Conventions

- Small PRs; keep refactors separate from behaviour changes.
- Server-only env reads live in `app/lib/env.server.ts`.
- Browser-source files kept as JS are listed in `tsconfig.json`.
- No secrets in code or logs.

## Commit checks

`husky` + `lint-staged` run Prettier and ESLint on staged files. CI runs all
checks above plus the schema drift guard and migration verification.
