# FARM+

Monorepo for the FARM+ platform (Web, Mobile, API, Worker). Status: **Part 01** (foundation) and
**Part 03** (authentication, roles & permissions — see [docs/architecture/auth.md](docs/architecture/auth.md)).
**Part 04** (admin backoffice — see [docs/architecture/admin.md](docs/architecture/admin.md)).
**Part 05** (web design system — see [docs/architecture/design-system.md](docs/architecture/design-system.md)).
**Part 06** (mobile foundation — see [docs/architecture/mobile.md](docs/architecture/mobile.md)).
**Part 07** (farm & animal management — see [docs/architecture/farms.md](docs/architecture/farms.md)).
**Part 08** (breeding, growth, health, feeding & costs — see [docs/architecture/records.md](docs/architecture/records.md)); web UI only, mobile screens deferred.
**Part 09** (community feed, comments, reactions, follows, reports & moderation — see [docs/architecture/community.md](docs/architecture/community.md)).
**Part 10** (short video & live streaming — see [docs/architecture/video.md](docs/architecture/video.md)).
**Part 11** (animal marketplace: listings, offers & negotiation, moderation — see [docs/architecture/marketplace.md](docs/architecture/marketplace.md)).
**Part 12** (orders & shipping: checkout, quotes, shipment tracking, cancellation/refund rules — see [docs/architecture/orders.md](docs/architecture/orders.md)).
**Part 13** (finance: payments, commission rules, ledger, refunds, seller earnings & withdrawals — see [docs/architecture/finance.md](docs/architecture/finance.md)); no real payment provider is integrated yet.
**Part 14** (products marketplace: categories, products, inventory, cart & checkout on the existing order/payment modules, reviews, moderation and compliance gates — see [docs/architecture/products.md](docs/architecture/products.md)); regulated goods such as medicines are off until a compliance review is recorded; web only (no mobile shop screens).
**Part 15** (AI animal assessment: growth, readiness factors, recorded costs, price ranges from authorised data, owner review, validated AI explanation, usage monitoring — see [docs/architecture/ai-assessment.md](docs/architecture/ai-assessment.md)); decision support only, web only, the Anthropic adapter is untested against the live service.
**Part 16** (analytics & reporting: farm and admin dashboards with defined metrics, date ranges and filters, permission-scoped sections, short-lived cache, CSV export mirroring dashboard permissions — see [docs/architecture/analytics.md](docs/architecture/analytics.md)); web only.
**Part 17** (notifications & messaging: in-app notifications with unread counters and preferences, buyer–farm chat with read status, blocking and reporting, authenticated/authorized Socket.IO realtime with recovery — see [docs/architecture/messaging.md](docs/architecture/messaging.md)); web only, single API instance for realtime.
**Part 19** (deployment & release: production environment validation, HTTPS/CORS/headers, health + readiness, structured logs and error reporting, index management, migrations, backup/restore tooling, CI, release workflows, EAS profiles, runbooks — see [docs/ops/](docs/ops/README.md)); staging was **not** deployed (no hosting/Atlas/CI accounts available): the procedure and its verification script are ready.
**Part 18** (security & quality assurance: route-wide authorization/permission matrices, fuzzing of every endpoint, secret-exposure crawl, financial invariants under concurrency, browser end-to-end, load test, dependency policy; 6 findings fixed — see [docs/qa/](docs/qa/README.md)); no independent penetration test yet.
**Part 20** (final integration & acceptance: 20-scenario journey through the API, cross-platform/retry/media contract tests, browser commerce journey, reconciliation; **not** declared production-ready — see [docs/acceptance/final-report.md](docs/acceptance/final-report.md)).
Part 02 was not provided; a minimal MongoDB/Mongoose layer was added in Part 03 for auth only.

## Structure

```
farm-plus/
├── apps/
│   ├── web/              React + Vite + TypeScript
│   └── mobile/           Expo + React Native + Expo Router + TypeScript
├── services/
│   ├── api/              Express + TypeScript (REST, /api/v1)
│   └── worker/           Background worker skeleton (no queue backend yet)
├── packages/
│   ├── shared-types/     Shared TypeScript types
│   ├── shared-utils/     Shared pure helpers
│   ├── validation/       Zod schemas (typed against shared-types)
│   ├── api-client/       Typed fetch client used by Web and Mobile
│   └── config/           Constants (client-safe) + env loading (`/server`, Node only)
└── docs/                 architecture/, database/, api/
```

Packages are named `@farmplus/<name>` and are **source-only** (consumed as TypeScript directly by Vite,
Metro and tsx; the API/Worker builds bundle them with tsup).

## Prerequisites

- Node.js **>= 22** (developed on 26.x)
- pnpm **12.x** — `npm install -g pnpm@12.11.2` (or `corepack enable` if your Node ships Corepack)
- For Mobile: Expo Go (or an iOS Simulator / Android Emulator)

