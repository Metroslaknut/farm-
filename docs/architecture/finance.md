# Finance & payments (Part 13)

Payments, platform fees, the financial ledger, refunds, seller earnings and withdrawals. All money is **integer satang**
(THB only). Code lives in `services/api/src/modules/finance/`.

## Read this first: what this is and is not

- **No real payment provider is integrated.** `PaymentProvider` (`provider.ts`) is the seam: create/get/cancel a charge,
  refund, payout, list charges for reconciliation — every money-moving call carries an idempotency key. `PAYMENT_PROVIDER`
  is `none` (online payment disabled, API answers `503 PAYMENTS_UNAVAILABLE`) or `mock` (development/test stand-in that moves
  no money; refused in production by the env schema). Writing an adapter for a real provider — and finishing that provider's
  onboarding/KYC and the legal review below — is the remaining step before taking real money. The webhook contract below is ours; an
  adapter maps the provider's event format onto it.
- **Seller "wallets" are an earnings balance, not stored-value wallets.** There are no top-ups, no spending, no transfers
  between users: credits come only from completed sales, debits only from withdrawals or refunds.
- **Withdrawals are gated by `finance.payoutsEnabled` (default `false`).** Holding buyer money until delivery and paying sellers out
  is escrow-like. It must not be switched on until the legal and provider requirements (licensing, who is merchant of record, how
  funds are held) have been reviewed. Until then earnings accumulate in the ledger and the API refuses withdrawals (`409 PAYOUTS_DISABLED`).
- A **user-uploaded payment slip is never proof of payment.** There is no slip-upload feature; an order becomes `PAID` only through a
  provider callback whose HMAC signature verified, for a payment we started, for the exact amount.
- Not done: partial refunds, disputes/chargebacks, tax (VAT) handling, multi-currency, carrier/shipping-fee settlement, payout
  fees, scheduled reconciliation, a real provider.

## Money model

```
buyer pays  grandTotal = items + shipping            (shipping is never part of the fee base)
fee         = commission(items)                      (deducted from the seller, never added to the buyer)
seller gets items − fee, PENDING until the order is delivered, then AVAILABLE
shipping    held in a `shipping` account (carrier settlement is out of scope)
```

### Ledger (`wallet_transactions`) and wallets (`wallets`)

Every movement is a **balanced journal**: lines sum to exactly 0 (credit `+`, debit `−`), keyed by an idempotency key such as
`capture:<paymentId>`. Lines are unique on `(journalKey, lineNo)`, so a journal can never be posted twice; there is no update
or delete path. `wallets` holds a _projection_ (`pendingMinor`, `availableMinor`) incremented only by the ledger service, in step with a line;
`reconcile` recomputes it from the ledger and repairs drift. The frontend has no endpoint that writes a balance.

| Wallet kind             | Meaning                                                                   |
| ----------------------- | ------------------------------------------------------------------------- |
| `seller` (one per user) | the seller's earnings: `pending` until delivery, then `available`         |
| `platform`              | commission revenue                                                        |
| `shipping`              | shipping charges collected, owed to the carrier/seller                    |
| `provider`              | funds the payment provider holds for us (negative = provider holds money) |
| `suspense`              | money received that could not be applied to an order, awaiting refund     |
| `payout`                | withdrawals in flight                                                     |

| Journal                                        | Key                             | Lines                                                                           |
| ---------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------- |
| capture (payment applied)                      | `capture:<paymentId>`           | provider −total; seller +(items−fee) pending; platform +fee; shipping +shipping |
| capture unapplied                              | `capture_unapplied:<paymentId>` | provider −amount; suspense +amount                                              |
| release (order delivered)                      | `release:<orderId>`             | seller pending −x, available +x                                                 |
| refund                                         | `refund:<refundId>`             | exact reversal of the capture (or of the suspense entry)                        |
| withdrawal hold                                | `wd_hold:<id>`                  | seller available −x; payout +x                                                  |
| withdrawal release (rejected/cancelled/failed) | `wd_release:<id>`               | reverse of the hold                                                             |
| withdrawal paid                                | `wd_paid:<id>`                  | payout −x; provider +x                                                          |

Withdrawal holds use a **guarded atomic decrement** (`availableMinor ≥ amount` is part of the update filter), so two simultaneous
requests cannot spend the same money.

## State machines (enforced server-side; clients never choose a status)

