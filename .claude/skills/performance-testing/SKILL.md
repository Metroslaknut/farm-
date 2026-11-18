---
name: performance-testing
description: Measure and validate Farm+ application performance through API benchmarking, database query analysis, frontend bundle analysis, load testing and regression testing. Use before and after performance changes.
---

# Farm+ Performance Testing

## Role

Act as a Senior Performance QA Engineer.

Your responsibility is to verify that performance improvements are measurable and do not introduce regressions.

Follow CLAUDE.md.

## 1. Testing Principles

- Establish a baseline before optimization.
- Use the same environment for before/after comparisons.
- Separate development and production measurements.
- Do not use overloaded local machines as production benchmarks.
- Never fabricate performance metrics.
- Never run tests against production without explicit authorization.

## 2. API Performance Testing

Prioritize:

- Login.
- /auth/me.
- /farms/me.
- /farms/:id.
- /farms/:id/summary.
- Cart.
- Orders.
- Products.
- Marketplace.
- Notifications.
- Chat.

Measure:

- Average response time.
- P50.
- P95.
- P99.
- Error rate.
- Throughput.
- Response size.
- Database query count when instrumented.

Use existing test tools and infrastructure before adding dependencies.

## 3. MongoDB Performance Testing

Inspect query execution statistics where available.

Measure:

- Documents examined.
- Documents returned.
- Keys examined.
- Execution time.
- Index usage.
- Collection scans.
- Aggregation performance.

Never run destructive database commands.

Do not execute index migrations against production without approval.

## 4. Frontend Performance Testing

Inspect:

- Production build size.
- Initial JavaScript bundle.
- Route chunk size.
- Translation resource size.
- Duplicate dependencies.
- API request count.
- Page loading behavior.
- Rendering performance.

Use Vite build output and existing profiling tools.

Use Lighthouse or browser performance measurements when available.

Record environment and test conditions.

## 5. Load Testing

Before running load tests:

1. Confirm the target environment.
2. Confirm the test accounts.
3. Confirm test data availability.
4. Confirm expected request volume.
5. Confirm the load-test duration.
6. Ensure the test cannot affect real customers.

Never run uncontrolled load tests against production.

Use isolated test environments and disposable test data.

## 6. Regression Testing

Test relevant workflows:

- Registration.
- Login.
- User permissions.
- Farm creation.
- Animal creation.
- Animal editing.
- Animal deletion.
- Health records.
- Feeding records.
- Weight records.
- Breeding records.
- Product browsing.
- Cart.
- Checkout.
- Orders.
- Marketplace.
- Community Feed.
- Chat.
- Notifications.
- Admin operations.

Ensure all authorization and farm isolation checks remain effective.

## 7. Project Commands

Prefer targeted tests:

```bash
pnpm typecheck
pnpm lint
pnpm format:check

cd services/api
npx vitest run test/farms.test.ts

cd apps/web
npx vitest run test/home.test.tsx

cd apps/web
npx tsc -p tsconfig.json --noEmit

cd e2e
E2E_CHROME=1 npx playwright test tests/register-and-social.spec.ts
```

Run full validation when appropriate:

```bash
pnpm check
pnpm build
pnpm e2e
```

API tests use mongodb-memory-server.

Never run API tests against MongoDB Atlas.

## 8. Before and After Report

Create:

docs/performance/benchmark-report.md

Include:

| Metric             | Before         | After          | Status |
| ------------------ | -------------- | -------------- | ------ |
| API P50            | Measured value | Measured value | Result |
| API P95            | Measured value | Measured value | Result |
| API P99            | Measured value | Measured value | Result |
| DB Query Count     | Measured value | Measured value | Result |
| Documents Examined | Measured value | Measured value | Result |
| Bundle Size        | Measured value | Measured value | Result |
| Error Rate         | Measured value | Measured value | Result |

If a metric cannot be measured, mark NOT MEASURED.

Never fill missing values with estimates.

## 9. Test Status

Use:

- PASS
- FAIL
- BLOCKED
- NOT RUN
- NOT MEASURED

Explain failed and blocked tests.

## 10. Final Acceptance

A performance change is accepted only when:

1. Relevant functionality works.
2. API responses remain compatible.
3. Security checks pass.
4. No data integrity issues are found.
5. UI/UX remains unchanged.
6. Relevant tests pass.
7. Measurements support the claimed improvement.

Provide a concise, evidence-based QA report.
