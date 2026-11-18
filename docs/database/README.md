# Database (MongoDB / Mongoose)

Only the API talks to MongoDB (`MONGODB_URI`, server-only). Indexes are built at startup (`syncIndexes`).

| Collection            | Purpose                                                                                       | Notable indexes                                |
| --------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `users`               | accounts, status, MFA state (TOTP secret **encrypted** AES-256-GCM, recovery code **hashes**) | unique partial `email`, unique partial `phone` |
| `roles`               | `key`, `isSystem`, `requiresMfa`                                                              | unique `key`                                   |
| `permissions`         | permission catalogue                                                                          | unique `key`                                   |
| `user_roles`          | user ↔ role, `grantedBy`                                                                      | unique `(userId, roleId)`                      |
| `role_permissions`    | role ↔ permission                                                                             | unique `(roleId, permissionId)`                |
| `sessions`            | one per login; `mfaVerified`, `revokedAt`, absolute `expiresAt`                               | TTL on `expiresAt`                             |
| `refresh_tokens`      | SHA-256 of opaque token, `rotatedAt` (reuse detection)                                        | unique `tokenHash`, TTL                        |
| `verification_tokens` | hashed email/phone/reset tokens, `attempts`                                                   | TTL on `expiresAt`                             |
| `audit_logs`          | who did what to whom (no secrets)                                                             | `actorId`, `action`, `createdAt`               |

Roles and permissions are seeded idempotently at API start (`rbac/seed.ts`); edits made through the API are kept.

## Farm management (Part 07)

| Collection     | Purpose                                                                                                   | Notable indexes                                                                                                                                               |
| -------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `farms`        | profile, location, contact, status, `animalSeq` counter                                                   | `status`, `name`                                                                                                                                              |
| `farm_members` | user ↔ farm with `role` (owner/manager/worker/viewer)                                                     | unique `(farmId, userId)`, `userId`                                                                                                                           |
| `animal_types` | configurable species with embedded `breeds[]`                                                             | unique `key`                                                                                                                                                  |
| `animals`      | inventory: identity, type/breed, sex, dates, origin, status, parent ids, `media[]` (URLs), archive fields | **unique `(farmId, animalCode)` case-insensitive**; `(farmId, archivedAt, currentStatus)`, `(farmId, animalTypeId)`, `(farmId, createdAt)`, `sireId`, `damId` |

## Records (Part 08)

All five share `record-base`: `farmId`, `revision`, `createdBy`, `updatedBy`, `voided*`, `attachments[]`, `history[]` (see [records.md](../architecture/records.md)).
Records are never deleted.

| Collection         | Purpose                                                               | Notable indexes                                                                                                                                      |
| ------------------ | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `breeding_records` | dam/sire (or external sire), method, status, delivery + offspring     | `(farmId, damId, breedingDate)`, `(farmId, sireId, breedingDate)`, `(farmId, status)`, **unique `delivery.offspring.animalId` where `voided:false`** |
| `health_records`   | illness/treatment/vaccination/recovery/checkup with provenance fields | `(farmId, animalId, recordedOn)`                                                                                                                     |
| `weight_records`   | weighings (kg)                                                        | `(farmId, animalId, weighedOn)`                                                                                                                      |
| `feeding_records`  | feeding logs and schedules (animal, group or whole farm)              | `(farmId, animalId, date)`, `(farmId, kind, date)`                                                                                                   |
| `farm_expenses`    | costs as integer satang (`amountMinor`), category, optional animal    | `(farmId, expenseDate)`, `(farmId, category, expenseDate)`, `(farmId, animalId, expenseDate)`                                                        |

`animal_types` gained optional `gestationDays`, `minBreedingAgeDays`, `maxWeightKg`.

## Community (Part 09)

See [community.md](../architecture/community.md). Content is soft-deleted/moderated by `status`, never physically removed.

| Collection        | Purpose                                                    | Notable indexes                                                                                                 |
| ----------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `posts`           | feed posts, external media links, counters, moderation log | `(status, visibility, createdAt, _id)`, `(authorId, status, createdAt, _id)`, `(…, createdAt, engagement, _id)` |
| `comments`        | comments and one level of replies                          | `(postId, parentId, createdAt, _id)`, `(authorId, createdAt)`                                                   |
| `reactions`       | likes on posts/comments                                    | **unique `(targetType, targetId, userId)`**, `(userId, targetType, targetId)`                                   |
| `follows`         | follower → followee                                        | **unique `(followerId, followeeId)`**, `(followeeId, followerId)`                                               |
| `content_reports` | reports with an evidence snapshot and resolution           | **unique `(reporterId, targetType, targetId)` where `status: 'open'`**, `(status, createdAt, _id)`              |

