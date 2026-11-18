# Rollback and incident response

## Rollback

Decide quickly; prefer the smallest reversible action. Order of preference: **feature switch off → roll back the application → roll back configuration → restore data (last resort).**

| What went wrong                                            | Action                                                                                                                                                                                                                                                                          | Notes                                                                                                                                 |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| New API/worker release misbehaves                          | Redeploy the **previous artifact** (`release-<sha>` from the workflow, kept 30 days) through the same _Release_ workflow with the old tag                                                                                                                                       | No rebuild. Readiness gates traffic. Verify with `verify-deployment.mjs`.                                                             |
| New web release misbehaves                                 | Redeploy the previous web artifact; purge the CDN cache for `/index.html` (it is `no-cache`; hashed assets are immutable and unaffected)                                                                                                                                        | Old and new assets can coexist.                                                                                                       |
| Bad configuration                                          | Restore the previous secret/variable version in the secret manager and redeploy                                                                                                                                                                                                 | Keep secret-manager version history. `env:check` catches many errors before deploy.                                                   |
| A migration was applied and the new release is rolled back | **Do not reverse the migration.** Migrations are forward-only; the previous release must work on the migrated data (expand → migrate → contract). `db migrate` will warn `unknown` migrations — expected                                                                        | If the previous release cannot work with the data, that migration violated the rule: treat as an incident and fix forward or restore. |
| Data corrupted                                             | Restore to a **new** cluster from PITR/snapshot, validate, switch ([backup-restore.md](backup-restore.md))                                                                                                                                                                      | Accept the data-loss window explicitly; decide with the product owner; reconcile finance.                                             |
| A feature is harmful but the code is fine                  | Use the existing switches: admin Settings (e.g. marketplace/offer flags, `analytics.cacheSeconds`, `chat.messagesPerMinute`), product category sales disable (`CATEGORY_DISABLED`), payments off (`PAYMENT_PROVIDER=none` → redeploy), webhook endpoints off (unset the secret) | Faster than a deploy.                                                                                                                 |
| Mobile build is bad                                        | Halt the staged rollout / remove from sale; ship a fixed build; keep the API compatible                                                                                                                                                                                         | Binaries cannot be recalled.                                                                                                          |

Rules: never roll back by editing production data by hand; never skip staging to "fix" production faster without the incident commander's approval; record every rollback in the release log.

## Incident response

### Severity

| Level    | Definition                                                                                             | Response                                                |
| -------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| **SEV1** | Outage of the API or web; data loss or corruption; **suspected breach**; payments or ledger wrong      | Page immediately, all hands, status update every 30 min |
| **SEV2** | Major feature unusable (chat, orders, video) or a security weakness found, no evidence of exploitation | Page during business hours, update every 2 h            |
| **SEV3** | Degraded or cosmetic, workaround exists                                                                | Ticket, next sprint                                     |

### Roles

**Incident commander (IC)** decides and delegates, keeps the timeline; **operations lead** investigates/mitigates; **communications lead** updates stakeholders/customers (one voice); **scribe** records times and actions. One person may hold several roles in a small team, but name them at the start.

### First 15 minutes

1. Acknowledge, open an incident channel/doc, name the IC, note the time and the symptom (what users see, since when).
2. **Stabilise before diagnosing**: if a deploy preceded it, roll back; if load, scale; if a feature is harmful, switch it off.
3. Check: `/health`, `/ready`, the dashboards, `level=error` logs by `requestId`/`route`, Atlas status, provider status pages (Cloudflare, payment, hosting), recent changes (deploys, config, migrations, DNS/certificates).
4. **Preserve evidence** (logs, the audit trail, a snapshot, the affected records) before cleanup. Do not delete or "tidy" anything.
5. Communicate: internal now; external when impact is confirmed (what happened, who is affected, what you are doing, next update time). No speculation, no blame.

### Playbooks

**API down / crash loop** — roll back the last release; check `process` errors and startup config errors (`env:check`); verify Atlas reachability and the allow-list; confirm secrets exist.

**Database unavailable** — Atlas status/maintenance, allow-list/private-endpoint changes, rotated credentials, connection limit; the API reports `not_ready` and stops receiving traffic by itself. Restore only if data is damaged (backup-restore.md).

**High 5xx after a deploy** — roll back; compare `commit` in `/health`; look for a missing environment variable or an index not applied (`db indexes --check`).

**Payments/ledger anomaly** — notify finance and pause payouts (withdrawals approval) and, if needed, payments; do **not** edit ledger rows (append-only by design): corrections are new journal entries. Use admin finance reconciliation and the audit chain; reconcile with the provider's report; follow the refund runbook for unapplied payments.

**Webhook failures** — provider status, secret mismatch (`401` spikes), clock skew (signatures carry a timestamp), replay protection; re-deliver from the provider dashboard once fixed (handlers are idempotent).

**Realtime/chat outage** — HTTP still works and clients resync; check load balancer WebSocket support, `CORS_ORIGINS`, instance count (single instance only without Redis).

**Certificate expiry / DNS** — renew/repair at the load balancer or CDN; never work around by disabling verification in clients, scripts or the database URI.

**Suspected credential or secret leak** — treat as SEV1:

1. Revoke/rotate the secret first (database user password, `JWT_ACCESS_SECRET`, provider keys, `EXPO_TOKEN`, webhook secrets), redeploy, then investigate. Rotating `JWT_ACCESS_SECRET` invalidates all access tokens (users re-authenticate with their refresh tokens; revoke sessions in the database/admin if the refresh path is compromised).
2. **`MFA_ENCRYPTION_KEY` cannot simply be rotated**: it encrypts stored TOTP secrets; changing it makes them unreadable. Rotation requires a migration that decrypts with the old key and re-encrypts with the new one (write and review it before an emergency), or forcing MFA re-enrolment for affected users.
3. Search history for the secret (`gitleaks`), remove it from the repository and any build logs/artifacts, check provider and Atlas access logs for use, and scope the blast radius from the audit log.

**Suspected personal-data breach** — SEV1. Contain, preserve evidence, involve legal/DPO immediately. Under Thailand's PDPA a controller generally must notify the Personal Data Protection Committee **without delay and within 72 hours of becoming aware** of a breach likely to risk individuals' rights, and notify affected people without delay where the risk is high — confirm the current requirements with counsel; do not decide this alone. Keep the timeline from the audit log and the log platform.

### After the incident

Within 5 working days hold a **blameless review**: timeline (UTC), impact (users, money, data), detection (how/when we learned — did an alert fire?), root cause and contributing factors, what worked, what did not, **actions with owners and dates** (tests, alerts, runbooks, validation rules — e.g. new production validation rules came from exactly such reviews). Update these documents. Track actions to completion.

### Contacts (fill in; keep an offline copy)

IC rota, hosting provider support, MongoDB Atlas support, Cloudflare, payment provider, legal/DPO, store developer-account owners.
