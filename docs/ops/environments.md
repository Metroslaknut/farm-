# Environment variables

Templates (no secrets): [`/.env.example`](../../.env.example) (local development) and [`/deploy/env/`](../../deploy/env/) (`staging`, `production`, `worker`, `web`, `mobile`).
Real values live only in the host's secret manager / CI environment. **Never commit a real `.env`** (git-ignored; CI runs a secret scan).

## Environments

|                                  | development        | staging                                                      | production         |
| -------------------------------- | ------------------ | ------------------------------------------------------------ | ------------------ |
| `NODE_ENV`                       | `development`      | `production`                                                 | `production`       |
| `DEPLOY_ENV`                     | unset              | `staging`                                                    | `production`       |
| Hardening + validation           | relaxed            | **same as production**                                       | full               |
| Database                         | local / disposable | its own Atlas cluster or database, **never production data** | production cluster |
| Secrets, keys, provider accounts | local dummies      | its own (never shared with production)                       | its own            |
| Providers                        | mocks allowed      | real provider **sandboxes** (mocks are refused)              | real               |
| Mobile profile                   | `development`      | `preview`                                                    | `production`       |

Staging runs the production code path (`NODE_ENV=production`) so that it can prove production works; it differs only in resources and the `DEPLOY_ENV` label. The API refuses `DEPLOY_ENV=staging|production` without `NODE_ENV=production` and vice versa.

## Production validation (API, and the connection string of database tools)

When `NODE_ENV=production` the API **refuses to start** (and `env:check` / the release pipeline fail) unless:

- `MONGODB_URI` uses TLS (`mongodb+srv://` or `tls=true`), does not relax it (`tls=false`, `tlsInsecure`, `tlsAllowInvalidCertificates`, `tlsAllowInvalidHostnames`), carries credentials, and is not localhost.
- `CORS_ORIGINS` is a list of exact `https://host[:port]` origins — no wildcards, no `http`, no paths, no localhost.
- `JWT_ACCESS_SECRET` and `MFA_ENCRYPTION_KEY` are not placeholders (too few distinct characters / bytes).
- `TRUST_PROXY` ≥ 1, `RATE_LIMIT_ENABLED` is not `false`, `AUTH_REQUIRE_VERIFICATION` is not `false`, `LOG_LEVEL` is not `debug`.
- No provider is `mock`; `VIDEO_PROVIDER=cloudflare` has all its credentials.
- `PHOTO_STORAGE=r2` has all five `R2_*` values and an `https` `R2_PUBLIC_BASE_URL`.

Errors name the variable, never its value. `node services/api/dist/scripts/env-check.js` (or `pnpm --filter @farmplus/api env:check`) runs the same validation without starting anything and prints warnings for things that are valid but probably unintended (e.g. empty `MEDIA_ALLOWED_HOSTS`, no `GIT_SHA`).

## API (`services/api`) — server-only

