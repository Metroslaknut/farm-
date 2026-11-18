# API

Base path `/api/v1`. JSON only. Errors: `{ "error": { "code", "message", "details?" } }`.
Authenticated calls send `Authorization: Bearer <accessToken>`.

Status semantics: **401** = not authenticated / session invalid; **403** = authenticated but not allowed
(`FORBIDDEN`, `NOT_OWNER`, `PRIVILEGE_ESCALATION`, `MFA_REQUIRED`, …); **400** validation; **404** missing;
**409** conflict; **429** rate limited.

## Health

| Method | Path                                         | Auth |
| ------ | -------------------------------------------- | ---- |
| GET    | `/health` (unversioned) and `/api/v1/health` | –    |

## Auth (`/auth`)

| Method       | Path                                                 | Auth | Notes                                                                               |
| ------------ | ---------------------------------------------------- | ---- | ----------------------------------------------------------------------------------- |
| POST         | `/register`                                          | –    | `{email?, phone?, password, displayName}`; always gets role `buyer` only            |
| POST         | `/login`                                             | –    | `{identifier, password}` → `authenticated` + tokens, or `mfa_required` + `mfaToken` |
| POST         | `/mfa/verify`                                        | –    | `{mfaToken, code}` TOTP or recovery code                                            |
| POST         | `/refresh`                                           | –    | `{refreshToken}`; single-use rotation, reuse revokes the session                    |
| POST         | `/logout`, `/logout-all`                             | ✔    | revokes current / all sessions                                                      |
| GET          | `/me`                                                | ✔    | user, effective permissions, `mfaRequired`                                          |
| GET / DELETE | `/sessions`, `/sessions/:id`                         | ✔    | own sessions only                                                                   |
| POST         | `/password/forgot` · `/password/reset`               | –    | forgot always 202; reset revokes all sessions                                       |
| POST         | `/password/change`                                   | ✔    | revokes other sessions                                                              |
| POST         | `/verify/resend` · `/verify/email` · `/verify/phone` | –    | email: link token; phone: 6-digit OTP bound to `{phone, code}`                      |
| POST         | `/mfa/setup` · `/mfa/enable` · `/mfa/disable`        | ✔    | TOTP; `enable` returns 10 recovery codes once; admins cannot disable                |

## Users (`/users`) — all authenticated

| Method      | Path                  | Requirement                                                          |
| ----------- | --------------------- | -------------------------------------------------------------------- |
| GET         | `/`                   | `users.read`                                                         |
| GET / PATCH | `/me`                 | self                                                                 |
| GET         | `/:id`                | owner **or** `users.read`                                            |
| PATCH       | `/:id`                | owner **or** `users.update` (profile fields only)                    |
| PUT         | `/:id/status`         | `users.suspend` — `{status: active\|suspended\|deactivated, reason}` |
| GET         | `/:id/roles`          | owner **or** `roles.read`                                            |
| POST        | `/:id/roles`          | `roles.manage` — `{roleKey}`, subject to escalation rules            |
| DELETE      | `/:id/roles/:roleKey` | `roles.manage` — same rules                                          |

## Roles, permissions, audit

| Method | Path                                       | Requirement                                                               |
| ------ | ------------------------------------------ | ------------------------------------------------------------------------- |
| GET    | `/roles`, `/permissions`                   | `roles.read`                                                              |
| PUT    | `/roles/:key/permissions`                  | `permissions.manage` — `{permissions: string[]}`; `super_admin` immutable |
| GET    | `/audit-logs?page&pageSize&action&actorId` | `audit_logs.read`                                                         |

Types: `packages/shared-types`; request schemas: `packages/validation/src/auth.ts`.

---

# Admin backoffice API (Part 04) — `/api/v1/admin`

Every route requires authentication **and its own specific permission** (no "is admin" shortcut). Admin
permissions are only effective in an MFA-verified session (otherwise `403 MFA_REQUIRED`). Verified by
`test/admin-access.test.ts`, which for each endpoint proves a holder of _only_ that permission is allowed and a
holder of _every other_ permission is refused.

