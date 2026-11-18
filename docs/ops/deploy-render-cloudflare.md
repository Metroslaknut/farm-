# Deploying on Render + Cloudflare Pages + MongoDB Atlas

The concrete host wiring for [deployment.md](deployment.md). Everything in that document still applies: the release procedure,
health checks, least-privilege database users and the verification script.

| Part               | Where                                                    | Defined in                                     |
| ------------------ | -------------------------------------------------------- | ---------------------------------------------- |
| Code, CI, releases | GitHub, one monorepo                                     | `.github/workflows/ci.yml`, `release.yml`      |
| API                | Render web service, Node runtime, region **Singapore**   | `render.yaml` (Blueprint)                      |
| Database step      | Render `preDeployCommand`, before new code takes traffic | `render.yaml`                                  |
| Web app            | Cloudflare Pages (Direct Upload of `apps/web/dist`)      | `release.yml` → `wrangler pages deploy`        |
| Database           | MongoDB Atlas, AWS **Singapore** (ap-southeast-1)        | —                                              |
| Video              | Cloudflare Stream (required: `mock` is refused in prod)  | API env `CLOUDFLARE_*`, `VIDEO_WEBHOOK_SECRET` |
| Worker             | Not deployed (skeleton, no queue yet)                    | —                                              |

Each environment (staging, production) has its own Render service, Pages project, Atlas database and secrets.

## 1. GitHub

1. Create a **private** repository, then push this folder as one repository. Do not split web and API: they share
   `packages/*` and the lockfile. `.gitignore` already excludes `.env*` (except `.env.example`). Before the first push, check
   that `git status` lists no `.env` file.
2. Create the Environments **staging** and **production** (Settings → Environments). On production, add required reviewers.
3. Set these on **each** Environment:

| Kind     | Name                     | Value                                                                            |
| -------- | ------------------------ | -------------------------------------------------------------------------------- |
| variable | `DEPLOY_ENABLED`         | `true`                                                                           |
| variable | `API_BASE_URL`           | Public API origin, e.g. `https://api.example.com`. It is built into the web app. |
| variable | `WEB_BASE_URL`           | Web origin, e.g. `https://app.example.com`                                       |
| variable | `WEB_MEDIA_HOSTS`        | e.g. `https://*.cloudflarestream.com,https://cdn.example.com`                    |
| variable | `CLOUDFLARE_ACCOUNT_ID`  | Cloudflare account id                                                            |
| variable | `CF_PAGES_PROJECT`       | e.g. `farmplus-web-staging` / `farmplus-web`                                     |
| secret   | `RENDER_DEPLOY_HOOK_URL` | The service's deploy hook (Render → service → Settings → Deploy Hook)            |
| secret   | `CLOUDFLARE_API_TOKEN`   | API token with **Account → Cloudflare Pages → Edit** only                        |

`DB_RELEASE_FROM_CI` stays unset. The database step runs on Render (see §3).

## 2. MongoDB Atlas

1. Create a project. Create the clusters on **AWS / Singapore (ap-southeast-1)**, in the same region as Render:
   - production: M10 or larger, which has continuous backup;
   - staging: a separate cluster or database (M0 is enough).
2. In each environment's database, create two users, scoped to that database only (see deployment.md, "Database access"):
   - `farmplus_app`: `readWrite`. Its URI is `MONGODB_URI`.
   - `farmplus_migrate`: `readWrite`. Its URI is `MONGODB_URI_MIGRATIONS`.
3. Under **Network Access**, add only Render's outbound IPs (Render → service → Connect → Outbound). Never add `0.0.0.0/0`.
4. Never copy production data into staging, and never seed mockup data into these databases.

## 3. Render (API)

1. Render → **New → Blueprint**, then select the repository. Render reads `render.yaml` and creates `farmplus-api-staging` and
   `farmplus-api`. To start without staging, delete that service from the file first.
2. Render asks for every `sync: false` value. Templates are in `deploy/env/{staging,production}.env.example`.
   - Generate `JWT_ACCESS_SECRET` with `openssl rand -base64 48`.
   - Generate `MFA_ENCRYPTION_KEY` with `openssl rand -base64 32`.
   - Use different values for each environment. Keep `MFA_ENCRYPTION_KEY` in a password manager: losing it locks admins
     out of MFA.
   - Set `FARMPLUS_DB_NAME` to the database name in the URI. The migration step refuses to run against any other database.
3. Add a custom domain (e.g. `api.example.com`) to each service. Render manages the TLS certificate.
4. Copy each service's **Deploy Hook** into the matching GitHub Environment secret.
5. Create the first admin from the service's **Shell**. `read -s` keeps the password out of shell history:

   ```bash
   cd services/api
   read -rs BOOTSTRAP_ADMIN_PASSWORD && export BOOTSTRAP_ADMIN_PASSWORD
   npx tsx src/scripts/create-super-admin.ts --email <admin email> --name "<name>"
   unset BOOTSTRAP_ADMIN_PASSWORD
   ```

How a deploy runs:

1. Render builds the requested commit.
2. `preDeployCommand` creates missing indexes and runs pending migrations as `farmplus_migrate`. If it fails, the old
   version keeps serving.
3. Render starts the new instance, waits for `/ready`, switches traffic and sends SIGTERM to the old instance (graceful
   drain).

`autoDeploy` is off, so a push to `main` deploys nothing. Releases go through the workflow.

## 4. Cloudflare Pages (web)

1. Pages → **Create → Direct Upload**. Create `farmplus-web-staging` and `farmplus-web` (the names you put in `CF_PAGES_PROJECT`).
   The production branch is `main`.
2. Add custom domains (e.g. `app.example.com`). Pages applies `dist/_headers` (CSP, HSTS, caching) and `dist/_redirects`
   (SPA fallback) as they are, so they need no extra configuration.
3. Put the same domain in the API's `CORS_ORIGINS`.

## 5. Releasing

Actions → **Release** → environment + tag. The workflow:

1. builds and tests once;
2. triggers Render with `ref=<commit>` and waits until `GET /health` reports that commit;
3. uploads the web build to Pages;
4. runs `scripts/ops/verify-deployment.mjs`.

Release to staging first, then the same tag to production (deployment.md, "Release procedure"). Before a production release
that contains a migration, take an Atlas on-demand snapshot.

**Rollback.**

- API: Render → service → Deploys → **Rollback** to a previous deploy. Migrations are forward-only and backward compatible
  (expand → migrate → contract), so the previous code runs on the migrated database.
- Web: Pages → Deployments → **Rollback**.

See [rollback-incident.md](rollback-incident.md).

## Not verified yet

The configuration was written without Render, Cloudflare or GitHub accounts. On the first staging release, confirm:

- **Pinned deploys.** The deploy hook honours `ref` and builds that commit. If it does not, the "wait until live" step
  times out instead of passing silently.
- **`TRUST_PROXY=1`.** It gives the real client IP behind Render's proxy. Check that the rate limit keys on different
  clients, not on one proxy IP.
- **Socket.IO.** Chat connects over `wss://` through Render and the Pages CSP.
- **Clean run.** `verify-deployment.mjs` passes in full.