| Variable                          | Required           | Default             | Secret  | Meaning                                                                                                                                                                                                          |
| --------------------------------- | ------------------ | ------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                        | no                 | `development`       | no      | `development`, `test`, `production`. `production` turns on all hardening.                                                                                                                                        |
| `DEPLOY_ENV`                      | in production      | derived             | no      | `staging` or `production` label (see above). Shown by `/health`.                                                                                                                                                 |
| `GIT_SHA`                         | recommended        | –                   | no      | Build id from the pipeline; shown by `/health` and every log line.                                                                                                                                               |
| `LOG_LEVEL`                       | no                 | `info`              | no      | `debug`, `info`, `warn`, `error`. `debug` is refused in production.                                                                                                                                              |
| `API_HOST`                        | no                 | `0.0.0.0`           | no      | Bind address.                                                                                                                                                                                                    |
| `API_PORT`                        | no                 | `4000`              | no      | Listen port.                                                                                                                                                                                                     |
| `CORS_ORIGINS`                    | production         | empty               | no      | Comma-separated exact browser origins allowed to call the API (also used for Socket.IO).                                                                                                                         |
| `TRUST_PROXY`                     | production (≥1)    | `0`                 | no      | Number of proxy hops in front of the API, so `req.ip` and HTTPS detection are correct.                                                                                                                           |
| `RATE_LIMIT_ENABLED`              | no                 | `true`              | no      | Per-IP rate limits. Must stay on in production.                                                                                                                                                                  |
| `SHUTDOWN_DELAY_MS`               | no                 | `5000`              | no      | After SIGTERM, report "not ready" for this long before closing, so the load balancer drains the instance.                                                                                                        |
| `MONGODB_URI`                     | **yes**            | –                   | **yes** | Atlas connection string for the application user. Contains a password.                                                                                                                                           |
| `JWT_ACCESS_SECRET`               | **yes**            | –                   | **yes** | ≥ 32 chars, random (`openssl rand -base64 48`). Signs access tokens.                                                                                                                                             |
| `ACCESS_TOKEN_TTL_SECONDS`        | no                 | `900`               | no      | 60–3600.                                                                                                                                                                                                         |
| `REFRESH_TOKEN_TTL_DAYS`          | no                 | `30`                | no      | 1–90.                                                                                                                                                                                                            |
| `MFA_ENCRYPTION_KEY`              | **yes**            | –                   | **yes** | 32 bytes base64 (`openssl rand -base64 32`). Encrypts TOTP secrets at rest. **Changing it makes every enrolled authenticator unreadable** — rotation needs a re-encryption migration (see rollback-incident.md). |
| `MFA_ISSUER`                      | no                 | `FARM+`             | no      | Name shown in authenticator apps.                                                                                                                                                                                |
| `MEDIA_ALLOWED_HOSTS`             | production         | empty               | no      | Hosts media links may point to (your CDN/object-storage host). Empty = media links refused in production.                                                                                                        |
| `PHOTO_STORAGE`                   | no                 | `database`          | no      | Where device-uploaded animal photos are stored: `database` (MongoDB, served by the API) or `r2` (Cloudflare R2, served from the bucket's public domain). `env:check` warns about `database` in production.       |
| `R2_ACCOUNT_ID`                   | with `r2`          | –                   | no      | Cloudflare account id (the S3 endpoint is `https://<id>.r2.cloudflarestorage.com`).                                                                                                                              |
| `R2_ACCESS_KEY_ID`                | with `r2`          | –                   | **yes** | R2 API token access key id, scoped to the photo bucket with Object Read & Write.                                                                                                                                 |
| `R2_SECRET_ACCESS_KEY`            | with `r2`          | –                   | **yes** | R2 API token secret.                                                                                                                                                                                             |
| `R2_BUCKET`                       | with `r2`          | –                   | no      | Bucket name, e.g. `farmplus-photos`. Separate bucket per environment.                                                                                                                                            |
| `R2_PUBLIC_BASE_URL`              | with `r2`          | –                   | no      | The bucket's public custom domain, e.g. `https://photos.example.com` (https in production). Add it to `WEB_MEDIA_HOSTS`.                                                                                         |
| `AUTH_REQUIRE_VERIFICATION`       | no                 | on in production    | no      | Require email/phone verification before login. Cannot be disabled in production.                                                                                                                                 |
| `API_PUBLIC_URL`                  | for social sign-in | —                   | no      | Public base URL of the API (no trailing slash). OAuth redirect URIs are `<API_PUBLIC_URL>/api/v1/auth/oauth/<provider>/callback`.                                                                                |
| `OAUTH_GOOGLE_CLIENT_ID`          | no                 | —                   | no      | Google OAuth client (type "Web application"). The Google button appears only with the secret set too.                                                                                                            |
| `OAUTH_GOOGLE_CLIENT_SECRET`      | with the id        | —                   | **yes** | Server-only.                                                                                                                                                                                                     |
| `OAUTH_FACEBOOK_APP_ID`           | no                 | —                   | no      | Facebook Login app. The Facebook button appears only with the secret set too.                                                                                                                                    |
| `OAUTH_FACEBOOK_APP_SECRET`       | with the id        | —                   | **yes** | Server-only. Also signs Graph API calls (`appsecret_proof`).                                                                                                                                                     |
| `OAUTH_RETURN_URLS`               | for social sign-in | —                   | no      | Exact URLs a sign-in may return to, comma-separated: the web page `/farms/oauth-callback` and the mobile deep link `farmplus://oauth-callback`. https only in production.                                        |
| `OAUTH_MOCK`                      | no                 | `false`             | no      | Development/test stand-in for Google/Facebook. Refused in production.                                                                                                                                            |
| `VIDEO_PROVIDER`                  | production         | `mock`              | no      | `mock` (dev/test only) or `cloudflare`.                                                                                                                                                                          |
| `CLOUDFLARE_ACCOUNT_ID`           | with cloudflare    | –                   | no      | Account id.                                                                                                                                                                                                      |
| `CLOUDFLARE_STREAM_API_TOKEN`     | with cloudflare    | –                   | **yes** | Scope: Stream:Edit only.                                                                                                                                                                                         |
| `CLOUDFLARE_STREAM_CUSTOMER_CODE` | with cloudflare    | –                   | no      | The `customer-<code>` part of the playback host.                                                                                                                                                                 |
| `VIDEO_WEBHOOK_SECRET`            | with cloudflare    | –                   | **yes** | Authenticates Stream webhooks (HMAC, ≥ 16 chars).                                                                                                                                                                |
| `VIDEO_MAX_UPLOAD_MB`             | no                 | `200`               | no      | Upload size limit.                                                                                                                                                                                               |
| `VIDEO_MAX_DURATION_SECONDS`      | no                 | `120`               | no      | Video length limit.                                                                                                                                                                                              |
| `SHIPPING_PROVIDER`               | no                 | `none`              | no      | `none` or `mock` (dev/test).                                                                                                                                                                                     |
| `SHIPPING_WEBHOOK_SECRET`         | no                 | –                   | **yes** | HMAC secret for carrier callbacks; the endpoint is off while unset.                                                                                                                                              |
| `PAYMENT_PROVIDER`                | no                 | `none`              | no      | `none` or `mock` (dev/test). No real adapter ships yet: payments stay disabled until one is built and reviewed.                                                                                                  |
| `PAYMENT_WEBHOOK_SECRET`          | no                 | –                   | **yes** | HMAC secret for payment/refund/payout callbacks; the endpoint is off while unset.                                                                                                                                |
| `AI_PROVIDER`                     | no                 | `none`              | no      | `none`, `mock` (dev/test) or `anthropic`.                                                                                                                                                                        |
| `AI_API_KEY`                      | with anthropic     | –                   | **yes** | Provider key; never logged, stored or sent to clients.                                                                                                                                                           |
| `AI_MODEL`                        | no                 | `claude-sonnet-5-5` | no      | Model id.                                                                                                                                                                                                        |
| `AI_BASE_URL`                     | no                 | –                   | no      | Optional gateway/proxy URL.                                                                                                                                                                                      |
| `AI_TIMEOUT_MS`                   | no                 | `20000`             | no      | 1000–120000.                                                                                                                                                                                                     |
| `AI_MAX_OUTPUT_TOKENS`            | no                 | `700`               | no      | 100–4000.                                                                                                                                                                                                        |

## Worker (`services/worker`)

| Variable             | Required | Default           | Secret | Meaning                                                                                 |
| -------------------- | -------- | ----------------- | ------ | --------------------------------------------------------------------------------------- |
| `WORKER_NAME`        | no       | `farmplus-worker` | no     | Name in logs.                                                                           |
| `WORKER_HEALTH_PORT` | no       | unset             | no     | Optional `GET /health` listener for the orchestrator; bind to the private network only. |

The worker also reads `NODE_ENV`, `DEPLOY_ENV`, `GIT_SHA`, `LOG_LEVEL`. It needs no database or provider credentials today.

## Database tools (`db` command, CI release step) — server-only

| Variable                | Required          | Secret  | Meaning                                                                                                                      |
| ----------------------- | ----------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `MONGODB_URI`           | yes               | **yes** | Connection string of the **migration/maintenance** user (not the application user). Same TLS/credential rules in production. |
| `BACKUP_ENCRYPTION_KEY` | no                | **yes** | 32 bytes base64. Encrypts backup files with AES-256-GCM. Store it separately from the backups.                               |
| `SEED_MOCKUP_PASSWORD`  | for `seed:mockup` | **yes** | Development only. Login password (≥ 12 chars) of every mockup user created by `pnpm seed:mockup` (see mockup-data.md).       |

## Web build (`apps/web`) — PUBLIC (compiled into the browser bundle)

| Variable                     | Meaning                                                                                                             |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `VITE_API_BASE_URL`          | Origin of the API. Empty in development (Vite proxy). Used to generate the Content-Security-Policy (`connect-src`). |
| `WEB_MEDIA_HOSTS`            | Extra `https://` hosts the page may load media from (default `https://*.cloudflarestream.com`).                     |
| `WEB_REQUIRE_API_BASE`       | `true` makes the build fail if `VITE_API_BASE_URL` is empty.                                                        |
| `VITE_ENABLE_DESIGN_PREVIEW` | Exposes the internal design-system page. Keep off outside development.                                              |

## Mobile build (`apps/mobile`) — PUBLIC

| Variable                   | Meaning                                                                                                         |
| -------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `EXPO_PUBLIC_API_BASE_URL` | API origin. **Required and `https://` for release builds** (the build fails otherwise).                         |
| `FARMPLUS_LINK_HOST`       | Domain for https universal/app links (needs `apple-app-site-association` and `assetlinks.json` on that domain). |
| `EAS_PROJECT_ID`           | Project id from `eas init` (an identifier, not a credential). Required for release builds.                      |
| `EAS_BUILD_PROFILE`        | Set by EAS. `production` triggers the release-configuration checks.                                             |

Set these in the EAS environment of each profile (`development`, `preview`, `production`), not in the repository. The Expo access token for CI is a secret of the `mobile-*` GitHub environments.

## Anything that looks like a secret but is not in this list

Store credentials, signing keys and certificates (Apple, Google Play) live in EAS and the store consoles. The Atlas API/admin credentials, DNS and CDN accounts are not used by the application at all and must never be placed in these variables.