| Method | Path                                                                                                  | Permission                                                                                      |
| ------ | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| GET    | `/admin/dashboard`                                                                                    | `reports.read` (sections inside need `users.read` / `registrations.review` / `audit_logs.read`) |
| GET    | `/admin/users` (`q,status,role,identity,seller,sortBy,order,page,pageSize`)                           | `users.read`                                                                                    |
| GET    | `/admin/users/:id` (audit history only if also `audit_logs.read`)                                     | `users.read`                                                                                    |
| PATCH  | `/admin/users/:id/status` `{status, reason}`                                                          | `users.suspend`                                                                                 |
| GET    | `/admin/registrations` (`q,status,type,sortBy,order,…`), `/:id`                                       | `registrations.review`                                                                          |
| POST   | `/admin/registrations/:id/review`                                                                     | `registrations.review`                                                                          |
| POST   | `/admin/registrations/:id/approve` · `reject` · `suspend` · `reinstate` `{reason}`                    | `registrations.approve`                                                                         |
| GET    | `/admin/roles`, `/admin/roles/:id`                                                                    | `roles.read`                                                                                    |
| POST   | `/admin/roles` `{key,name,description?,permissions?}`                                                 | `roles.manage` (+ `permissions.manage` to include permissions)                                  |
| PATCH  | `/admin/roles/:id` `{name?,description?,permissions?}`                                                | `roles.manage` (+ `permissions.manage` to change permissions)                                   |
| GET    | `/admin/permissions` (catalogue + roles holding each)                                                 | `roles.read`                                                                                    |
| GET    | `/admin/audit-logs` (`action` exact or `prefix.*`, `actorId`, `targetType`, `targetId`, `from`, `to`) | `audit_logs.read`                                                                               |
| GET    | `/admin/settings` · PATCH `/admin/settings` `{values, reason}`                                        | `settings.read` · `settings.manage`                                                             |

Applicant side (any authenticated user, own records only): `POST /registrations`, `GET /registrations/mine`.

New permissions: `settings.read`, `settings.manage`. They are granted to `super_admin` automatically; `admin` gets
`settings.read` only for newly created databases (existing role mappings are never overwritten — grant it via
`PATCH /admin/roles/:id` if wanted).

**Not routed under `/admin/<name>`:** payments, refunds, withdrawals, wallet transactions, commissions, farms,
listings, orders, products → `GET /admin/<any of these>` is 404 by design (tested). Finance lives under `/admin/finance/…`
(Part 13, below); the others are not admin endpoints.

---

# Farms, animals & animal types (Part 07)

All require authentication. Farm-scoped routes authorise per farm role (see [farms.md](../architecture/farms.md)): non-members get `404`, members lacking a
permission get `403 FARM_FORBIDDEN`.

| Method         | Path                                                                                         | Needs                                                                       |
| -------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| POST           | `/farms`                                                                                     | `farm_owner` role (or `farms.manage`), setting `farms.requireFarmOwnerRole` |
| GET            | `/farms?q&status&scope=mine\|all&page&pageSize`                                              | member (`scope=all`: `farms.read`)                                          |
| GET / PATCH    | `/farms/:farmId`                                                                             | `farm.read` / `farm.update`                                                 |
| POST           | `/farms/:farmId/archive` · `/restore`                                                        | `farm.archive` (owner)                                                      |
| GET            | `/farms/:farmId/members`                                                                     | `members.read` (e-mails only for `members.manage`)                          |
| POST           | `/farms/:farmId/members` `{email\|userId, role}`                                             | `members.manage`, role below yours                                          |
| PATCH / DELETE | `/farms/:farmId/members/:memberId`                                                           | `members.manage`; anyone may remove themselves (not the owner)              |
| POST           | `/farms/:farmId/animals`                                                                     | `animals.write`                                                             |
| GET            | `/farms/:farmId/animals?q&animalTypeId&breed&sex&status&archived&sortBy&order&page&pageSize` | `animals.read`                                                              |
| GET / PATCH    | `/farms/:farmId/animals/:id`                                                                 | `animals.read` / `animals.write`                                            |
| POST           | `/farms/:farmId/animals/:id/archive` · `/restore`                                            | `animals.archive`                                                           |
| POST / DELETE  | `/farms/:farmId/animals/:id/media[/:mediaId]`                                                | `animals.write`                                                             |
| GET            | `/animals/:id`                                                                               | read access to the animal's farm (deep links)                               |
| GET            | `/animal-types[?includeInactive=true]`                                                       | any user (`includeInactive`: `animal_types.manage`)                         |
| POST / PATCH   | `/animal-types`, `/animal-types/:id`                                                         | `animal_types.manage`                                                       |
| POST / PATCH   | `/animal-types/:id/breeds`, `/breeds/:key`                                                   | `animal_types.manage`                                                       |

