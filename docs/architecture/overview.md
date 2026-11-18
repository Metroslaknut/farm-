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
