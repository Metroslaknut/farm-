# Operations (Part 19)

How FARM+ is configured, deployed, observed, backed up, released and recovered. Start with [deployment.md](deployment.md).

| Document                                                   | What it covers                                                                                                                                          |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [deployment.md](deployment.md)                             | Deployment targets, environments, the release procedure, HTTPS/CORS/headers, least-privilege access, scaling limits, what has and has not been verified |
| [deploy-render-cloudflare.md](deploy-render-cloudflare.md) | The wired hosts: Render (API), Cloudflare Pages (web), Atlas; setup, GitHub Environment variables, releasing, rollback                                  |
| [environments.md](environments.md)                         | **Every** environment variable (API, worker, database tools, web build, mobile build), validation rules, templates                                      |
| [backup-restore.md](backup-restore.md)                     | Backup strategy (Atlas + the logical backup tool), restore procedures, the restore drill, what is tested                                                |
| [migrations.md](migrations.md)                             | Index management and data migrations: rules, commands, how to write and review one                                                                      |
| [monitoring.md](monitoring.md)                             | Logs, error tracking, health/readiness, alert rules and first responses                                                                                 |
| [release-mobile.md](release-mobile.md)                     | Expo EAS builds, Android and iOS store requirements, release checklist                                                                                  |
| [../qa/README.md](../qa/README.md)                         | Security & QA audit (Part 18): results, findings, financial test cases, load results, risk register                                                     |
| [rollback-incident.md](rollback-incident.md)               | Rollback procedures and incident response (severity, roles, playbooks, post-incident review)                                                            |

Files outside `docs/`: `.github/workflows/{ci,release,mobile-eas}.yml`, `render.yaml`, `deploy/env/*.env.example`, `services/{api,worker}/Dockerfile`,
`apps/mobile/eas.json`, `apps/web/scripts/render-headers.mjs`, `scripts/ops/verify-deployment.mjs`, `services/api/src/{ops,scripts}/`.

**Non-negotiable rules** (enforced in code or CI where possible, and repeated where they matter):

1. No production secret is ever committed. Environment files are git-ignored; templates contain placeholders only; CI scans history for secrets.
2. Production database access is restricted: network allow-list/private endpoint, a separate least-privilege user per purpose.
3. TLS verification is never disabled — not in the database URI (validation refuses `tlsInsecure`, `tlsAllowInvalid*`, `tls=false`), not in scripts, not in CI. A certificate error is fixed, not bypassed.
4. No destructive database command without an approved plan: the tools in this repo never drop, delete or overwrite; they refuse instead.