Errors: `409 DUPLICATE_ANIMAL_CODE` (with `details[{path:'animalCode'}]`), `409 FARM_ARCHIVED`, `409 ANIMAL_ARCHIVED`, `403 ROLE_ESCALATION`,
`403 FARM_OWNER_REQUIRED`, `400 VALIDATION_ERROR` (with `details`), `400 MEDIA_NOT_CONFIGURED`.

# Records: breeding, health, weights, feeding, expenses (Part 08)

All under `/api/v1/farms/:farmId`; see [records.md](../architecture/records.md). `<kind>` ∈ `breeding | health | weights | feeding | expenses`.

| Method | Path                                                                       | Needs                                           |
| ------ | -------------------------------------------------------------------------- | ----------------------------------------------- |
| POST   | `/<kind>`                                                                  | `records.write` (`expenses.write` for expenses) |
| GET    | `/<kind>?animalId&from&to&page&pageSize&includeVoided&…kind filters`       | `records.read` (`expenses.read`)                |
| GET    | `/<kind>/:id`                                                              | as above; includes `history[]`                  |
| POST   | `/<kind>/:id/corrections` `{reason, changes}`                              | `records.correct` (`expenses.write`)            |
| POST   | `/<kind>/:id/void` `{reason}`                                              | `records.correct`                               |
| POST   | `/<kind>/:id/attachments` · `/attachments/:attachmentId/remove` `{reason}` | `records.write` / `records.correct`             |
| GET    | `/expenses/summary?from&to`                                                | `expenses.read`                                 |
| POST   | `/breeding/:id/pregnancy` · `/failure` · `/delivery` · `/offspring`        | `records.write`                                 |
| GET    | `/animals/:animalId/history` · `/growth` · `/lineage`                      | `records.read`                                  |

Errors: `409 RECORD_VOIDED`, `NO_CHANGE`, `INVALID_TRANSITION`, `DAM_ALREADY_BRED`, `OVERLAPPING_BREEDING`, `PARENT_CONFLICT`, `ALREADY_OFFSPRING`,
`SIRE_LOCKED`, `DUPLICATE_RECORD`, `ATTACHMENT_LIMIT`, `ATTACHMENT_EXISTS`; `403 FARM_FORBIDDEN`; `404` for non-members; `400 VALIDATION_ERROR` with `details`.

# Community (Part 09)

All routes need authentication; see [community.md](../architecture/community.md) for rules, visibility and the full table.
Feeds and comment lists use **cursor pagination**: `GET /posts?scope&sort&authorId&limit&cursor` → `{ items, nextCursor? }`.

`/posts` (GET, POST) · `/posts/:id` (GET, PATCH, DELETE) · `/posts/:id/reactions` (POST, DELETE) · `/posts/:id/comments` (GET, POST) ·
`/comments/:id` (PATCH, DELETE) · `/comments/:id/reactions` · `/posts/:id/reports`, `/comments/:id/reports` · `/users/:id/follow` (POST, DELETE) ·
`/users/:id/profile` · `/moderation/reports[/:id[/resolve]]`, `/moderation/:post|comment/:id/status|history` (permission `content.moderate`).

# Video & live (Part 10)

All routes need authentication except the provider webhook (signature-authenticated). Details: [video.md](../architecture/video.md).

`GET /videos/limits` · `POST /videos/uploads` · `GET /videos` (cursor; `scope`, `creatorId`, `mine`) · `GET|PATCH|DELETE /videos/:id` · `POST /videos/:id/refresh` ·
`GET /videos/:id/playback` · `POST /videos/:id/views` · `POST|DELETE /videos/:id/reactions` · `GET|POST /videos/:id/comments` · `POST /videos/:id/reports` ·
`POST /live` · `GET /live?state=live|created|ended` · `GET /live/:id` · `POST /live/:id/end` · `POST /live/:id/ingest` (host) · `GET /live/:id/playback` · `POST /live/:id/reports` ·
`POST /webhooks/video` (provider) · `POST /moderation/media/cleanup` (`content.moderate`) · moderation of `video`/`live` through the existing `/moderation/:type/:id/status|history`.

