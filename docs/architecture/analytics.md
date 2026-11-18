# Analytics & reporting (Part 16)

Farm and platform dashboards with CSV export. Code: `services/api/src/modules/analytics/`; web: `/farms/:farmId/dashboard` and `/admin/analytics` (shared renderer in `apps/web/src/components/analytics/`). Web only; no mobile screens.

## Principles

- **Every figure is a named metric with a written definition** (`definitions.ts`: label, meaning, formula, what is counted, what is left out, source collection, caveats, and whether it follows the dates or is a snapshot of _now_). The API returns the definitions of exactly the metrics present next to the figures; the UI shows them under "How are these calculated?". A test fails if a returned metric has no definition.
- **Money vocabulary** — these are different numbers and are never mixed:
  | Term                                 | Meaning                                                                                                                                       |
  | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
  | **Gross sales** (farm)               | Item prices of orders _paid_ in the range whose status still stands (PAID, PROCESSING, SHIPPED, DELIVERED). Shipping is shown separately.     |
  | **Platform commission**              | `platformFeeMinor` snapshotted on those orders — the platform's revenue from sales.                                                           |
  | **Estimated net proceeds**           | gross sales − commission (= `sellerPayoutMinor`). **Not profit**; split into released (delivered) and pending.                                |
  | **Net proceeds over recorded costs** | estimated net proceeds − recorded expenses in the range. Indicative only: costs not entered are not counted. **Not profit.**                  |
  | **GMV** (admin)                      | Sum of item prices of standing paid orders. **Not** platform revenue.                                                                         |
  | **Commission booked in the ledger**  | Net of the platform wallet's ledger lines in the range, shown beside the order-derived commission because they are booked by different dates. |
- **Cancelled and refunded transactions** are excluded from gross sales/GMV/commission and shown on their own lines (`refundedGrossMinor`, `cancelledOrders`). Orders are classified by their status _now_ (a later refund moves the order out of the period it was paid in).
- **Dates**: calendar days in Thailand time (`Asia/Bangkok`, UTC+7), `from`/`to` inclusive, default the last 30 days, at most 366 days; daily grouping only up to 92 days (else week/month). Series are zero-filled and always add up to the headline total. Records are matched on the date that fits the metric (`paidAt` for sales, `createdAt` for orders placed, `weighedOn`, `expenseDate`…).
- **Filters**: farm — `animalType`, `orderKind` (animal/shop), `sections`; admin — `orderKind`. A filter that cannot apply to a metric says so in the section notes (e.g. farm-wide costs are left out when filtering by animal type).

## Authorization and scoping

- Farm dashboard: `loadFarmAccess` (members and platform staff with `farms.read`; strangers get 404). **Each section needs the same farm permission as the underlying screens**: costs need `expenses.read`; sales, listings, products need `listings.manage` (owner/manager). Workers/viewers get animals, growth, health, feeding and assessments only. Platform staff with only `farms.read` get the same non-financial sections; staff holding `farms.manage` have the financial permissions through the existing platform mapping. A section the caller may not see is returned as `{available: false, reason}` with **no data**.
- Every aggregation filters by the farm id taken from the authorised access, never from the query.
- Admin dashboard: each section needs a platform permission (`users.read`, `registrations.review`, `farms.read`, `reports.read`/`listings.moderate`, `payments.read` for orders/payments/commissions/refunds/payouts/alerts, moderation permissions for the moderation queue). No permission at all → 403. Moderation sub-metrics (listing queue vs content reports) follow `listings.moderate` / `content.moderate` separately.
- **Export respects the dashboard**: an export section is allowed exactly when the dashboard section it mirrors is (`orders`→`sales`, `signups`→`users`, …); otherwise 403. Exports use the same filters, are rate-limited more tightly, are audited (`analytics.export`, section, row count — never the data), and send `Cache-Control: no-store`.

## Export (CSV)

UTF-8 with BOM and CRLF (opens correctly in Excel); amounts in baht as plain numbers; values starting with `= + - @` (or tab/CR) are prefixed with `'` so spreadsheets do not run them as formulas; RFC 4180 quoting. Capped at 50,000 rows (`x-export-truncated: true` and a UI message when cut). **Not exported**: buyer identity or addresses, free-text health details (titles/notes), bank or payout account data.

## Aggregation and caching

- Pipelines start with an indexed `$match` (`farmId`+date or date alone) and group once; tests run `explain()` on each and fail on a collection scan. New indexes are listed in [database/README.md](../database/README.md).
- Reports are cached **in process** for `analytics.cacheSeconds` (setting, default 60, 0 disables). Justification: dashboards are opened often and each costs many aggregations over orders/records; one-minute staleness is acceptable for management figures. `?fresh=true` bypasses it, and the response says `cached: true` with `generatedAt`. The key contains the scope (farm id), exact range, filters and **the sections the caller is allowed to see** (admin: the exact permission set), and authorization always runs _before_ the cache is read, so a cached finance report can never be served to someone without the right. Limitations: the cache is per API instance (figures may differ by up to the TTL between instances) and is not invalidated by writes.

## Known limits

- Statuses and refunds are "as of now", not point-in-time history; there is no snapshotting of past dashboards.
- Admin "oldest pending" for listings uses `updatedAt` (listings keep no submission timestamp).
- Estimated net proceeds are calculated from the fee snapshotted on the order, not from provider settlement; they are an estimate for the seller, not an accounting figure.
- Charts are simple bars; series are not exported (tables and record-level CSV are).
