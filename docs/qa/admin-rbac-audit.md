# FARM+ admin RBAC and authorization audit

**Date:** 2026-10-14 (Asia/Bangkok)  
**Environment:** Synthetic records in isolated `mongodb-memory-server`; no production role or permission data was changed.  
**Source of truth:** `packages/shared-types/src/rbac.ts`, `services/api/src/rbac/definitions.ts`, `services/api/src/rbac/access.ts` and `services/api/src/rbac/seed.ts`.

## Actual roles and permissions

The repository defines all nine requested roles. Six are administrative roles that require an MFA-verified session. `farm_owner`, `seller`, and `buyer` hold no global platform permissions; their ordinary access is resource/member scoped. The matrix below is the default mapping in `ROLE_DEFINITIONS`. Super admin has every current permission, explicitly enumerated by `PERMISSION_KEYS` rather than a wildcard grant.

Permission key abbreviations:

| Short key | Permission              |
| --------- | ----------------------- |
| UR        | `users.read`            |
| UU        | `users.update`          |
| US        | `users.suspend`         |
| RR        | `registrations.review`  |
| RA        | `registrations.approve` |
| PR        | `payments.read`         |
| PV        | `payments.verify`       |
| PF        | `payments.refund`       |
| WA        | `withdrawals.approve`   |
| RoR       | `roles.read`            |
| RoM       | `roles.manage`          |
| PM        | `permissions.manage`    |
| FR        | `farms.read`            |
| FM        | `farms.manage`          |
| LM        | `listings.moderate`     |
| CM        | `commissions.manage`    |
| RRpt      | `reports.read`          |
| AL        | `audit_logs.read`       |
| SR        | `settings.read`         |
| SM        | `settings.manage`       |
| ATM       | `animal_types.manage`   |
| CMod      | `content.moderate`      |

| Role                 | MFA                  | Default permissions                                                                                               |
| -------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `super_admin`        | Required             | All 22 permissions: UR, UU, US, RR, RA, PR, PV, PF, WA, RoR, RoM, PM, FR, FM, LM, CM, RRpt, AL, SR, SM, ATM, CMod |
| `admin`              | Required             | UR, UU, US, RR, RA, RoR, RoM, FR, FM, LM, RRpt, AL, SR, ATM, CMod                                                 |
| `registration_admin` | Required             | UR, RR, RA                                                                                                        |
| `finance_admin`      | Required             | UR, PR, PV, PF, WA, CM, RRpt                                                                                      |
| `moderator`          | Required             | UR, FR, LM, RRpt, CMod                                                                                            |
| `support`            | Required             | UR, FR                                                                                                            |
| `farm_owner`         | Not required by role | None globally; farm membership/ownership applies                                                                  |
| `seller`             | Not required by role | None globally; seller/resource ownership applies                                                                  |
| `buyer`              | Not required by role | None globally; buyer/resource ownership applies                                                                   |

These are seed-time defaults: `syncRbac` preserves later administrator-approved changes to existing roles. `super_admin` is replenished with newly introduced permission keys and cannot be edited through the role API.

## Endpoint inventory and test scope

`services/api/test/qa/routes.snapshot.txt` enumerates **313 API routes**; `authz-matrix.test.ts` calls the route inventory directly, and snapshot changes fail pending review. The single-permission route snapshot in `permission-matrix.snapshot.json` tests every defined platform permission against every non-self-service, non-farm route. The detailed routes include:

- Admin: dashboard; users list/detail/status; registration list/detail/review/approve/reject/suspend/reinstate; roles list/detail/create/update; permissions list; settings read/update; audit log read.
- Admin finance: payment/refund/withdrawal and wallet transaction reads; payment reconciliation and audit-chain verification; refund approve/retry; withdrawal approve/reject/retry; commission rule read/create/preview/update.
- Admin AI, moderation and reporting: AI usage/criteria/market data; chat report list/detail/resolve/restrictions; analytics and export; dashboard; moderation list/actions.
- Direct sensitive APIs: `/api/v1/users`, `/api/v1/users/:id/roles`, `/api/v1/roles/:key/permissions`, `/api/v1/permissions`, `/api/v1/audit-logs`; all farm routes; and user-owned orders/conversations/payments/listings/animals.

The existing browser route tree wraps direct `/admin/...` navigation with the same permission list used to display its navigation (`apps/web/src/pages/admin/AdminApp.tsx`, `apps/web/src/components/admin/nav.ts`). UI guards are usability controls only; API middleware independently enforces endpoint permissions.

## Scenario results

