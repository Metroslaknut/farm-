# Deployment

FARM+ does not prescribe a hosting vendor. This document defines what each target must provide, how a release flows, and which
guarantees the code and pipeline enforce. Vendor-specific wiring is the one part you add (see "Wiring a host").

## Targets

| Target                   | What runs                                                                        | Requirements                                                                                                                                                      |
| ------------------------ | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Web frontend**         | Static files from `apps/web/dist` (SPA)                                          | Static host + CDN that applies `dist/_headers` / `_redirects` (Cloudflare Pages, Netlify — or copy the generated headers into another host's config). HTTPS only. |
| **API**                  | `node services/api/dist/server.js` (or the image from `services/api/Dockerfile`) | Behind a TLS-terminating load balancer that forwards `X-Forwarded-Proto`, supports WebSocket upgrade (Socket.IO), health probes, graceful drain.                  |
| **Worker**               | `node services/worker/dist/index.js` (or its image)                              | One instance. No inbound traffic; optional `WORKER_HEALTH_PORT` liveness. No queue yet.                                                                           |
| **Database**             | MongoDB Atlas (replica set, M10+ for continuous backup)                          | Private endpoint or IP allow-list (never `0.0.0.0/0`); TLS only; separate users per purpose (below).                                                              |
| **Object storage + CDN** | Photos/documents/video files                                                     | The API stores **links**, not files; list the CDN host in `MEDIA_ALLOWED_HOSTS` (API) and `WEB_MEDIA_HOSTS` (web CSP).                                            |
| **Streaming**            | Cloudflare Stream (`VIDEO_PROVIDER=cloudflare`)                                  | Webhook secret set; playback host in `WEB_MEDIA_HOSTS`.                                                                                                           |
| **Redis**                | **Not required today.**                                                          | Becomes necessary when running more than one API instance with realtime or shared rate limits (see "Scaling limits").                                             |
| **Logging / monitoring** | Any log platform that ingests JSON lines + an uptime/alerting service            | See [monitoring.md](monitoring.md).                                                                                                                               |

## Environments

Three environments with separate databases, secrets, provider accounts and domains — see [environments.md](environments.md). Staging runs
with **production hardening** (`NODE_ENV=production`, `DEPLOY_ENV=staging`) so it proves production. Never copy production data into
staging (it contains personal and financial data); use synthetic data or an anonymised export approved by the data owner.

## Transport security, CORS and headers

What the code does (all covered by `test/ops.test.ts`):

- **HTTPS**: with `NODE_ENV=production` plain-HTTP requests are redirected (`308`, GET/HEAD) or refused (`400 HTTPS_REQUIRED`, everything else — credentials are never accepted over HTTP). Health/readiness probes are exempt (they run on the private network). HTTPS is detected via `X-Forwarded-Proto`, so **`TRUST_PROXY` must equal the number of proxy hops**.
- **HSTS** (`max-age=15552000; includeSubDomains`, no `preload`) on API responses in production; the static host sends it for the web app.
- **Headers**: Helmet defaults (nosniff, frame protection, …), `Referrer-Policy: no-referrer`, no `X-Powered-By`, `Cache-Control: no-store` on every API response.
- **CORS**: exact origins from `CORS_ORIGINS` only; methods `GET POST PUT PATCH DELETE`; headers `Authorization, Content-Type, Idempotency-Key, X-Request-Id`; exposed `X-Request-Id, X-Export-Truncated, Content-Disposition` (the CSV download reads the last two); **no credentials/cookies** (tokens travel in `Authorization`); preflight cached 10 min. Socket.IO uses the same origin list.
- **Web** (`apps/web/scripts/render-headers.mjs`, run by `pnpm build`): CSP with `script-src 'self'` + the SHA-256 of the inline theme script (no `unsafe-inline` for scripts), `connect-src` limited to the site, the API (`https` + `wss`) and the media hosts, `frame-ancestors 'none'`, `object-src 'none'`, HSTS, `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Permissions-Policy` (camera/microphone/geolocation/payment/usb off), COOP, long-lived caching for hashed assets, `no-cache` for `index.html`, SPA fallback. Trade-off: **styles may be inline** (`style-src 'unsafe-inline'`) because the design system sets style attributes; styles cannot execute code.
- **Certificates**: managed by the load balancer / CDN (automatic renewal). Alert 14 days before expiry. **Never** disable verification — there is no flag for it in any script here, and the production URI validation rejects the Mongo equivalents.

## Health and readiness

| Endpoint                         | Purpose                                                                                                                                                                          | Used for                                    |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `GET /health` (`/api/v1/health`) | **Liveness**: process is up. Cheap and independent of the database, so a database blip cannot cause a restart storm. Reports `deployment`, `commit`, `version`, `uptimeSeconds`. | Orchestrator liveness probe, uptime monitor |
| `GET /ready` (`/api/v1/ready`)   | **Readiness**: database ping succeeds (2 s budget) and the instance is not shutting down. `503` otherwise. Reveals only `up`/`down`.                                             | Load-balancer health check, rollout gate    |
| Worker `GET /health`             | Liveness (if `WORKER_HEALTH_PORT` set)                                                                                                                                           | Orchestrator                                |

**Graceful shutdown**: on SIGTERM the API reports not-ready, waits `SHUTDOWN_DELAY_MS`, stops accepting connections, lets requests finish, closes realtime and the database (hard stop after 10 s). Configure the platform's termination grace period ≥ `SHUTDOWN_DELAY_MS` + 15 s and the load-balancer deregistration delay ≥ the health-check interval × unhealthy threshold.

## Database access (least privilege)

Create **separate Atlas database users per purpose** — restricted to the application database, no cluster-wide roles:

| User               | Role(s)                                                                                               | Used by                                                                                          |
| ------------------ | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `farmplus_app`     | `readWrite` on the app database                                                                       | API (runtime). Its URI is `MONGODB_URI` of the API.                                              |
| `farmplus_migrate` | `readWrite` on the app database (includes index creation); add `dbAdmin` only if a migration needs it | The release step (`db indexes/migrate --apply`) — `MONGODB_URI_MIGRATIONS` in the CI environment |
| `farmplus_backup`  | `read`                                                                                                | Logical backups                                                                                  |
| `farmplus_restore` | `readWrite` on the **restore target** database only                                                   | Restore drills / recovery                                                                        |
| Humans             | Atlas SSO with MFA, time-boxed, audited; no shared credentials                                        | Break-glass investigation only                                                                   |

Network: private endpoint (preferred) or an IP allow-list of the API/worker/CI egress addresses. Atlas project API keys never reach the application or CI.
Rotate database passwords at least yearly and immediately on suspected exposure (update the secret, redeploy, then delete the old user).

## Release procedure

Every production release is a **tag that already ran in staging**. The `release` workflow does the same steps for both environments.

1. **Before**: CI green on the commit (`ci.yml`: types, lint, format, tests, build, secret scan, dependency audit). Release notes list schema/index/migration changes and any new environment variable (add it to the environment _first_).
2. **Staging**: run _Release_ with `environment=staging` and the tag.
   1. Build artifacts once (web, API, worker) — the same artifacts are promoted, never rebuilt.
   2. **Database step**: `node dist/scripts/db.js indexes` and `migrate` (dry run, output attached to the release), then `--apply --confirm-db <name>`. Creates missing indexes, runs pending migrations, **drops nothing**.
   3. Deploy (host-specific). Roll instances gradually; readiness gates traffic.
   4. **Verify**: `node scripts/ops/verify-deployment.mjs --api … --web … --origin …` (read-only: health, readiness, HSTS, HTTP→HTTPS, headers, CORS allow/deny, auth required, JSON errors, dev endpoints absent, unsigned webhooks rejected, rate limiting active, CSP, SPA fallback, caching).
   5. Manual smoke on staging (sign in, create an animal, make an offer, send a chat message, open the dashboard).
3. **Production**: run _Release_ with `environment=production` and the same tag. The GitHub Environment requires a reviewer's approval. Take an Atlas on-demand snapshot first when the release contains a migration. Watch the dashboards for 30 minutes after.
4. **After**: record the release (tag, time, migrations); keep artifacts for the rollback window (30 days by default).

Rollback: [rollback-incident.md](rollback-incident.md).

### Wiring a host

**Wired:** Render (API) + Cloudflare Workers static assets (web) + Atlas: see [deploy-render-cloudflare.md](deploy-render-cloudflare.md).

`release.yml` ends with a deliberately failing placeholder step until you add your host's deploy action and set `DEPLOY_ENABLED=true`
for the environment. Requirements for whatever you choose: run the API with the variables from `deploy/env/<env>.env.example` injected
from the secret manager; run **one** worker; make `/ready` the load-balancer health check and `/health` the liveness probe; enable
WebSocket support; terminate TLS with a managed certificate; ship stdout/stderr to the log platform. The Dockerfiles were written for
this but **have not been built in the environment where they were authored** (no Docker there) — build and run `env-check` inside the
image in CI before relying on them. Without containers, `pnpm --filter @farmplus/api start` runs the built artifact.

## Scaling limits (read before running more than one API instance)

- **Realtime** uses Socket.IO's in-memory adapter: with several instances, add the Redis adapter (and sticky sessions if long-polling is allowed). REST, unread counters and chat rate limits are already instance-safe (database-backed).
- **Rate limits** (`express-rate-limit`) and the **analytics report cache** are in-process: limits are per instance, cached reports can differ between instances by up to the TTL.
- Housekeeping jobs (media/marketplace/orders cleanup) run on every instance every 10 minutes and are idempotent.
- Request bodies are capped at 100 kB (JSON).

## What has and has not been verified

| Item                                                                                                                            | Status                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Production environment validation, HTTPS redirect, HSTS, CORS, headers, request ids, redaction, health/readiness, shutdown flag | **Automated tests** (`test/env.test.ts`, `test/ops.test.ts`)                                                                                                                                             |
| Index check, migrations, backup/restore round trip incl. encryption and tamper detection, CLI end to end                        | **Automated tests** against a real MongoDB (`test/db-ops.test.ts`)                                                                                                                                       |
| Deployment verification script against a running API                                                                            | **Automated test** + local rehearsal (`test/verify-deployment.test.ts`)                                                                                                                                  |
| Environment templates valid and documented; CI/release files present and safe                                                   | **Automated test** (`test/deploy-config.test.ts`)                                                                                                                                                        |
| EAS release-config guards                                                                                                       | **Automated test** (`apps/mobile/test/release-config.test.ts`)                                                                                                                                           |
| **A real staging deployment**                                                                                                   | **Not done** — there is no hosting account, Atlas project, domain or CI secret store in the authoring environment. Run the procedure above; the verification script's output is the acceptance evidence. |
| Dockerfiles, GitHub workflows, EAS builds                                                                                       | Written, **not executed** (no Docker, GitHub or Expo account available)                                                                                                                                  |
| Atlas continuous backup / PITR restore                                                                                          | **Not done** (needs an Atlas project); procedure documented in [backup-restore.md](backup-restore.md)                                                                                                    |
| Alerts                                                                                                                          | Rules documented in [monitoring.md](monitoring.md); **not created** in a monitoring product                                                                                                              |
