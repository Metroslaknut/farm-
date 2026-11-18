# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 1. Project Overview

- This is a Full Stack Application.
- Frontend: React / TypeScript.
- Backend: Node.js / Express.
- Database: MongoDB Atlas.
- Follow the existing project architecture.

## 2. Core Development Rules

- Analyze before modifying code.
- Preserve existing UI and UX.
- Do not change existing layout, CSS, colors,
  spacing, or components unless requested.
- Do not refactor unrelated modules.
- Reuse existing components and functions.
- Avoid duplicate code.
- Maintain backward compatibility.

## 3. Context & Token Optimization

- Never scan the entire repository unnecessarily.
- Exclude node_modules, dist, build, coverage,
  .git and generated files.
- Search for relevant files before reading them.
- Read only the necessary files and code sections.
- Do not repeat completed analysis.
- Avoid unnecessary tool calls and verbose outputs.
- Use targeted tests instead of running all tests.

## 4. Development Workflow

1. Understand the requirement.
2. Analyze the existing implementation.
3. Identify affected files.
4. Propose an implementation plan.
5. Wait for approval for major architectural changes.
6. Implement the requested changes.
7. Run relevant tests.
8. Review the changes and report results.

## 5. Database Rules

- Inspect existing schemas before changing them.
- Do not delete existing data.
- Do not rename database fields without approval.
- Validate API input.
- Handle errors consistently.
- Protect sensitive information.

## 6. Code Quality

- Use TypeScript where applicable.
- Follow existing naming conventions.
- Keep components modular.
- Handle loading, empty and error states.
- Avoid unnecessary dependencies.
- Follow existing lint and formatting rules.

## 7. Testing

- Run relevant unit and integration tests.
- Test affected API endpoints.
- Check for regressions.
- Report failed tests honestly.
- Do not claim tests passed without execution.

## 8. Final Report

After completing each task, report:

- Summary of changes.
- Files modified.
- Important implementation details.
- Tests executed and results.
- Remaining issues or limitations.

## 9. Important Restrictions

- Do not modify unrelated files.
- Do not overwrite user changes.
- Do not remove existing features.
- Do not change UI without explicit permission.
- Ask before destructive operations.

## 10. Commands

pnpm 12 monorepo, Node >= 22. If `pnpm` is not installed, prefix with `npx -y pnpm@12.11.2`.

```bash
pnpm dev:api          # API on :4000 (tsx watch; needs MONGODB_URI, JWT_ACCESS_SECRET, MFA_ENCRYPTION_KEY in .env)
pnpm dev:web          # Web on :5173, proxies /api → :4000 (a 502 in the browser means the API is not running)
pnpm dev:mobile       # Expo
pnpm typecheck | pnpm lint | pnpm format:check | pnpm test   # pnpm check = all four
pnpm e2e              # Playwright; needs E2E_CHROME=1 locally. Starts its own API (:4310), web (:5310) and in-memory MongoDB
pnpm --filter @farmplus/api admin:create -- --email <email> --name "<name>"   # needs BOOTSTRAP_ADMIN_PASSWORD
pnpm dev:worker       # worker skeleton (no queue backend yet)
pnpm build            # tsup for api/worker, vite for web
pnpm lint:fix | pnpm format          # auto-fix ESLint / Prettier
pnpm qa:audit         # dependency policy audit (also runs in CI)
pnpm seed:mockup      # mockup data (see memory notes before running against Atlas)
pnpm --filter @farmplus/api db migrate [--apply]   # show / apply pending data migrations
pnpm --filter @farmplus/api db indexes [--apply]   # compare declared vs actual indexes; --apply only creates, never drops
pnpm --filter @farmplus/api env:check              # validate the server env without starting the API
```

CI (`.github/workflows/ci.yml`) runs typecheck → lint → format:check → test → build, then e2e and the
dependency audit as separate jobs.

Targeted runs (preferred over the whole suite):

```bash
cd services/api && npx vitest run test/farms.test.ts -t "part of test name"
cd apps/web     && npx vitest run test/home.test.tsx
cd apps/mobile  && npx vitest run
cd apps/web     && npx tsc -p tsconfig.json --noEmit
E2E_CHROME=1 npx playwright test tests/register-and-social.spec.ts   # from e2e/
```

API tests use mongodb-memory-server (in-memory MongoDB). Do not run them against Atlas.

## 11. Architecture

- **Workspaces.** `apps/web` (React 19 + Vite + react-router, user site and `/admin` backoffice in one app), `apps/mobile`
  (Expo Router), `services/api` (Express 5 + Mongoose, REST under `/api/v1`), `services/worker` (skeleton).
  The `packages/*` packages are named `@farmplus/<name>` and are **source-only TypeScript**, with no build step:
  - `shared-types`: DTOs and permission/role keys
  - `validation`: Zod request schemas
  - `api-client`: typed fetch client used by web and mobile
  - `config`: client-safe constants; Node-only env validation is in `@farmplus/config/server`
  - `i18n`
  - `shared-utils`