| Scenario                                                         | Expected                                                                                     | Actual evidence/result                                                                                                                                                                                                                                                                                                                                                                                      |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| All nine role definitions                                        | Only repository-defined roles included; default permissions match definition                 | **PASS by source review.** The matrix above is transcribed from `ROLE_DEFINITIONS` and role keys from `ROLE_KEYS`.                                                                                                                                                                                                                                                                                          |
| Anonymous direct API calls                                       | 401 for every protected route; unsigned webhooks refused                                     | **PASS in existing suite** `admin-access.test.ts` and `qa/authz-matrix.test.ts`. Route inventory test covers all 313 routes.                                                                                                                                                                                                                                                                                |
| Buyer opens `/admin/users` or directly calls admin API           | UI login/forbidden; API 403                                                                  | **PASS in existing suites.** `apps/web/test/admin-guards.test.tsx`; `admin-access.test.ts` verifies authenticated ordinary user gets 403 on every admin endpoint; direct API used (no UI prerequisite).                                                                                                                                                                                                     |
| Per-role authorized and unauthorized read/write                  | Only roles with the specific permission may read/write                                       | **PASS:** new `rbac.test.ts` matrix directly calls user-list read and user-suspension write as each of the nine roles; expected outcomes are derived from `ROLE_DEFINITIONS`. `admin-access.test.ts` additionally checks each admin endpoint with only its required permission and with all other permissions. `permission-matrix.test.ts` compares all permission→route outcomes to the reviewed snapshot. |
| Seller reads another seller's order                              | Refuse without exposing or changing the order                                                | **PASS in `qa/authz-matrix.test.ts`** object-level checks with real synthetic resource IDs, and seller-specific order action checks.                                                                                                                                                                                                                                                                        |
| Farm owner edits another farm's animals                          | Refuse, hiding existence where supported                                                     | **PASS in `qa/authz-matrix.test.ts`**: a different farm owner and stranger are refused across all `:farmId` routes; expected 404.                                                                                                                                                                                                                                                                           |
| Support approves withdrawal                                      | 403; withdrawal unchanged                                                                    | **PASS after regression coverage added** to `finance.test.ts` targeted case below. The case now tests seller, moderator, support, and registration administrator before the finance administrator.                                                                                                                                                                                                          |
| Registration admin changes financial settings                    | 403                                                                                          | **PASS by permission matrix:** `commissions.manage` and finance endpoints are unavailable to `registration_admin`; direct regression case below is included in the updated finance test.                                                                                                                                                                                                                    |
| Finance admin grants `super_admin`                               | 403; target remains unchanged                                                                | **PASS after regression coverage added** in `rbac.test.ts`; direct POST to `/api/v1/users/:id/roles`, target remains buyer.                                                                                                                                                                                                                                                                                 |
| Ordinary user submits `role=super_admin` at registration/profile | Reject; role remains buyer                                                                   | **PASS in `auth.test.ts` and `rbac.test.ts`** registration rejects role selection; profile update rejects privileged fields.                                                                                                                                                                                                                                                                                |
| Identifier changed in URL (IDOR/BOLA)                            | Refuse foreign resource                                                                      | **PASS in `qa/authz-matrix.test.ts`** using actual synthetic order, negotiation, animal and conversation IDs; no order mutation. Farm IDs tested across every farm route.                                                                                                                                                                                                                                   |
| Revoked administrator reuses old token                           | Immediate refusal without token refresh                                                      | **PASS in `qa/security-dynamic.test.ts` and `rbac.test.ts`**: permissions re-resolve per request; elevated role revocation also terminates sessions.                                                                                                                                                                                                                                                        |
| Hidden admin endpoint called directly                            | API permission check still applies                                                           | **PASS in all-route matrices**; direct API requests are sent by test helpers without opening the web UI.                                                                                                                                                                                                                                                                                                    |
| Concurrent permission replacement                                | Result is one complete submitted permission set; never a mixed set                           | **PASS after fix:** concurrent test confirms the stored permissions equal one whole submitted set. A database-backed per-role lock serializes changes across API instances.                                                                                                                                                                                                                                 |
| Concurrent mutual revocation of two final super admins           | At least one super admin remains                                                             | **PASS after fix.** **FAIL reproduced before fix:** both revocations passed separate count checks and removed both grants. The regression now confirms one request wins and the other observes the remaining final holder and is refused.                                                                                                                                                                   |
| Audit of role changes                                            | Assignment/revocation and permission changes logged with actor and diff                      | **PASS in `rbac.test.ts` and `admin-modules.test.ts`**; exact actor/action/target/diff assertions exist.                                                                                                                                                                                                                                                                                                    |
| Least privilege and protected role                               | No default wildcard; only super admin can grant protected admin roles; super_admin immutable | **PASS by source and existing API tests**; `rbac.test.ts` checks escalation rejection and `ROLE_IMMUTABLE`. Final-holder race is covered by the new regression.                                                                                                                                                                                                                                             |

### Concurrent privilege-change fix

The reproduced race was:

1. Two super-admins each request revocation of the other's `super_admin` role.
2. Both requests read a count of two before either deletion completes.
3. Both delete successfully, leaving zero super-admin assignments.