Errors: `413 FILE_TOO_LARGE`, `429 UPLOAD_LIMIT`, `409 NOT_READY | NOT_LIVE_YET | LIVE_OVER | LIVE_ALREADY_ACTIVE`, `403 LIVE_HOST_REQUIRED`, `401 INVALID_SIGNATURE` (webhook), `502 PROVIDER_UNAVAILABLE`.

# Marketplace (Part 11)

All routes need authentication. Rules, status machine and negotiation protocol: [marketplace.md](../architecture/marketplace.md).

**Buyer / browse** (`/marketplace`): `GET /listings?…` · `GET /listings/:id` · `POST|DELETE /listings/:id/favorite` · `GET /favorites` · `POST /listings/:id/negotiations {amountMinor, currency?, message?}` ·
`GET /negotiations` · `GET /negotiations/:id` · `POST /negotiations/:id/counter {amountMinor, expectedSeq, …}` · `/accept {expectedSeq}` · `/reject` · `/withdraw` · `/cancel-reservation`.

**Seller** (`/farms/:farmId`, needs farm role owner/manager + seller role): `POST|GET /listings` · `GET|PATCH /listings/:id` · `POST /listings/:id/submit|pause|resume|renew|cancel|sold` · `GET /listings/:id/events` · `GET /negotiations?listingId&status`.

**Moderation** (`/marketplace/moderation`, permission `listings.moderate`): `GET /listings?status` · `POST /listings/:id/approve|reject|suspend|restore` · `GET /listings/:id/events` · `POST /cleanup`.

Errors: `403 SELLER_REQUIRED | FARM_FORBIDDEN | READ_ONLY | SELF_MODERATION`, `409 ALREADY_LISTED | ANIMAL_NOT_SELLABLE | INVALID_STATE | NOT_EDITABLE | MODERATOR_HOLD | LISTING_UNAVAILABLE | STALE_OFFER | NOT_YOUR_TURN | OFFER_EXPIRED | NEGOTIATION_EXISTS | NEGOTIATION_CLOSED | OWN_LISTING | PRICE_FIXED | NOT_ACCEPTED | TOO_MANY_ROUNDS`, `400 VALIDATION_ERROR` (with `details`).

## Orders & shipping (Part 12)

Rules, transitions, cancellation/refund: [orders.md](../architecture/orders.md). All routes need authentication except webhooks.

`POST /shipping/quotes {listingId, destination:{province}}` · `POST /orders {negotiationId, fulfillment, quoteId?, optionId?, address?, acknowledgeTransport?}` · `GET /orders` · `GET /orders/:id` · `POST /orders/:id/cancel|requote|confirm-delivery|process|ship` · `POST /orders/:id/shipments/:sid/events` · `GET /farms/:farmId/orders`.

Webhooks (HMAC, raw body): `POST /webhooks/payments` (finance, below), `POST /webhooks/shipping`.

Errors: `404` for orders you are not party to, `409 QUOTE_STALE | INVALID_STATE | ORDER_EXISTS | OWN_LISTING`, `400 VALIDATION_ERROR`.

## Finance (Part 13)

Rules, state machines, ledger and safety notes: [finance.md](../architecture/finance.md). Money-moving requests need an `Idempotency-Key` header (8–100 chars `[A-Za-z0-9_\-:.]`); repeating a request with the same key returns the original result.

**Buyer:** `POST /payments {orderId}` (key required; `201` new / `200` replay) · `GET /payments?orderId=` · dev only: `POST /payments/:id/mock-complete {outcome}` (mock provider, never in production).

**Seller earnings** (`/wallet`, own wallet only): `GET /wallet` · `GET /wallet/transactions` · `PUT /wallet/payout-account {bankCode, accountNumber, accountName}` (returned masked) · `GET|POST /wallet/withdrawals {amountMinor}` (key required) · `POST /wallet/withdrawals/:id/cancel`.

**Finance admin** (`/admin/finance`, MFA session): `GET /payments[/:id]`, `GET /refunds[/:id]`, `GET /withdrawals`, `GET /wallet-transactions?journalKey=`, `GET /audit-logs`, `GET /audit-logs/verify` (`payments.read` / `payments.verify`) ·
`POST /refunds/:id/approve {confirmation: <refundNo>}` · `POST /refunds/:id/retry` (`payments.refund`) · `POST /withdrawals/:id/approve {confirmation: <withdrawalNo>}` · `/reject {reason}` · `/retry` (`withdrawals.approve`) ·
`GET|POST /commission-rules`, `PATCH /commission-rules/:id`, `POST /commission-rules/preview` (`commissions.manage`, reason required on changes) · `POST /reconcile {repair?, confirmation?: "REPAIR"}` (`payments.verify`).