- **API module pattern.** Each module is `src/modules/<name>/{*.routes.ts, *.controller.ts, *.service.ts}`, and routers are
  mounted in `src/routes/v1.ts`. Farm-scoped routes nest under `farmsRouter` (`/farms/:farmId/...`), and every handler
  resolves the caller's access through `modules/farms/farm-access.ts` first, which protects against BOLA. Admin
  permissions are defined in `src/rbac/definitions.ts`. Services such as the payment, video, AI and shipping providers
  reach handlers through `AppContext` (`src/context.ts`). Errors come from the helpers in `src/lib/errors.ts`, which
  return a stable `code` that clients translate.
- **Models.** Every model must be listed in `src/db/registry.ts`, and a test enforces this. Changes to existing
  documents or indexes go in `src/db/migrations/index.ts`: forward-only, idempotent, expand→migrate→contract, and
  never edit an applied migration (see `docs/ops/migrations.md`).
- **Security QA gates (`services/api/test/qa/`).** Adding, removing or renaming a route fails `routes.snapshot.txt` and
  the permission matrix snapshot. Review the authorization, then regenerate with `UPDATE_QA_SNAPSHOTS=1`. A route
  that is public or more open than normal must be added to `authz-allowlists.ts` with a reason.
- **Env.** Server env is validated with Zod at startup (`packages/config/src/server.ts`), and the API exits with every
  problem listed. Files load from the repo root, most specific first: `.env.<NODE_ENV>.local` > `.env.<NODE_ENV>` >
  `.env.local` > `.env`. The real process environment wins over all of these. Web exposes only `VITE_*` and mobile only
  `EXPO_PUBLIC_*`. Every variable is documented in `.env.example` and `docs/ops/environments.md`.
  `AUTH_REQUIRE_VERIFICATION=false` and `OAUTH_MOCK=true` are dev/test switches.
- **i18n (TH default, EN).**
  - Shared core: `packages/i18n` provides the formatters (Thai uses the Buddhist calendar and Asia/Bangkok time),
    API error codes → Thai (`apiErrors`) and Zod messages → Thai.
  - Web: `useT('<area>')` with per-area catalogs in `apps/web/src/i18n/messages/*.ts`. Thai and English must have
    identical keys, which `tsc` enforces. The locale is stored in localStorage `farmplus.locale`.
  - Admin: uses `components/admin/i18n.tsx`.
  - Mobile: has its own catalogs in `apps/mobile/src/i18n`, with the locale stored in SecureStore.
  - Any new UI text goes into both languages.
  - Unit tests run in English (`test/setup.ts`); call `setLocale('th')` to test Thai.
  - e2e runs in English via `e2e/language.ts`, except specs that `test.use({ storageState: languageState('th') })`.
- **Auth.**
  - JWT access tokens plus rotating refresh tokens. Admins must use MFA.
  - Google/Facebook sign-in runs server-side (`modules/oauth`): authorization code + PKCE, a single-use state, then a
    2-minute ticket bound to the client verifier.
  - Details: `docs/architecture/auth.md`.
- **Docs.** `docs/architecture/<area>.md` describes each feature area (farms, records, marketplace, orders, finance, …).
  Read the relevant one before changing that area. Ops runbooks are in `docs/ops/`, QA reports in `docs/qa/`, and
  acceptance results in `docs/acceptance/`. README.md lists which "Parts" are web-only, where mobile screens were
  deferred, and which providers are stubbed or untested: there is no real payment provider, and the Anthropic AI
  adapter has not been tested against the live service.
- **Repo state.** The folder is not a git repository, so `git diff` and `git status` are not available for reviewing changes.

## 12. Engineering Skills

Farm+ uses project-specific Claude Code Skills located in `.claude/skills/`.

Available skills:

- `/performance-optimization`: Full-stack performance analysis and optimization.
- `/mongodb-optimization`: MongoDB and Mongoose query/index optimization.
- `/backend-optimization`: Node.js and Express API optimization.
- `/frontend-optimization`: React and Vite performance optimization.
- `/performance-testing`: Benchmarking, load testing and regression testing.

Before implementing a task:

1. Identify the relevant skills.
2. Read the applicable `.claude/skills/<name>/SKILL.md` files.
3. Follow their instructions.
4. Do not read skills unrelated to the task.

Skill usage rules:

- Use the relevant skill when its description matches the current task.
- Read the relevant architecture documentation before changing a feature.
- Use specialized skills for implementation and testing.
- Follow all existing CLAUDE.md restrictions.
- Do not duplicate project instructions unnecessarily.
- Do not automatically execute destructive database operations or production load tests.
