# Security & quality assurance (Part 18)

The pre-release audit of FARM+: what was tested, how to run it, what was found and fixed, and what remains. Start with the summary
below; details are in the linked documents.

| Document                                             | Content                                                                                      |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| [security-audit.md](security-audit.md)               | The security checklist item by item: status, the tests that prove it, findings               |
| [financial-test-cases.md](financial-test-cases.md)   | The required financial cases mapped to executable tests, plus the system-wide invariant test |
| [load-test-results.md](load-test-results.md)         | Method, numbers, interpretation and limits of the load/performance run                       |
| [risks-and-limitations.md](risks-and-limitations.md) | Risk register: known limitations, residual risks, what must happen before launch             |
| [audit-waivers.json](audit-waivers.json)             | The reviewed, expiring exceptions to the dependency policy                                   |

## Results of the final run (13 Oct 2026, macOS arm64, Node 26, in-memory MongoDB, no git history available)

| Layer                                                                                                         | How it runs                           | Result                                                                                                  |
| ------------------------------------------------------------------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Unit tests (pure logic: commission maths, state machines, CSV, ranges, env validation, redaction, signatures) | `pnpm test`                           | included in the counts below                                                                            |
| API integration tests (HTTP through the real Express app)                                                     | `pnpm --filter @farmplus/api test`    | **958 passed** in 38 files                                                                              |
| Database integration tests (real MongoDB: indexes, migrations, backup/restore, query plans, concurrency)      | same                                  | included above (`db-ops`, `registry`, `qa/query-plans`, `finance`, `shop`, …)                           |
| Authorization tests                                                                                           | same                                  | `qa/authz-matrix`, `qa/permission-matrix`, plus feature suites (`rbac`, `farms`, `chat`, …)             |
| Financial workflow tests                                                                                      | same                                  | `finance`, `orders`, `shop`, `qa/financial-qa` — see [financial-test-cases.md](financial-test-cases.md) |
| Web component tests                                                                                           | `pnpm --filter @farmplus/web test`    | **272 passed** in 17 files                                                                              |
| Mobile tests                                                                                                  | `pnpm --filter @farmplus/mobile test` | **155 passed** in 11 files                                                                              |
| End-to-end tests (real browser, real API + Socket.IO, in-memory MongoDB)                                      | `pnpm e2e`                            | **6 passed** (Google Chrome locally; Chromium in CI)                                                    |
| Performance and load tests                                                                                    | `pnpm load`                           | **no errors or unexpected statuses**, numbers in [load-test-results.md](load-test-results.md)           |
| Dependency policy                                                                                             | `pnpm qa:audit`                       | 0 failing; 5 advisories, all in build tooling (2 high waived with expiry)                               |
| Static checks                                                                                                 | `pnpm check`                          | types, lint, formatting: clean                                                                          |

`pnpm check` (types + lint + formatting + all unit/integration tests) passes. End-to-end and load tests are separate commands (they need a
browser / take longer) and run in the `e2e` CI job and on demand.

## Findings fixed during this audit

| #   | Finding                                                                                                                                                                                                                                                         | Severity                                       | Fix                                                            | Proof                                                                                                                |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| F1  | Identity/seller **registration documents** accepted any https URL; administrators open these links, so an applicant could send reviewers to an arbitrary site. Every other user-supplied media URL already obeyed the host allow-list                           | Medium                                         | Same allow-list applied in the registration route              | `qa/security-dynamic` "registration documents obey the allow-list" (16 hostile URLs incl. userinfo/subdomain tricks) |
| F2  | **Every payment, refund and payout callback (and reconciliation) scanned its whole collection**: the lookup `(provider, providerRef)` could not use the partial unique index. Cost grows with payment history; a callback flood becomes a database load problem | Medium (performance / availability)            | `byProviderRef()` adds the `$type` predicate the planner needs | `qa/query-plans` (explain → no COLLSCAN) + a static guard against the old pattern                                    |
| F3  | `calculateCommission` multiplied `price × bps` in floating point: for very large amounts the fee could be off by one satang, and unsafe integers were accepted                                                                                                  | Low (latent: prices are capped far below this) | Exact `BigInt` arithmetic + safe-integer check                 | `qa/financial-qa` (cases where the float result is provably wrong)                                                   |
| F4  | 35 uses of Mongoose's removed-in-future `{ new: true }` option (deprecation warnings on every call)                                                                                                                                                             | Low (future breakage, log noise)               | `returnDocument: 'after'/'before'`                             | the full suite and the load run (0 stderr lines)                                                                     |
| F5  | The chat thread silently bounced a user to the list when access was revoked, instead of saying why                                                                                                                                                              | Low (UX; no data was shown)                    | Shows "You no longer have access" in place, clears the thread  | web test + browser e2e                                                                                               |
| F6  | The CI workflow file added in Part 19 was invalid YAML (`:` in a job name)                                                                                                                                                                                      | Medium (CI would not have run)                 | Quoted                                                         | `pnpm format:check` now validates it                                                                                 |

**No critical authorization failure was found.** The matrices below enumerate all 313 routes and found no route reachable by a caller it should refuse;
that is evidence, not proof (see risks).

## How to run

```bash
pnpm check                                   # types, lint, formatting, unit + integration tests (API, web, mobile)
pnpm qa:audit                                # dependency policy (needs network access to the registry)
E2E_CHROME=1 pnpm e2e                        # end-to-end with the locally installed Chrome; in CI: playwright install chromium first
pnpm load                                    # load test (LOAD_ANIMALS, LOAD_LISTINGS, LOAD_DURATION tune it)
UPDATE_QA_SNAPSHOTS=1 pnpm --filter @farmplus/api test -- test/qa    # accept a reviewed change to the route / permission snapshots
```
