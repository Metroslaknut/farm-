---
name: mongodb-optimization
description: Optimize MongoDB Atlas and Mongoose queries, indexes, aggregation pipelines, pagination, and database performance in Farm+. Use when working on slow queries, N+1 queries, database round trips, collection indexes, or data access patterns.
---

# Farm+ MongoDB Optimization

## Role

Act as a Senior MongoDB Database Performance Engineer.

Follow CLAUDE.md and existing database architecture.

## Database Rules

- MongoDB Atlas is the source of truth.
- Use existing Mongoose models and schemas.
- Every model must be registered in src/db/registry.ts.
- Schema and index changes must follow src/db/migrations/index.ts.
- Follow docs/ops/migrations.md.
- Migrations must be forward-only and idempotent.
- Use expand → migrate → contract.

## 1. Query Analysis

For every expensive query:

1. Identify the collection.
2. Identify filter conditions.
3. Identify sorting requirements.
4. Identify pagination strategy.
5. Inspect current indexes.
6. Check projection.
7. Check query frequency.
8. Identify sequential database calls.
9. Identify possible N+1 queries.

Use explain("executionStats") when available.

Inspect:

- COLLSCAN
- IXSCAN
- Documents examined
- Documents returned
- Execution time
- Sort stages
- Keys examined

Do not assume an index is useful merely because it exists.

## 2. Index Optimization

Design indexes according to actual query patterns.

Consider:

- Equality filters.
- Sort fields.
- Range filters.
- Compound indexes.
- Partial indexes where appropriate.
- Unique constraints where required.

For Farm+:

- farmId
- userId
- animalId
- status
- createdAt
- updatedAt
- conversationId
- readAt
- orderId
- productId

Example query:

```js
{ farmId, createdAt: -1, _id: -1 }
```

Potential index:

```js
{ farmId: 1, createdAt: -1, _id: -1 }
```

This is only an example. Verify the actual schema and query before creating the index.

Never create duplicate or speculative indexes.

## 3. N+1 Query Prevention

Identify loops containing database operations.

Avoid:

```ts
for (const item of items) {
  await Model.findById(item.id);
}
```

Prefer:

```ts
const ids = items.map((item) => item.id);
const records = await Model.find({
  _id: { $in: ids },
}).lean();
```

Map the results back to the original records.

Preserve result ordering and missing-record behavior.

## 4. Mongoose Optimization

Use .lean() for read-only queries that do not require document methods, getters, setters or virtual behavior.

Use .select() to retrieve required fields only.

Avoid retrieving:

- Unused arrays.
- Large history fields.
- Unnecessary nested objects.
- Sensitive fields not required by the response.

Do not blindly apply lean to queries that depend on Mongoose document behavior.

## 5. Aggregation Optimization

For expensive pipelines:

- Apply selective $match early.
- Reduce documents before $lookup.
- Avoid unnecessary $unwind.
- Project required fields.
- Remove duplicate computations.
- Avoid loading entire collection data.
- Evaluate $group and $facet costs.
- Preserve result semantics.

Consider precomputed summary collections only when repeated expensive computations justify the added write and synchronization complexity.

## 6. Pagination

Prefer cursor-based pagination for large collections.

Use stable sort fields such as:

- createdAt
- _id

Ensure next-page queries do not duplicate or skip records under normal concurrent inserts.

Preserve existing API contracts unless migration is approved.

Avoid deep skip pagination for large datasets.

## 7. Search Optimization

Inspect regex queries.

Determine whether the regex can use an index.

Evaluate:

- Normalized search fields.
- Prefix search.
- MongoDB text indexes.
- Atlas Search.
- Thai-language search requirements.

Do not assume standard MongoDB text search provides accurate Thai tokenization.

Do not replace the search engine without testing Thai and English results.

## 8. Cache Consistency

MongoDB remains the source of truth.

Before caching, define:

- Cache key.
- TTL.
- Invalidation events.
- Multi-instance behavior.
- Failure fallback.
- Data consistency requirements.

Do not cache critical transactional decisions.

Redis is not the default solution.

## 9. Migration Safety

Before changing indexes or schemas:

1. Inspect actual indexes.
2. Check existing data.
3. Review migration conventions.
4. Check compatibility with old documents.
5. Prepare rollback or recovery strategy.
6. Confirm production impact.

Never drop an index or delete data without explicit authorization.

## 10. Testing

Run relevant API tests using mongodb-memory-server.

Never run API tests against Atlas.

Use:

```bash
pnpm --filter @farmplus/api db indexes
```

Use --apply only when explicitly approved and after reviewing the proposed changes.

## Final Report

Document:

- Query before and after.
- Index changes.
- Documents examined.
- Execution statistics.
- API compatibility.
- Tests.
- Remaining bottlenecks.

Never fabricate MongoDB metrics.