**Provider callback:** `POST /webhooks/payments` — `{id, type: charge.succeeded|charge.failed|refund.succeeded|refund.failed|payout.paid|payout.failed, data: {ref, amountMinor, currency, failureCode?}}`, HMAC-signed with `PAYMENT_WEBHOOK_SECRET`; response `{received: true, result}`.

Errors: `400 IDEMPOTENCY_KEY_REQUIRED | CONFIRMATION_MISMATCH | BELOW_MINIMUM`, `403 SELF_APPROVAL | MFA_REQUIRED`, `404` (not your order / withdrawal), `409 PAYMENT_IN_PROGRESS | ORDER_NOT_PAYABLE | PAYMENT_WINDOW_CLOSED | PAYOUTS_DISABLED | PAYOUT_ACCOUNT_REQUIRED | INSUFFICIENT_FUNDS | RULE_CONFLICT | INVALID_STATE | INVALID_TRANSITION`, `502 PROVIDER_UNAVAILABLE` (retry with the same key), `503 PAYMENTS_UNAVAILABLE`.

## Products marketplace (Part 14)

Rules, compliance gates, inventory and snapshots: [products.md](../architecture/products.md). Orders and payments are the Part 12/13 endpoints.

**Shop** (`/shop`, signed in): `GET /categories` · `GET /products?q&category&minPriceMinor&maxPriceMinor&inStock&onSale&farmId&sort&page&pageSize` · `GET /products/:id` · `GET|POST /products/:id/reviews` · `DELETE /products/:id/reviews/mine` ·
`GET /cart?province=` · `PUT /cart/items/:productId {quantity}` · `DELETE /cart/items/:productId` · `DELETE /cart` ·
`POST /cart/checkout {fulfillment, address?, expected:[{farmId, itemsMinor, shippingMinor}]}` → `{orders[]}` (one per seller farm).

**Seller** (`/farms/:farmId/products`, farm owner/manager + seller role): `POST|GET /` · `GET|PATCH /:id` · `POST /:id/submit|pause|resume|archive` · `POST /:id/stock {delta | set, reason}` · `GET /:id/movements`.

**Moderation** (`/shop/moderation`, `listings.moderate`): `GET /products?status` · `GET /products/:id` · `POST /products/:id/approve|reject|suspend|restore` · `POST /rescan`; reviews (`content.moderate`): `POST /reviews/:id/hide|restore`.

**Category compliance** (`/shop/admin`, `settings.manage`): `PUT /categories/:key` · `POST /categories/:key/sales {enabled, reason, confirmation: "ENABLE|DISABLE <key>", complianceReference?}`.