## Video & live (Part 10)

See [video.md](../architecture/video.md). Files live at the external provider; only metadata is stored here.

| Collection      | Purpose                                                                           | Notable indexes                                                                                                                                                    |
| --------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `media`         | short videos: metadata, processing state, provider asset id, counters, moderation | `(status, visibility, processing.state, createdAt, _id)`, `(ownerId, createdAt, _id)`, unique `(provider, providerAssetId)`, `(processing.state, uploadExpiresAt)` |
| `live_sessions` | live streams: host, access, state, provider input id (no stream key)              | **unique `(hostId)` where state ∈ created/live/interrupted**, unique `(provider, providerInputId)`, `(state, status, createdAt, _id)`                              |
| `video_metrics` | one row per (video, viewer): last counted view → deduplication                    | **unique `(videoId, viewerId, kind)`**                                                                                                                             |

`comments.targetType` (`post`|`video`), `reactions.targetType` (+`video`) and `content_reports.targetType` (+`video`,`live`) were extended; existing rows default to `post`.

## Marketplace (Part 11)

See [marketplace.md](../architecture/marketplace.md). Money is integer satang.

| Collection          | Purpose                                                                   | Notable indexes                                                                                                                                                             |
| ------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `listings`          | animal listings: snapshot, price, terms, status, reservation              | **unique `(animalId)` where status ∈ open statuses**, `(status, activatedAt, _id)`, `(status, askingPriceMinor, _id)`, `(farmId, status, createdAt)`, `(status, expiresAt)` |
| `negotiations`      | one per (listing, buyer); append-only `history[]` of offers and decisions | **unique `(listingId, buyerId)`**, `(buyerId, updatedAt)`, `(farmId, status, updatedAt)`, `(status, offerExpiresAt)`                                                        |
| `listing_events`    | append-only audit trail of status changes and negotiation steps           | `(listingId, at, _id)`                                                                                                                                                      |
| `listing_favorites` | saved listings                                                            | **unique `(userId, listingId)`**                                                                                                                                            |

## Orders & shipping (Part 12)

See [orders.md](../architecture/orders.md). Money is integer satang.

| Collection        | Purpose                                                             | Notable indexes                                                                                          |
| ----------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `orders`          | frozen items/totals, encrypted address, status, append-only history | **unique `orderNo`**, **unique `negotiationId`**, unique sparse `paymentRef`, buyer/seller/farm listings |
| `shipments`       | one per shipping attempt; carrier, tracking, append-only events     | **unique `(orderId, attempt)`**, unique sparse `(carrier, trackingNumber)`                               |
| `shipping_quotes` | short-lived quotes with options and `termsHash`; single use         | TTL `purgeAt`                                                                                            |

## Finance (Part 13)

See [finance.md](../architecture/finance.md). Money is integer satang. `wallet_transactions` and `financial_audit_logs` are append-only.

| Collection             | Purpose                                                                                                             | Notable indexes                                                                                                                                                             |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `payments`             | one per payment attempt; frozen amount, provider reference, disposition                                             | **unique `(orderId, idempotencyKey)`**, **unique `(orderId)` where status = pending**, **unique `(orderId)` where disposition = applied**, unique `(provider, providerRef)` |
| `wallets`              | balance projection (seller earnings; platform/shipping/provider/suspense/payout accounts); encrypted payout account | **unique `(kind, ownerId, currency)`**                                                                                                                                      |
| `wallet_transactions`  | the ledger: balanced journals, signed amounts                                                                       | **unique `(journalKey, lineNo)`**, `(walletId, createdAt)`                                                                                                                  |
| `commission_rules`     | fee rules (bps, bounds, price range, categories, window, priority)                                                  | `(active, startsAt, endsAt, priority)`                                                                                                                                      |
| `refunds`              | full refunds of a payment                                                                                           | **unique `(paymentId)`**, unique `refundNo`, unique `(provider, providerRef)`                                                                                               |
| `withdrawals`          | seller payout requests; destination snapshot encrypted                                                              | unique `withdrawalNo`, **unique `(sellerId, idempotencyKey)`**                                                                                                              |
| `financial_audit_logs` | hash-chained audit trail                                                                                            | **unique `(seq)`**                                                                                                                                                          |

