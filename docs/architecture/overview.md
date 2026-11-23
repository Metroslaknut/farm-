# Architecture overview (Part 01)

## Layers

- **apps/web**, **apps/mobile** — presentation only. No business logic, no direct DB access. They talk to the
  API through `@farmplus/api-client`.
- **services/api** — Express REST API under `/api/v1` (plus an unversioned `/health` for infrastructure
  probes). Planned layering per feature: `routes → controllers → services → models`, with Zod validation.
- **services/worker** — background process; `WorkerRuntime` provides a job registry. Redis + BullMQ arrive
  with the first Part that needs queues.
- **packages/** — shared code. `shared-types` (interfaces) ← `validation` (Zod schemas that must satisfy
  those interfaces) ← `api-client`. `config` has a client-safe root export and a Node-only `./server` export.

## Dependency rules

- Apps/services may depend on packages; packages never depend on apps/services.
- Only `services/*` (and Node tooling such as vite.config) may import `@farmplus/config/server`.
- Secrets are read only in services, via the validated env schema.

## Conventions

- ESM everywhere, `strict` TypeScript with `noUncheckedIndexedAccess`, `verbatimModuleSyntax`.
- Error responses use `{ "error": { "code", "message" } }` (`ApiErrorResponse`).
- New env vars: add to the Zod schema in `packages/config/src/server.ts` **and** `.env.example`.
- **"Today" is the Thai calendar day** (Asia/Bangkok, UTC+7) everywhere — between 00:00 and 07:00 the UTC date is still
  yesterday. Helpers in `packages/validation/src/dates.ts`: `thaiToday()` (`YYYY-MM-DD`), `thaiDayStart()` (that day at
  00:00 UTC, to compare with date-only fields such as `weighedOn` and to count whole days), `thaiDayBegins(day)` (the
  instant a Thai day starts, to filter timestamps such as `createdAt`) and `thaiYymmdd()`. Date-only fields stay stored
  at 00:00 UTC. Never use `new Date().toISOString().slice(0, 10)` or `setUTCHours(0)` for "today".
- `pnpm --filter @farmplus/api test:thai-night [HH:MM]` runs the API suite with the clock at that Bangkok time (default
  00:30); `test/thai-dates.test.ts` covers the date rules at 00:30 and 23:30.