- **Payment** (`payments`): `pending → succeeded | failed | cancelled | expired`; `cancelled | expired → succeeded` (the provider is the truth: a
  charge we gave up on can still be captured); `succeeded → refunded`. A succeeded payment has a _disposition_: `applied` (order paid) or
  `unapplied` (parked in suspense + refund queued — order cancelled/changed, wrong amount, second capture). Unique indexes: one open
  attempt per order, one `applied` payment per order, `(orderId, idempotencyKey)`.
- **Refund** (`refunds`, always the full payment; one per payment): `requested → approved → processing → succeeded | failed`, `failed → processing`
  (retry = new attempt, new provider refund).
- **Withdrawal** (`withdrawals`): `requested → approved | rejected | cancelled`; `approved → processing → paid | failed`. Money is held from `requested`.

## Payment flow

1. Buyer `POST /payments {orderId}` with an **`Idempotency-Key`** header (required). The amount is the frozen order total; the client
   cannot choose it. The same key returns the same payment (even after the order is paid); a different key while an attempt is open is
   `409 PAYMENT_IN_PROGRESS`. If the provider call fails the attempt stays open and the retry (same key) resumes it — the provider call itself is
   idempotent (`pay:<paymentId>`), so a lost response cannot create two charges.
2. The buyer pays on the provider's hosted page (the platform never sees card data). The web/mobile apps only follow an `https` checkout URL supplied by the server.
3. The provider calls `POST /webhooks/payments` (raw body, `webhook-signature: time=<unix>,sig1=<hex>`, HMAC-SHA256 over `${time}.${body}`,
   ±300 s, secret `PAYMENT_WEBHOOK_SECRET`; `404` while no secret is set, `401` + audit on a bad signature). Body: `{id, type, data:{ref, amountMinor, currency, failureCode?}}`,
   `type ∈ charge.succeeded|failed, refund.succeeded|failed, payout.paid|failed`. Events are matched by **provider reference** to a record we created; unknown references are recorded and ignored.
