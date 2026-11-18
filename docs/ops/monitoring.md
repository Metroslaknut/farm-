# Logs, error tracking, health and alerts

## Logging

Every API/worker process writes **one JSON object per line** to stdout (info/debug) or stderr (warn/error) — ingest it with any log platform
(CloudWatch, Datadog, Loki, Cloud Logging, …) without parsers. Implementation: `services/api/src/lib/logger.ts`.

Standard fields: `ts`, `level`, `msg`, `service`, `version`, `deployment`, `commit`; request lines add `requestId`, `method`, `path`, `status`, `durationMs`, `userId` (when authenticated).

| Event                                 | Level     | `msg`                                                                                              |
| ------------------------------------- | --------- | -------------------------------------------------------------------------------------------------- |
| Request finished 2xx/3xx              | info      | `request`                                                                                          |
| Request finished 4xx                  | warn      | `request rejected`                                                                                 |
| Request finished 5xx                  | error     | `request failed` (+ a separate `unhandled error` with the error)                                   |
| Unexpected error (HTTP, job, process) | error     | `unhandled error` with `source` = `http` / `job` / `process`, `route`, `error{name,message,stack}` |
| Startup / shutdown / config warnings  | info/warn | `listening`, `shutting down`, `config: …`                                                          |

**What is never logged** (enforced in the logger, covered by tests): request/response bodies, headers, **query strings** (they can carry tokens), IP addresses (personal data; the audit log keeps IPs where an investigation needs them), values under keys such as `password`, `token`, `secret`, `authorization`, `cookie`, `apiKey`, `uri`, database URI credentials, bearer tokens inside text. Health and readiness probes are not logged. The caller-supplied `X-Request-Id` is accepted only if it is a harmless token (no log forging).

Retention: keep application logs 30–90 days (shorter if they contain user ids you do not need — they are pseudonymous but still personal data under PDPA), audit logs per the audit policy (the database `audit_logs` / `financial_audit_logs` are the system of record, not the log platform). Restrict log access like production data access.

Useful queries (jq on raw lines): `jq 'select(.level=="error")'`, `jq 'select(.msg=="request failed") | {path,status,requestId}'`, slow requests `jq 'select(.durationMs>2000)'`, one request end to end `jq 'select(.requestId=="…")'`. Users quote the `X-Request-Id` header (also exposed to the browser) when reporting a problem.

## Error tracking

All unexpected errors go through `reportError(error, context)` (`src/lib/error-reporter.ts`): HTTP 5xx (via the error handler), background jobs (media/marketplace/orders cleanup, notification delivery, realtime handlers), and process-level `uncaughtException`/`unhandledRejection` (the process then exits so the orchestrator restarts a clean instance). The default reporter writes the structured `unhandled error` line above, so **alerting on `level=error` in the log platform works with zero extra setup**.

To add an error tracker (Sentry, Rollbar, …): install its SDK, then in `server.ts` after configuring the logger:

```ts
import { setErrorReporter } from './lib/error-reporter';
setErrorReporter((error, context) => {
  tracker.captureException(error, {
    tags: { requestId: context.requestId, source: context.source },
    extra: { route: context.route, status: context.status },
  });
});
```

Rules: pass only the error and the non-sensitive context given (never request bodies/headers); configure the SDK with `sendDefaultPii: false`; the DSN is a secret of the environment (add it to `environments.md` when you introduce it). A reporter that throws is ignored and the error is still logged. The web and mobile apps have no client-side error tracker yet — add one the same way (public DSN, no PII) before a public launch.

## Health and readiness

See [deployment.md](deployment.md#health-and-readiness). External uptime monitoring should check `GET https://<api>/health` **and** `/ready` from outside the network (a single region is not enough: use ≥ 2), plus `GET https://<web>/`.

## Alert rules

Create these in the monitoring product (they are specified here, **not yet created**). Each page needs a runbook pointer; start with the first-response column.

| Alert                          | Condition                                                                                                                                      | Severity                                      | First response                                                                                               |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| API unavailable                | `/ready` or `/health` fails from 2 locations for 2 min                                                                                         | **page**                                      | Check platform status, recent deploy → roll back ([rollback-incident.md](rollback-incident.md)); check Atlas |
| Database not ready             | `/ready` returns `database: down` on > 1 instance for 2 min                                                                                    | **page**                                      | Atlas status, network allow-list/private endpoint, credentials rotated?                                      |
| Elevated errors                | 5xx > 2 % of requests for 5 min, or ≥ 10 `level=error` lines in 5 min                                                                          | **page**                                      | Look at `unhandled error` entries by `route`; recent deploy?                                                 |
| Latency                        | p95 `durationMs` > 2 s for 10 min                                                                                                              | ticket → page if sustained                    | Slow query? Atlas performance advisor; missing index (`db indexes`)                                          |
| Crash loop                     | ≥ 3 process starts in 10 min                                                                                                                   | **page**                                      | `jq 'select(.source=="process")'`; config change?                                                            |
| Auth abuse                     | `request rejected` with `status=401/429` on `/api/v1/auth/*` > 10× baseline for 10 min                                                         | ticket                                        | Credential stuffing? check rate-limit headers, consider blocking source at the edge                          |
| Webhook rejections             | `status=401` on `/api/v1/webhooks/*` > 5 in 10 min                                                                                             | ticket                                        | Provider secret rotated or someone probing; verify with provider                                             |
| Payments (business)            | Admin dashboard alerts: `unapplied_payments`, `failed_refunds`, `payment_failure_rate`, `failed_payouts` (Part 16 `/admin/analytics` → alerts) | **page finance** for unapplied/failed refunds | Finance runbook: reconcile, retry refund, contact provider                                                   |
| Realtime                       | Elevated `connect_error` rate from clients, or no connections for 15 min during business hours                                                 | ticket                                        | Load balancer WebSocket settings, `CORS_ORIGINS`, token refresh failures                                     |
| Certificate expiry             | < 14 days                                                                                                                                      | ticket (page < 3 days)                        | Check automatic renewal; DNS                                                                                 |
| Atlas                          | CPU > 80 % 15 min, connections > 80 % of limit, storage > 80 %, replication lag > 60 s, failed backup                                          | ticket/page                                   | Scale tier, find the query, verify the backup                                                                |
| Backups                        | No successful snapshot in 24 h; restore drill overdue                                                                                          | ticket                                        | Atlas Backup tab; run the drill ([backup-restore.md](backup-restore.md))                                     |
| Worker                         | Liveness fails 5 min                                                                                                                           | ticket                                        | Restart; check logs                                                                                          |
| Disk / memory (if self-hosted) | > 85 %                                                                                                                                         | ticket                                        | Resize/restart                                                                                               |

Alert hygiene: every alert has an owner and a runbook line; page only on user-visible impact; review noisy alerts monthly; test the paging path at least quarterly.

## Dashboards

One screen per environment: request rate, 4xx/5xx rate, p50/p95 latency, error count, `/ready` status, Atlas CPU/connections/replication lag, active realtime connections (if exported), deploy markers (use `commit` in the logs and `/health`).