## Install

```bash
pnpm install
cp .env.example .env     # then fill in the required values below
```

The API will not start until these are set in `.env` (it prints exactly what is missing):

```bash
# MONGODB_URI=mongodb://127.0.0.1:27017/farmplus   (local mongod) or your Atlas URI
openssl rand -base64 48   # → JWT_ACCESS_SECRET
openssl rand -base64 32   # → MFA_ENCRYPTION_KEY
```

Create the first super admin (once, after the API env is configured):

```bash
BOOTSTRAP_ADMIN_PASSWORD='choose-a-long-passphrase' \
  pnpm --filter @farmplus/api admin:create -- --email you@example.com --name "Your Name"
```

## Run each application

| App    | Command                                      | URL / notes                                                               |
| ------ | -------------------------------------------- | ------------------------------------------------------------------------- |
| API    | `pnpm dev:api`                               | http://localhost:4000 — `GET /health`, `GET /api/v1/health`               |
| Web    | `pnpm dev:web`                               | http://localhost:5173 — proxies `/api` and `/health` to the API           |
| Mobile | `pnpm dev:mobile`                            | Expo dev server; press `i` / `a` / `w` or scan the QR code in Expo Go     |
| Admin  | `pnpm dev:web` → http://localhost:5173/admin | Sign in with a staff account; admins must enrol MFA first (Security page) |
| Worker | `pnpm dev:worker`                            | Logs startup and idles until SIGINT/SIGTERM                               |

Start the API first so Web and Mobile can show the API health status.
On a **physical phone or simulator** nothing needs configuring in development: the app finds the API on the machine serving the
bundle (port 4000). Override with `EXPO_PUBLIC_API_BASE_URL` in `apps/mobile/.env` (Expo reads env files from the app folder);
production builds require an `https://` value. Start the API with `CORS_ORIGINS` including `http://localhost:8081` only if you use Expo web.

### Production-style run

```bash
pnpm build                       # builds api, worker (tsup) and web (vite)
NODE_ENV=production CORS_ORIGINS=https://your-web-origin \
  pnpm --filter @farmplus/api start
pnpm --filter @farmplus/worker start
```

The Web build output is `apps/web/dist` (static files). Mobile production builds use EAS (not set up yet).

## Quality commands

```bash
pnpm typecheck      # tsc --noEmit in every package
pnpm lint           # ESLint (flat config, typescript-eslint, react-hooks)
pnpm format:check   # Prettier   (use `pnpm format` to fix)
pnpm test           # Vitest: API health, env, crypto/TOTP, auth & RBAC integration (in-memory MongoDB)
pnpm check          # all of the above
```

## Environment & configuration

- All variables are documented in [.env.example](.env.example). Never commit `.env`.
- Server apps load `.env` files from the repo root, most specific first
  (`.env.<NODE_ENV>.local` > `.env.<NODE_ENV>` > `.env.local` > `.env`). **Real process environment always
  wins**, so in production set variables on the host and no file is needed.
- `@farmplus/config/server` validates env with Zod at startup; invalid configuration prints every problem and
  exits with code 1. In production `CORS_ORIGINS` is mandatory.
- Web exposes only `VITE_*` variables; Mobile exposes only `EXPO_PUBLIC_*`. These are public — never put
  secrets in them. Server secrets (DB, JWT, payment) must only ever be read by `services/*`.
- `@farmplus/config` (root export) is client-safe constants; Node-only code lives in `@farmplus/config/server`.

## Health endpoints

```bash
curl http://localhost:4000/health
curl http://localhost:4000/api/v1/health
# {"status":"ok","service":"farmplus-api","version":"0.1.0","environment":"development",
#  "uptimeSeconds":7,"timestamp":"2026-10-11T13:52:48.794Z"}
```

## Assumptions & limitations (Part 01)

- Workspace root is the current folder (`farm+`); package name is `farm-plus`. The folder is not yet a git repo.
- Web and Mobile screens are minimal placeholders that only show API health. Mobile uses the default Expo
  template icons/splash as placeholders (`apps/mobile/assets`) — replace with brand assets.
- Redis/BullMQ, Socket.IO and media storage are intentionally **not** installed yet.
- API tests run against `mongodb-memory-server`, which downloads a `mongod` binary on first use (needs network once).
- See the limitations list in [docs/architecture/auth.md](docs/architecture/auth.md) (no email/SMS provider yet, in-memory rate limits, etc.).
- TypeScript is pinned to `~6.0.3` (matches Expo SDK 57 and the range supported by typescript-eslint);
  TypeScript 7.x is not used for that reason.
- Mobile was verified to start Metro and bundle for iOS/Android/Web; it has not been run on a device/simulator.