`services/api/src/services/role.service.ts` now serializes role permission replacement and super-admin removal using an atomic MongoDB lease on the role document. The final-super-admin count and delete occur inside the serialized section. The lease is internal, token-guarded on release, expires after one minute to recover from a crashed process, and conflicting callers retry briefly before receiving `ROLE_CHANGE_BUSY`. Regression coverage is in `services/api/test/rbac.test.ts`.

## Fixes and regression tests

- **Confirmed high-severity defect:** concurrent mutually-targeted super-admin revocations could remove the final privileged role. Fixed with cross-instance database serialization; regression is the concurrent revocation test in `rbac.test.ts`.
- **Concurrent permission updates:** role permission delete/insert could interleave. Serialized the replacement operation and added a test that the resulting permissions equal one complete submitted set.
- Added direct high-risk negative assertions: finance admin cannot grant super_admin; support and registration_admin cannot approve a withdrawal; registration_admin cannot edit commission rules.
- No stored production role or permission records were touched. All test records are in the in-memory MongoDB fixture.

## Exact test commands and results

| Command                                                                                                                                                                                                                                           | Result                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cd apps/web && ./node_modules/.bin/vitest run test/admin-guards.test.tsx --reporter=dot`                                                                                                                                                         | **PASS:** 1 file, 13 tests. Anonymous route, permission denial, allowed route, MFA state and visible navigation checks.                                                                                                                                                                                                                             |
| `cd services/api && ./node_modules/.bin/vitest run test/qa/authz-matrix.test.ts test/qa/permission-matrix.test.ts test/admin-access.test.ts test/admin-modules.test.ts test/rbac.test.ts test/auth.test.ts --reporter=dot` (pre-fix baseline)     | **PASS:** 6 files, 109 tests. This run preceded the new concurrency and high-risk regressions.                                                                                                                                                                                                                                                      |
| `cd services/api && ./node_modules/.bin/vitest run test/rbac.test.ts -t 'concurrent super-admin revocations' --reporter=dot` (pre-fix reproduction)                                                                                               | **FAIL as expected:** 1 test failed, 28 skipped. Observed remaining `UserRole` count was 0. This is the confirmed defect evidence.                                                                                                                                                                                                                  |
| `cd services/api && ./node_modules/.bin/vitest run test/qa/authz-matrix.test.ts test/qa/permission-matrix.test.ts test/admin-access.test.ts test/admin-modules.test.ts test/rbac.test.ts test/auth.test.ts --reporter=dot` (post-fix broad rerun) | **PARTIAL:** 6 files, 111 passed, 1 failed. The sole failure was the existing TOTP replay test, which received a current-step code after the enrollment time-step changed. That test passed alone on immediate rerun (1 passed, 30 skipped). All authorization matrix, permission, audit, per-role and concurrency tests passed in that invocation. |
| Final targeted RBAC regressions (exact command below)                                                                                                                                                                                             | **PASS:** 2 files, 6 selected tests passed, 45 skipped by filter.                                                                                                                                                                                                                                                                                   |
| `cd services/api && ./node_modules/.bin/vitest run test/finance.test.ts -t 'only finance staff approve' --reporter=dot`                                                                                                                           | **PASS:** 1 selected test passed, 66 skipped by filter. Support, registration administrator and seller were refused; finance administrator approval continued through mock-provider assertions. Registration administrator commission-rule write was refused.                                                                                       |
| `cd services/api && ./node_modules/.bin/vitest run test/rbac.test.ts -t 'enrolling TOTP unlocks the permissions; later logins need a fresh code' --reporter=dot`                                                                                  | **PASS:** 1 selected TOTP test passed, 30 skipped by filter.                                                                                                                                                                                                                                                                                        |

Final targeted RBAC command:

```sh
cd services/api
./node_modules/.bin/vitest run test/rbac.test.ts test/admin-modules.test.ts -t 'each defined role|concurrent super-admin|concurrent permission replacements|finance administrator|super admin edits|creates custom roles' --reporter=dot
```

Additional checks:

- `cd services/api && ./node_modules/.bin/tsc -p tsconfig.json --noEmit` — **PASS**.
- `./node_modules/.bin/prettier --check services/api/src/models/rbac.model.ts services/api/src/services/role.service.ts services/api/test/rbac.test.ts services/api/test/finance.test.ts docs/qa/admin-rbac-audit.md` — **PASS** after formatting.

## Remaining access-control risks

- The lock is a one-minute lease rather than a database transaction. Critical operations are short, but a database stall longer than the lease could allow a second caller to acquire it; this should be monitored and considered for a transaction-backed implementation on the production replica set.
- The role→permission snapshot provides endpoint coverage for one permission at a time; composite role behavior follows union semantics. Future permissions and routes must be reviewed when snapshots change.
- Atlas, staging deployment, browser production headers, external identity providers and mobile devices were not part of this isolated test run.
- No independent penetration test was performed. Passing these automated tests is not a security certification.
