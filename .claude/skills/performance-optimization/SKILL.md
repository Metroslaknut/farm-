---
name: performance-optimization
description: Analyze and optimize Farm+ full-stack application performance. Use when investigating slow pages, slow APIs, excessive database round trips, N+1 queries, high resource usage, or planning system-wide performance improvements.
---

# Farm+ Performance Optimization

## Role

Act as a Senior Full-Stack Performance Engineer responsible for improving the performance of Farm+ without breaking existing functionality.

Read the repository CLAUDE.md and follow all project-specific rules.

## Project Architecture

- Monorepo managed by pnpm 12.
- Node.js >= 22.
- Web: React 19, TypeScript, Vite, React Router.
- Mobile: Expo Router.
- API: Express 5, TypeScript, Mongoose.
- Database: MongoDB Atlas.
- Shared packages: shared-types, validation, api-client, config, i18n, shared-utils.
- API modules: services/api/src/modules.
- API prefix: /api/v1.

## Core Objectives

1. Reduce API response latency.
2. Reduce MongoDB round trips.
3. Eliminate unnecessary sequential database queries.
4. Resolve N+1 query problems.
5. Optimize expensive aggregation pipelines.
6. Reduce frontend bundle size.
7. Eliminate duplicate API requests.
8. Improve Farm Dashboard performance.
9. Reduce unnecessary CPU and memory consumption.
10. Maintain correctness, security and backward compatibility.

## Mandatory Workflow

### Step 1: Analyze

Before modifying code:

- Identify the affected feature and user workflow.
- Read its architecture documentation.
- Inspect relevant routes, controllers, services and models.
- Identify existing query patterns.
- Check existing indexes and cache mechanisms.
- Inspect relevant frontend components and data-fetching hooks.
- Identify tests covering the affected functionality.

Never scan the entire repository unnecessarily.

### Step 2: Measure

Collect available baseline metrics:

- API response time.
- P50, P95 and P99 latency when available.
- Database query count.
- Documents examined.
- Response payload size.
- Frontend bundle size.
- Loading and rendering behavior.

Distinguish measured values from estimates.

### Step 3: Plan

Classify issues:

- P0: Authentication, authorization, excessive database round trips, N+1 queries, Farm Dashboard.
- P1: MongoDB indexes, pagination, cart and duplicate API calls.
- P2: Frontend bundle, layout lifecycle, state management and caching.
- P3: Search infrastructure, compression and infrastructure tuning.

Document the implementation plan before making significant changes.

### Step 4: Implement

Fix root causes before introducing new infrastructure.

Preferred optimization order:

1. Remove unnecessary queries.
2. Batch independent queries.
3. Optimize database filters and projections.
4. Add appropriate indexes.
5. Optimize aggregation pipelines.
6. Introduce safe caching only when justified.
7. Optimize frontend data fetching.
8. Optimize bundle loading.
9. Tune infrastructure based on measured evidence.

### Step 5: Validate

After each module:

- Run targeted tests.
- Run relevant typecheck.
- Verify API response compatibility.
- Verify authorization behavior.
- Verify UI behavior.
- Inspect changed files.
- Record benchmark results.

### Step 6: Report

Create or update:

docs/performance/performance-optimization-report.md

Report:

- Root causes.
- Files modified.
- Changes implemented.
- Before/after measurements.
- Tests executed.
- Remaining issues.
- Blocked items.

## Mandatory Guardrails

### Architecture

- Optimize existing architecture first.
- Do not rewrite entire modules.
- Do not introduce Redis by default.
- Do not introduce unnecessary dependencies.
- Do not create duplicate services or data layers.

### Security

- Never bypass authentication.
- Never weaken authorization.
- Preserve farm-scoped access control.
- Preserve BOLA protections.
- Never expose sensitive user information.

### Database

- MongoDB remains the source of truth.
- Never delete production data.
- Never drop existing indexes without explicit approval.
- Follow existing migration conventions.
- All migrations must be idempotent and forward-only.

### Cache

- Cache only data that benefits from caching.
- Define TTL and invalidation.
- Handle multiple API instances.
- Do not trust stale cache for financial transactions, stock confirmation or permissions.

### Frontend

- Do not change UI/UX, CSS, colors, spacing, layout or components unless explicitly requested.
- Optimize data fetching and rendering only.
- Preserve existing responsive behavior.

## Performance Acceptance Criteria

A change is acceptable only when:

- Existing functionality remains correct.
- Relevant tests pass.
- Security behavior remains intact.
- API contracts remain compatible.
- UI has no regression.
- Performance improvement is supported by actual measurements.

Never claim improvement without evidence.

## Execution Rule

When invoked, investigate the requested performance problem and carry the work through implementation and validation when safe.

If a change requires a major architectural decision, production access or destructive operation, stop and request approval.
