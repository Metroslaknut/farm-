# Orders & Shipping (Part 12)

> Part 14 adds shop orders (`kind: 'product'`, created from the cart, one per seller farm) to the same module: same statuses, payment, refund, shipping and ledger rules; stock is reserved at checkout, deducted on payment and returned on cancel/refund — see [products.md](products.md). Re-quoting applies to animal orders only.

Orders are created from an **accepted negotiation** (Part 11). A product cart is not implemented (no product catalogue exists yet).
Money is integer satang. Shipping, item price and platform fee are always **separate fields** (`totals.itemsMinor`, `shippingMinor`, `platformFeeMinor`, `grandTotalMinor = items + shipping`; `sellerPayoutMinor = items − platformFee`; shipping is passed to the carrier, not to the platform). Since Part 13 the fee comes from the commission rules and is frozen on the order as `feeSnapshot` — see [finance.md](finance.md).

## Order status transitions (`ORDER_TRANSITIONS` in shared-types, enforced by one compare-and-set `move()`)

| From                             | To             | Who may do it                                      |
| -------------------------------- | -------------- | -------------------------------------------------- |
| PENDING_PAYMENT                  | PAID           | finance module, after a verified provider callback |
| PENDING_PAYMENT                  | CANCELLED      | buyer, seller, system (payment window)             |
| PAID                             | PROCESSING     | seller                                             |
| PAID                             | REFUND_PENDING | buyer, seller                                      |
| PROCESSING                       | SHIPPED        | seller (ship) / shipping callback                  |
| PROCESSING                       | DELIVERED      | buyer (pickup hand-over)                           |
| PROCESSING                       | REFUND_PENDING | buyer, seller                                      |
| SHIPPED                          | DELIVERED      | buyer confirm, system (auto-confirm)               |
| SHIPPED                          | REFUND_PENDING | seller, shipping (returned/failed final)           |
| REFUND_PENDING                   | REFUNDED       | payment provider webhook only                      |
| DELIVERED / CANCELLED / REFUNDED | — terminal     |                                                    |

Shipment statuses: pending → in_transit → out_for_delivery → delivered; failed/returned/cancelled branches (`SHIPMENT_TRANSITIONS`). Invalid jumps return 409; duplicate and stale provider events are ignored idempotently.

## Cancellation & refund rules

- **PENDING_PAYMENT**: buyer or seller may cancel; the listing reservation is released. Unpaid orders are cancelled automatically after `orders.paymentWindowHours` (default 24) by the cleanup job.
- **PAID / PROCESSING**: either party may cancel by requesting a refund → `REFUND_PENDING`; the full grand total (items + shipping) is refunded. A refund request is queued for finance approval (see [finance.md](finance.md)); the order becomes `REFUNDED` only when the payment provider confirms the refund. The listing is released.
- **SHIPPED**: the buyer cannot cancel; the shipment must be delivered, or returned (→ `REFUND_PENDING`).
- **DELIVERED**: final; disputes are out of scope for this part.
- Delivered by carrier → buyer has `orders.autoConfirmAt` (`orders.autoConfirmDays`, default 3) to confirm; otherwise the system confirms. Confirming completes the sale (listing → SOLD).
- Money movement is owned by the finance module (Part 13): payments, refunds, the ledger and seller payouts. The orders module only changes status when finance reports that money really arrived (`markOrderPaid`) or went back (`markOrderRefunded`), and calls back into finance when an order is refund-pending, delivered or can no longer be paid.

## Shipping quotes

- Rates come only from (a) the seller's own shipping terms on the listing (flat / by province) or (b) a configured provider (`SHIPPING_PROVIDER`: `none` | `mock`; `mock` is refused in production and its rate is labelled a test rate). **No carrier rate or delivery estimate is invented**: if neither source can quote, the quote says unavailable.
- `estimatedDays` is present only when the seller/provider supplied it and is shown as an _estimate_.
- A quote expires, is single-use, and carries a `termsHash`; using a stale, used, expired or province-mismatched quote → `409 QUOTE_STALE`. Buyers recalculate with `POST /orders/:id/requote` (while PENDING_PAYMENT, guarded by `totalVersion`).
- Animal-specific `requirements` (health certificate, livestock vehicle, movement permit) are shown at checkout and must be acknowledged.

## Data protection

- Delivery addresses are encrypted at rest with AES-256-GCM using a key derived (HKDF) from the server secret; plaintext is returned only to the buyer, and to the seller once the order is PAID or later. Lists never include the address; audit logs never contain it.
- Item/price details are frozen in `order.items` at checkout; later listing edits do not change the order.
- Order APIs return 404 (not 403) for orders you are not a party to.

## Webhooks

`POST /webhooks/shipping` (and `/webhooks/payments`, now handled by the finance module): raw body, HMAC `webhook-signature: time=<unix>,sig1=<hex>` over `${time}.${body}` (±300s), secrets `PAYMENT_WEBHOOK_SECRET` / `SHIPPING_WEBHOOK_SECRET`. 404 when the secret is unset, 401 + audit on a bad signature. Payment callbacks are matched to a payment we started (by provider reference), must equal the frozen order total and currency exactly, and money that cannot be applied is parked and queued for refund — see [finance.md](finance.md).

## Limitations

- No product cart, no real carrier integration (mock only), no admin orders UI, no partial refunds, no dispute workflow.
- Mobile has buyer screens only (orders list/detail, checkout); sellers ship from the web.
- Backstop: the unique `negotiationId` index makes the duplicate-order check redundant with the explicit guard.
