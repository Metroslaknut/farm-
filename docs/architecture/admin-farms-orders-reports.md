# Plan: admin Farms, Orders and Reports pages

**Status: proposal — not implemented.** Needs approval of the decisions in [§6](#6-decisions-needed) before any code.

The three admin sections `/admin/farms`, `/admin/orders` and `/admin/reports` are placeholders today
(`ModuleUnavailable`, see `docs/architecture/admin.md` → "Frontend"). This plan sets out what each page does, which API it
needs, which permissions guard it, what is audited and indexed, how the QA gates change, and the order of work.

## 1. What exists already

| Need                     | Already there                                                                                                                                                                                            | Missing                                                                                                                    |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| List every farm          | `GET /farms?scope=all` — platform `farms.read` / `farms.manage`, filters `q` (name), `status`, paginated (`farms.service.ts` `listFarms`)                                                                | owner/province filters, sort, owner name in the row                                                                        |
| One farm, read-only      | `GET /farms/:farmId`, `/summary`, `/members`, animals, records — `farm-access.ts` lets platform `farms.read` read and `farms.manage` act (MFA required, `staffWithheld`)                                 | nothing for reading                                                                                                        |
| Archive / restore a farm | `POST /farms/:farmId/archive                                                                                                                                                                             | restore`, farm permission `farm.archive`— **owner only**;`farms.manage` deliberately excludes it (`shared-types/farms.ts`) | a platform path, if wanted (decision D1) |
| Orders                   | Buyer/seller `GET /orders` (own orders only); finance admin lists payments, refunds, withdrawals, wallet transactions under `payments.read` (`finance.routes.ts`)                                        | **any staff list or detail of orders**                                                                                     |
| Reports                  | `GET /admin/analytics` (dashboard, each section has its own permission) and `GET /admin/analytics/export` (CSV, audited, rate-limited); `/admin/analytics` page; `GET /admin/dashboard` (`reports.read`) | a page that lists the available reports/exports (no new data)                                                              |

Nav guards today (`components/admin/nav.ts`): farms → `farms.read`, orders → `payments.read`, reports → `reports.read`.
Roles holding them (`rbac/definitions.ts`): `farms.read` — admin, moderator, support; `farms.manage` — admin;
`payments.read` — finance_admin (and super_admin); `reports.read` — admin, finance_admin, moderator.

## 2. Farms (`/admin/farms`, `/admin/farms/:farmId`)

**List**: name search, status (active/archived), province, owner (name or email), created date range; sort by created
date or name; page size ≤ 50. Columns: name, owner, province, status, members, animals, created.

**Detail** (read-only for `farms.read`): profile and contact, owner and members with roles, per-type animal counts
(`/summary`), latest activity date, link to the owner in `/admin/users/:id`, archive history from the audit log
(`farm.archived` / `farm.restored`). Contact details are shown as stored; no export.

**Actions**: none in phase 1. Archive/restore by staff only if D1 is approved (see below). Editing a farm's data stays
with its owner/managers; `farms.manage` staff can already act through the normal farm pages if ever needed.

**API**

| Route                               | Permission                     | Notes                                                                                                                                                           |
| ----------------------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /admin/farms`                  | `farms.read` or `farms.manage` | New, separate from `GET /farms?scope=all` so owner/province filters and owner names do not leak into the member API. Zod query schema in `packages/validation`. |
| `GET /admin/farms/:farmId`          | `farms.read` or `farms.manage` | Profile + owner + members + counts in one response (one round trip).                                                                                            |
| `POST /admin/farms/:farmId/archive` | **`farms.archive`** (new, D1)  | Only if D1 = yes. Mandatory reason; `farm.archived` audit with `via: 'platform'`, actor, reason. Notifies the owner.                                            |
| `POST /admin/farms/:farmId/restore` | **`farms.archive`** (new, D1)  | Same as above, `farm.restored`.                                                                                                                                 |

Owner filter: an exact e-mail uses the unique `users.email` index; a display-name search is a case-insensitive regex over
`users` (no index, capped at 50 matches, same as the admin users list today). The matching ids then select farms
through `farm_members` (`role: 'owner'`).

## 3. Orders (`/admin/orders`, `/admin/orders/:id`)

**List**: order number, status, kind (animal/shop), farm, buyer (name or email), created/paid date range; sort by
created date (newest first); cursor pagination like the buyer list. Columns: order no., created, buyer (display name),
farm, kind, total, payment status, order status.

**Detail**: items (the frozen checkout snapshot), totals and fee snapshot, payment(s) and refunds (links into the existing
finance pages), shipments and tracking events, the status timeline (`events`). **No actions** in phase 1: refunds
already have their own audited workflow (`payments.refund`), and order state changes belong to buyer/seller flows.

**Personal data**: the delivery address and phone are shown masked (province + last 4 digits) by default; revealing them
is a separate request that is audited (`admin.order.contact_viewed`, D3). Lists never include addresses.

**API**

| Route                            | Permission      | Notes                                                                                        |
| -------------------------------- | --------------- | -------------------------------------------------------------------------------------------- |
| `GET /admin/orders`              | `payments.read` | New. Zod query schema; `orderNo` exact match; buyer resolved to ids first; max page size 50. |
| `GET /admin/orders/:id`          | `payments.read` | New. Masked contact data.                                                                    |
| `POST /admin/orders/:id/contact` | `payments.read` | Only if D3 = yes. Returns unmasked address/phone, audited, rate-limited.                     |

Permission choice (D2): reuse `payments.read` (what the nav already uses; finance_admin needs orders to work refunds)
rather than adding `orders.read`.

## 4. Reports (`/admin/reports`)

No new data and no new API: a catalogue page of the reports that already exist, each with what it contains, who may
download it and a date range picker that calls the existing `GET /admin/analytics/export?section=…` (already
permission-checked per section, audited and rate-limited). Sections the viewer may not export are hidden. Links to the
`/admin/analytics` dashboard and the AI usage report (`/admin/ai`). New report types (e.g. scheduled e-mail reports) are
out of scope.

## 5. Cross-cutting

**Audit log**: every new write is audited (`farm.archived/restored` with `via: 'platform'` and reason;
`admin.order.contact_viewed`). Reads of lists/details are not audited (same as users/registrations today), except the
contact reveal.

**Indexes** (declared in the models, created by `db indexes --apply`; no migration needed):

| Collection     | Index                                       | For                                             |
| -------------- | ------------------------------------------- | ----------------------------------------------- |
| `orders`       | `{ status: 1, createdAt: -1, _id: -1 }`     | admin list filtered by status, newest first     |
| `orders`       | `{ buyerId: 1, createdAt: -1, _id: -1 }`    | exists — buyer filter                           |
| `orders`       | `{ createdAt: 1 }`, `{ orderNo: 1 }`        | exist — date range, order number                |
| `farms`        | `{ 'location.province': 1, createdAt: -1 }` | admin farm list by province                     |
| `farm_members` | `{ userId: 1 }`                             | exists — owner filter (owner ids → their farms) |

Each list query gets a `test/qa/query-plans.test.ts` case (IXSCAN, no COLLSCAN), like the existing admin lists.

**QA gates**: new routes change `routes.snapshot.txt`; the permission matrix gains the new routes under `farms.read`,
`farms.manage`, `payments.read` (and `farms.archive` if D1). No route is public or self-service, so
`authz-allowlists.ts` does not change. If D1 adds `farms.archive`, it goes into `PERMISSION_KEYS`, `rbac/definitions.ts`
(admin and super_admin only), `syncRbac`, the admin i18n permission names, and the permission-matrix snapshot.

**i18n**: all new text in `components/admin/i18n.tsx` catalogs (TH and EN, same keys). **Mobile**: none (admin is web only).

## 6. Decisions needed

| #   | Question                                                                          | Recommendation                                                                                                                         |
| --- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | May platform staff archive/restore a farm? (Today only its owner can, by design.) | Yes, with a **new** permission `farms.archive` (admin, super_admin), mandatory reason, owner notified. Not by widening `farms.manage`. |
| D2  | Which permission guards the orders pages?                                         | Reuse `payments.read`.                                                                                                                 |
| D3  | Show buyers' delivery address/phone to staff?                                     | Masked by default; an audited "show contact" action.                                                                                   |
| D4  | Farm **suspension** (a state other than archived)?                                | Not now. It needs a new `FarmStatus` value that every client handles (expand → migrate → contract); plan separately if needed.         |

## 7. Order of work (one PR each)

1. **Orders read-only** — `GET /admin/orders`, `/admin/orders/:id`, the order index, page + tests (API, query plans,
   authz/permission snapshots, web unit tests, e2e: finance admin finds an order by number).
2. **Farms read-only** — `GET /admin/farms`, `/admin/farms/:farmId`, province index, pages + tests.
3. **Reports catalogue** — web only, on the existing export API.
4. **Platform archive/restore** (only if D1) — permission, endpoints, audit, owner notification, UI, tests.
5. **Contact reveal** (only if D3) — endpoint, audit, UI.

Each PR follows CLAUDE.md: read this plan and `admin.md` first, regenerate QA snapshots after reviewing authorization,
update `docs/architecture/admin.md` ("Sections whose backend does not exist") as each section goes live.
