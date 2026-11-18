---
name: backend-optimization
description: Optimize Farm+ Node.js and Express backend performance, including middleware, authentication, authorization, service queries, API latency, concurrency and response handling.
---

# Farm+ Backend Optimization

## Role

Act as a Senior Node.js, Express and TypeScript Backend Performance Engineer.

Follow the repository CLAUDE.md.

## Architecture

- Express 5.
- Node.js >= 22.
- TypeScript.
- Mongoose.
- MongoDB Atlas.
- REST API under /api/v1.
- Feature modules under services/api/src/modules.
- Shared application services through AppContext.
- Errors through src/lib/errors.ts.

Preserve existing architecture.

## 1. Middleware Optimization

Inspect:

- Authentication middleware.
- Authorization middleware.
- Request validation.
- Logging.
- Error handling.
- Rate limiting.

Reduce unnecessary work per request.

Avoid repeated database lookups for information already available in request context.

Never skip authorization checks.

## 2. Authentication & Authorization

Preserve:

- JWT access tokens.
- Rotating refresh tokens.
- Admin MFA.
- OAuth authorization code + PKCE.
- Single-use OAuth state.
- Farm-scoped authorization.
- Permission checks.

Optimize through:

- Request-level data reuse.
- Batch queries.
- Parallel independent operations.
- Safe permission caching where justified.

Never weaken password hashing or token security.

Never bypass farm-access.ts.

Every farm-scoped handler must retain appropriate farm access verification and BOLA protection.

## 3. API Query Optimization

Inspect services for:

- Sequential awaits.
- N+1 queries.
- Unnecessary queries.
- Duplicate aggregation.
- Full document loading.
- Unnecessary provider calls.

Use Promise.all only when operations are independent.

Use batch queries when multiple records can be retrieved together.

Respect transaction boundaries and dependencies.

## 4. API Response Optimization

- Return only required fields.
- Avoid unnecessary nested data.
- Avoid serializing large history arrays.
- Preserve existing DTO structures.
- Avoid exposing sensitive fields.
- Evaluate compression only after checking existing infrastructure.

Do not change API response formats without approval.

## 5. Service-Level Optimization

Pay special attention to:

- Farms.
- Animals.
- Health records.
- Feeding records.
- Weight records.
- Breeding records.
- Orders.
- Cart.
- Marketplace.
- Products.
- Notifications.
- Chat.

For each service:

1. Inspect its route and controller.
2. Inspect the model and schema.
3. Identify its query patterns.
4. Optimize the service layer.
5. Verify the controller contract.
6. Test existing workflows.

## 6. Concurrency and Resource Management

Inspect:

- MongoDB connection reuse.
- Connection pool usage.
- Async operations.
- Memory allocation.
- Large response serialization.
- CPU-intensive tasks.
- Event listener lifecycle.

Do not increase concurrency without considering connection pool and downstream limits.

Do not increase maxPoolSize based on guesswork.

## 7. Error Handling

Use existing helpers from:

src/lib/errors.ts

Preserve stable error codes.

Never swallow errors silently.

Avoid exposing stack traces, secrets or internal database details to clients.

## 8. Audit Logs

Preserve meaningful audit events.

Do not generate audit writes for ordinary read-only requests unless required by existing security or business requirements.

Never remove financial, permission or important transaction audit records without approval.

## 9. Testing

Use targeted tests first.

Example:

```bash
cd services/api
npx vitest run test/farms.test.ts
```

Run relevant tests for:

- Authentication.
- Authorization.
- Farm access.
- Service behavior.
- API responses.
- Error handling.

API tests must use mongodb-memory-server, never Atlas.

## 10. Final Report

Report:

- Backend files modified.
- Middleware changes.
- Query improvements.
- API latency before/after.
- Security tests.
- Regression tests.
- Remaining issues.

Do not claim unmeasured improvements.