Errors: `409 INSUFFICIENT_STOCK | CART_HAS_PROBLEMS | CART_EMPTY | CART_CHANGED | PRICE_CHANGED | SHIPPING_CHANGED | NO_DELIVERY | NO_PICKUP | CATEGORY_DISABLED | OWN_PRODUCT | SKU_TAKEN | BELOW_RESERVED | NEGATIVE_STOCK | MODERATOR_HOLD | INVALID_STATE`, `422 PROHIBITED_PRODUCT | UNSUPPORTED_CLAIM | REGISTRATION_REQUIRED | PROHIBITED_CATEGORY`, `403 SELLER_REQUIRED | SELF_MODERATION | NOT_PURCHASED`, `404` (not your farm's product / not on sale).

## AI animal assessment (Part 15)

Rules, safeguards and limits: [ai-assessment.md](../architecture/ai-assessment.md).

**Farm** (`/farms/:farmId`): `POST /animals/:animalId/assessments {includeAiExplanation?}` (members; `animals.read`+`records.read`) · `GET /animals/:animalId/assessments` · `GET /assessments?status&page&pageSize` · `GET /assessments/:id` · `POST /assessments/:id/review {decision: accepted|dismissed, note?}` · `POST /assessments/:id/recommendations/:recId/dismiss` (review/dismiss need `listings.manage`).

**Admin** (`/admin/ai`): `GET|POST /criteria`, `POST /criteria/:id/deactivate`, `GET|POST /market-data`, `POST /market-data/:id/deactivate` (`animal_types.manage`) · `GET /usage?days` (`reports.read`).

Errors: `403 MEMBERS_ONLY`, `409 ANIMAL_ARCHIVED`, `404` (not your farm's animal/assessment), `400 VALIDATION_ERROR`.

## Analytics & reporting (Part 16)

Metric definitions, money vocabulary, scoping, caching: [analytics.md](../architecture/analytics.md). Query parameters (all optional, strictly validated): `from`, `to` (`YYYY-MM-DD`, Thailand time, inclusive; default last 30 days; max 366 days), `granularity=day|week|month` (day only ≤ 92 days), `fresh=true` (bypass the cache).

**Farm** (`/farms/:farmId`, members or platform staff): `GET /dashboard?animalType&orderKind=animal|product&sections=a,b` → `{meta, sections:{name:{available, reason?, metrics, tables, series, notes}}, definitions}` · `GET /dashboard/export?section=animals|growth|health|feeding|costs|orders|assessments` (CSV; permission = the mirrored dashboard section; rate-limited, audited).

**Admin**: `GET /admin/analytics?orderKind` (any reporting permission) · `GET /admin/analytics/export?section=signups|orders|payments|commissions|refunds|payouts` · `GET /analytics/definitions` (any signed-in user: the metric catalogue).

Errors: `400 VALIDATION_ERROR` (bad dates/range/filter/section), `403 EXPORT_FORBIDDEN` / `FORBIDDEN`, `404` (not your farm), `429`.

## Notifications & messaging (Part 17)

Rules, security and limits: [messaging.md](../architecture/messaging.md). All routes need a signed-in user; every query is scoped to the caller.

**Notifications** (`/notifications`): `GET /?cursor&limit&unread&category` → `{items, nextCursor?, unread}` · `GET /unread-count` → `{notifications, messages, byCategory}` · `POST /:id/read` · `POST /read-all {category?}` · `DELETE /:id` · `GET|PUT /preferences` (`{categories:{offers:{inApp:false}}}`; `orders`/`moderation` are locked → `409 CATEGORY_LOCKED`).

**Chat** (`/conversations`): `POST / {listingId | productId, message}` → `{conversation, message}` (one thread per buyer and farm) · `GET /?cursor&limit&unread` · `GET /:id` · `GET /:id/messages?before|after&limit` · `POST /:id/messages {body, clientId?}` (idempotent by `clientId`) · `POST /:id/read` · `POST|DELETE /:id/block` · `POST /:id/report {reason, details?, messageId?}`. Non-participants get `404` on all of them.
Errors: `403 CHAT_UNAVAILABLE` (blocked; not attributed) · `403 CHAT_RESTRICTED` · `409 OWN_FARM | ALREADY_REPORTED | OWN_MESSAGE | FARM_UNAVAILABLE` · `429 CHAT_RATE_LIMITED`.

**Moderation** (`/admin/chat`, `content.moderate`): `GET /reports?status&cursor&limit` · `GET /reports/:id` · `POST /reports/:id/resolve {action: dismiss|warn|restrict_messaging, note?}` · `DELETE /restrictions/:userId`.

**Realtime** (Socket.IO, path `/socket.io`, handshake `auth: {token: <access token>}`): client → server `conversation:join|leave {conversationId}` (ack `{ok, role?|error}`); server → client `notification:new`, `unread:update`, `message:new`, `message:read`, `conversation:update`, `auth:expired`. Handshake errors carry `data.code` (`UNAUTHENTICATED | INVALID_TOKEN | SESSION_REVOKED | ACCOUNT_INACTIVE`).

## Health and readiness (Part 19)

`GET /health` (also `/api/v1/health`): liveness `{status, service, version, environment, deployment, commit?, uptimeSeconds, timestamp}`. `GET /ready` (also `/api/v1/ready`): readiness `{status: ready|not_ready, checks: {database: up|down, shuttingDown}, timestamp}`, `503` when not ready. Neither requires authentication nor reveals configuration. Every response carries `X-Request-Id` (a caller-supplied value is kept only if it is a harmless token). See [../ops/deployment.md](../ops/deployment.md).
