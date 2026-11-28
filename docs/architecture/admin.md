# Admin backoffice (Part 04)

## Backend (`services/api/src/modules/`)

`admin` (dashboard, users, router) · `registrations` · `roles` · `permissions` · `audit-logs` · `settings`.
Each has `*.routes.ts` (permission per route) → `*.controller.ts` (parse + call) → `*.service.ts` (rules).
Existing Part 03 services are **reused, not duplicated**: user suspension (`user.service.setUserStatus`), role
escalation rules and audit (`role.service`, `audit.service`). Part 03 endpoints (`/users`, `/roles`, `/audit-logs`) are unchanged.

### Four separate statuses (never one ambiguous field)

| Dimension             | Where                        | Values                                                                               |
| --------------------- | ---------------------------- | ------------------------------------------------------------------------------------ |
| Account status        | `users.status`               | pending_verification, active, suspended, deactivated                                 |
| Identity verification | `users.identityVerification` | unverified, pending, verified, rejected                                              |
| Seller verification   | `users.sellerVerification`   | none, pending, verified, rejected, suspended                                         |
| Subscription status   | `users.subscriptionStatus`   | none, active, past_due, cancelled, expired (read-only until a billing module exists) |

Registration (application) status is a fifth, independent lifecycle: `PENDING → UNDER_REVIEW → APPROVED | REJECTED`,
`APPROVED ⇄ SUSPENDED`. A registration outcome only touches the dimension it is about (identity → identity,
seller → seller + `seller` role, farm_owner → `farm_owner` role); it never changes the account status.

### Registration decisions

Atomic compare-and-set on status (two reviewers cannot both decide). Stores `decision {outcome, by, at, reason}` on the
record **and** an audit entry. Reason is mandatory. Reviewers cannot decide their own registration. Seller approval
requires verified identity (setting `registrations.requireIdentityForSeller`, default on). Review (`registrations.review`)
and decision (`registrations.approve`) are separate permissions. If the side effects fail, the status is rolled back.

### Roles

Custom roles can be created/edited. Any role that carries permissions is forced `requiresMfa` (and its existing holders'
sessions are revoked at that moment). Escalation rules from Part 03 apply (cannot grant permissions you lack;
`super_admin` immutable). Changing permissions additionally needs `permissions.manage`.

### Financial actions

No admin endpoint writes money-related data. Payments/refunds/withdrawals/wallet/commission modules do not exist yet;
when they do they must expose their own audited workflows and be mounted in `admin.routes.ts` with their own permissions.

## Frontend (`apps/web/src`)

- `pages/admin/<section>/` for all 17 sections; `components/admin/` holds AdminLayout, AdminSidebar, AdminHeader,
  AdminDataTable, SearchFilters, StatusBadge, ConfirmActionDialog, PermissionGuard, AuditHistoryPanel (+ StateMessage, ModuleUnavailable).
- `components/admin/nav.ts` is the single source for sidebar visibility **and** route guards (role-aware navigation).
- Routing: `/admin/*` is a lazy chunk; `/` and every other path still render the original public page untouched.
  Admin styles are namespaced `adm-` and loaded only with the admin chunk.
- Auth: `auth/` (in-memory access token, refresh token in `sessionStorage`, single-flight refresh, retry once on 401).
  `/admin/login` supports the MFA step; `/admin/account/security` enrols TOTP.
- `/admin/orders` and `/admin/orders/:id` are read-only (`payments.read`); the delivery contact is masked until
  "Show contact" (audited, rate limited). See [admin-farms-orders-reports.md](admin-farms-orders-reports.md) §3.
- List state (search/filter/sort/page) lives in the URL. Native `<dialog>` for confirmations; sensitive actions require a reason.
- Sections whose backend does not exist (payments, refunds, withdrawals, wallet transactions, commissions, farms,
  listings, products, reports) render an honest "not available yet" page behind the same permission guard — no fake data, no actions.

## Limitations

- The UI hides what you cannot use, but **only the API is the control** (every endpoint re-checks).
- Refresh token in `sessionStorage` is readable by XSS; an httpOnly cookie is the stronger follow-up.
- Existing databases: users created before this Part lack the new status fields until saved; filtering by them only matches new/updated users (no migration script was added).
- Applicants submit and follow **seller** and **identity** registrations on the web at `/farms/seller` (linked from the
  account menu, the farm menu and the "approved sellers only" notices on the listing/product forms). **farm_owner**
  requests have their own page, `/farms/owner-request`, linked from the "cannot create a farm yet" message (profile)
  and the empty farm list. An account that can already create farms is sent to the farm setup instead.
- No automated visual-regression tests; UI was verified with the component tests plus a scripted real-browser run (see report).