4. `charge.succeeded` → payment `succeeded` (compare-and-set) → `finalizePayment`: apply to the order (`markOrderPaid`, guarded by the order's unique `paymentRef` and `totalVersion`),
   post the capture journal, mark `applied`. Anything that cannot be applied is parked (`unapplied`) and a refund request is queued. Every step is idempotent, so redelivered or parallel
   callbacks create **no second payment, journal, ledger line or balance change**, and a crash between steps is finished by the next callback or by `reconcile`.
5. A foreign-currency event is recorded (`payment.currency_mismatch`) and changes nothing.
6. Abandoned attempts expire (`finance.paymentAttemptMinutes`, default 30; swept by the existing cleanup job). The order's payment window does not cancel an order that has a live attempt.

## Commission rules (`commission_rules`, permission `commissions.manage`)

Fields: fee percentage (stored as basis points, max 5000), optional **minimum/maximum fee**, optional **price range** (inclusive), **categories** (animal type keys and, for shop orders, product category keys; empty = all),
**effective start/end** (end exclusive), **priority**, active flag, version. Changes require a reason; rules are deactivated, never deleted.

- **Calculation** (`calculateCommission`, pure, integer-only): `raw = floor(price × bps / 10000)`; then the minimum, then the maximum, and never more than the price itself. Same inputs → same fee on every run
  (property-tested with 2 000 random cases).
- **Selection / conflict resolution**: among active rules whose window, price range and category match, the **highest priority wins**. Saving a rule that has the **same priority as another active rule whose
  scope could match the same sale** is refused (`409 RULE_CONFLICT`), so ties cannot normally exist (a stored tie resolves by id). No matching rule → the platform default `orders.platformFeeBps` (0 = no fee).
- **Immutable snapshot**: at checkout the order stores `feeSnapshot` — source, rule id/name/**version**, category, evaluation time, base, bps, raw fee, bounds, final fee, which bound applied. Later rule
  edits or deactivation never change an existing order.

## Refunds

A refund is queued (`requested`) when an order becomes `REFUND_PENDING` (cancelled after payment, failed delivery cancelled by the seller, shipment returned) or when a payment could not be applied.
**A finance administrator must approve it** (`payments.refund`): they type the refund number to confirm, nobody can approve a refund on an order they are a party to
(`403 SELF_APPROVAL`), and approval is a compare-and-set so parallel approvals refund once. Approval submits one idempotent refund (`refund:<id>:<attempt>`) to the provider. Nothing changes in the books until the
provider confirms: then the refund → `succeeded`, payment → `refunded`, the reversal journal is posted and the order becomes `REFUNDED`. A provider outage leaves the refund retryable; a failed refund is retried as a new attempt.
There is no automatic refund and no "reject" path (an order in `REFUND_PENDING` has no way back).

## Withdrawals

Seller adds a **payout account** (encrypted AES-256-GCM, only the last 4 digits returned or audited) and requests a withdrawal with an `Idempotency-Key`. Requires `finance.payoutsEnabled`, an amount ≥ `finance.minWithdrawalMinor`
and enough **available** balance (pending earnings cannot be withdrawn). The amount is held immediately; the seller can cancel while `requested`. A finance administrator (`withdrawals.approve`) approves (typed withdrawal number; not their own
withdrawal) or rejects (reason) — rejection and failed payouts return the money exactly once. Approval sends one idempotent payout (`payout:<id>`) using the account **captured at request time** (later edits to the payout account cannot redirect it).

## Reconciliation (`POST /admin/finance/reconcile`, `payments.verify`)

A dry run reports; `repair` (typed confirmation `REPAIR`) only applies facts that are already certain, by running the same idempotent code the webhooks use. It checks: every journal balances and the whole ledger sums to 0; every wallet balance equals its ledger
lines (repair: compare-and-set recompute); no seller balance is negative; each payment/order/refund/withdrawal state has its journals (repair: post the missing one); our payments, refunds and payouts versus the provider's records (a callback that never came is applied from the provider's record; **amount disagreements and unknown provider charges are
reported, never auto-fixed**); abandoned attempts; and the audit chain. Run it on a schedule once a real provider exists (not scheduled yet). Repair recomputes balances without locking: run it when traffic is low.

## Financial audit log (`financial_audit_logs`, `payments.read`)

Append-only and **hash-chained** (`hash = sha256(seq|time|actor|action|target|amount|data|prevHash)`): editing, deleting or re-linking a row is detected by `GET /admin/finance/audit-logs/verify` (and by reconcile). Records payment/refund/withdrawal events, every ledger journal, rule changes
(with before/after and reason), reconciliation runs and repairs, unknown/mismatched provider events. It never contains account numbers, addresses, e-mails or secrets (tested). Writers in one process queue; writers in other processes collide on the unique `seq` and retry. This detects tampering after the fact; it does not prevent a database administrator from rewriting the whole chain.

## Permissions

| Action                                                 | Permission / rule                                                                 |
| ------------------------------------------------------ | --------------------------------------------------------------------------------- |
| start a payment                                        | the order's buyer only (others get 404)                                           |
| own earnings, payout account, withdrawals              | the signed-in user, own wallet only (no id in the URL)                            |
| list payments, refunds, withdrawals, ledger, audit log | `payments.read`                                                                   |
| approve / retry a refund                               | `payments.refund` + typed refund number + not a party                             |
| approve / reject / retry a withdrawal                  | `withdrawals.approve` + typed number (approve) / reason (reject) + not the seller |
| commission rules                                       | `commissions.manage` + reason                                                     |
| reconcile, verify audit chain                          | `payments.verify` (+ typed `REPAIR` for repairs)                                  |

All admin permissions apply only in an MFA-verified session. Money-moving routes are rate-limited.

## Configuration

`PAYMENT_PROVIDER` (`none`|`mock`), `PAYMENT_WEBHOOK_SECRET` (≥ 16 chars; callbacks off without it), settings `finance.payoutsEnabled`, `finance.minWithdrawalMinor`, `finance.paymentAttemptMinutes`, `orders.platformFeeBps` (default fee). The master key for encrypting payout accounts is derived (HKDF) from `MFA_ENCRYPTION_KEY`.

## Testing

`services/api/test/finance.test.ts` (67 tests): fee maths and rule selection (incl. randomised), rule API (permissions, validation, conflicts, snapshot immutability), payment start (idempotency, parallel, outage, expiry), callbacks (duplicates, parallel, failure, late capture, suppressed/parked money, mismatch, unknown refs),
ledger balance and projection, refunds (approval rules, retry, mismatch, suspense), withdrawals (gate, validation, holds, concurrency, approval rules, destination snapshot, failure/reject), reconciliation (drift, crash repair, provider comparison, unrepairable disagreements), audit chain tamper detection and PII checks.
Mutation checks of the controls (journal balance, replay double-count, amount check, confirmation, self-approval, balance guard, replay lookups, fee cap, rule priority, release, callback amount, failed-payout release, permission, audit hash, refund queueing) were killed by the tests; one (re-checking `totalVersion` when applying a payment) survives only because two other layers
(amount equality and the order-update guard) enforce the same rule.