`orders` gained `feeSnapshot` (frozen fee calculation).

## Products marketplace (Part 14)

See [products.md](../architecture/products.md). Money is integer satang. `inventory_movements` is append-only.

| Collection            | Purpose                                                               | Notable indexes                                                                                          |
| --------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `product_categories`  | categories and their compliance gate                                  | **unique `key`**                                                                                         |
| `products`            | farm products; `stock`/`reserved` are projections of the movement log | unique `(farmId, sku)` when SKU given, `(status, categoryKey, createdAt)`, `(farmId, status, createdAt)` |
| `inventory_movements` | stock ledger                                                          | **unique `(orderId, productId, type)`** when order-linked, `(productId, createdAt)`                      |
| `carts`               | one per user (ids and quantities)                                     | **unique `userId`**                                                                                      |
| `product_reviews`     | verified-purchase reviews                                             | **unique `(productId, buyerId)`**                                                                        |

`orders` gained `kind` (`animal`/`product`); `listingId` and `negotiationId` are optional (the unique `negotiationId` index is now partial, for animal orders only) and `shippingSnapshot.quoteId` may be null (seller-rate shop orders).

## AI assessment (Part 15)

See [ai-assessment.md](../architecture/ai-assessment.md). `ai_assessments` and `ai_usage_logs` hold no personal free text.

| Collection         | Purpose                                                                        | Notable indexes                                                                 |
| ------------------ | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| `ai_assessments`   | immutable calculated result + minimised inputs + model version; owner's review | `(farmId, animalId, assessmentDate)`, `(farmId, review.status, assessmentDate)` |
| `ai_criteria`      | versioned, sourced readiness rules per animal type                             | **unique `(animalTypeKey, version)`**, **unique active per type**               |
| `ai_market_prices` | imported market observations with source and authorisation                     | `(animalTypeKey, kind, active, observedOn)`                                     |
| `ai_usage_logs`    | one row per AI call: tokens, cost, latency, status, error code                 | `(createdAt)`, `(userId, createdAt)`                                            |

## Analytics (Part 16)

No new collections. Indexes added to support the report pipelines (each verified with `explain()` in `analytics.test.ts`): `orders (farmId, paidAt)`, `(paidAt)`, `(farmId, createdAt)`, `(createdAt)`; and date-leading indexes on `health_records`, `feeding_records`, `weight_records`, `users`, `farms`, `payments`, `refunds`, `withdrawals`, `wallet_transactions` and `ai_assessments` (see each model). New setting: `analytics.cacheSeconds`.

## Notifications & messaging (Part 17)

See [messaging.md](../architecture/messaging.md). Chat text lives only in `messages`; notifications never copy it.

| Collection                 | Purpose                                                 | Notable indexes                                                                                                                                  |
| -------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `notifications`            | in-app notifications                                    | `(userId, _id)`, `(userId, readAt, category)`, **unique `(userId, eventKey)`** and **`(userId, groupKey)`** (partial), TTL 180 days              |
| `notification_preferences` | per-user category overrides                             | **unique `userId`**                                                                                                                              |
| `conversations`            | one thread per buyer and farm, message counter          | **unique `(buyerId, farmId)`**, `(buyerId, lastMessageAt)`, `(farmId, lastMessageAt)`                                                            |
| `messages`                 | chat messages (`seq`, side, `readAt` of the other side) | **unique `(conversationId, seq)`**, unique `(conversationId, senderId, clientId)` (partial), `(buyerId, side, readAt)`, `(farmId, side, readAt)` |
| `chat_blocks`              | a side's block of a conversation                        | **unique `(farmId, buyerId, by)`**                                                                                                               |
| `message_reports`          | reports with a copy of the evidence                     | `(status, _id)`, **unique open `(reporterId, conversationId)`** (partial)                                                                        |
| `chat_restrictions`        | people whose messaging a moderator restricted           | **unique `userId`**                                                                                                                              |

Settings added: `chat.messagesPerMinute`, `chat.newConversationsPerDay`.
