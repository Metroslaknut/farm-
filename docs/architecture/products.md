# Products marketplace (Part 14)

Farms sell feed, supplements, equipment — and, once a compliance review is recorded, regulated goods such as medicines.
It adds **products**, **inventory** and **carts**; **orders, payments, shipping, fees and the ledger are the Part 12/13
modules, reused unchanged** (an order simply has `kind: 'product'`). Code: `services/api/src/modules/products/`; web: `/shop`.

## Read this first: compliance

- **Medicines and other regulated goods are OFF.** Categories `medicines` and `medicated_feed` are seeded as `regulated` with
  `salesEnabled = false`. Nothing in a closed category can be created, shown, put in a cart or bought. A person with
  `settings.manage` can open one only by giving the **reference of the compliance review** that approved it, a reason, and typing
  `ENABLE <key>`. The review reference, who and when are stored and audited. Tightening a category's classification switches its
  sales off again. A `prohibited` category can never be opened. **Whether and how medicines may be sold is a legal/regulatory
  question this software does not answer: get that review done before opening any regulated category.**
- **Regulated products need a registration/licence number** (422 `REGISTRATION_REQUIRED`). The platform does not verify it; the
  moderator checks it, and the number is shown to buyers and frozen on orders.
- **Block-list** — setting `products.prohibitedTerms`: terms that may appear nowhere in a product's title, description, brand,
  specifications or registration notes (422 `PROHIBITED_PRODUCT`). **Treatment claims** — setting `products.claimTerms`: phrases such as
  "cures", "heals", "prevents disease", "guaranteed results" (Thai included) are refused for ordinary goods (422
  `UNSUPPORTED_CLAIM`), so the platform does not publish unsupported veterinary claims. Matching is whole-word for Latin text and
  substring for Thai; case and spacing are ignored. **Both lists are STARTER lists with no legal review** — the platform owner
  must replace them. For regulated products the claims check is skipped (label claims belong to the registration); the moderator reviews them.
- The checks run on create, edit, submit, approval and restore. `POST /shop/moderation/rescan` re-checks every live/pending product
  against the _current_ lists and category switches and suspends offenders (so changing a list takes effect on products already on sale).
- Every product is **moderated** (permission `listings.moderate`) before it goes on sale; nobody can moderate their own farm's product.

## Data

| Collection            | Purpose                                                                                                                                                                                                                                                                    |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `product_categories`  | key, name, one-level parent, `regulation` (none/regulated/prohibited), `salesEnabled`, compliance reference/time/person                                                                                                                                                    |
| `products`            | farm-owned goods: text, brand, SKU (unique per farm), unit, list price, optional promotion window, specs, photos, delivery options and the seller's own delivery rates, min/max per order, `stock`/`reserved`, status, review/moderation fields, rating aggregate, history |
| `inventory_movements` | append-only stock ledger (`initial`, `adjustment`, `reserve`, `release`, `sale`, `restock`); unique per `(orderId, productId, type)`                                                                                                                                       |
| `carts`               | one per user; product ids and quantities only                                                                                                                                                                                                                              |
| `product_reviews`     | one per `(product, buyer)`; verified purchases only                                                                                                                                                                                                                        |

Money is integer satang. A product belongs to a **farm**; sellers are the farm's owners/managers (farm permission `listings.manage`),
the same people who sell animals. Orders credit the **farm owner's** earnings.

## Product status (explicit transitions)

`DRAFT → PENDING_REVIEW` (seller) · `PENDING_REVIEW → ACTIVE | REJECTED` (moderator) or `→ DRAFT` (seller edits) ·
`ACTIVE → PAUSED` (seller) `| SUSPENDED` (moderator/system) `| ARCHIVED` · `PAUSED → ACTIVE | SUSPENDED | PENDING_REVIEW | ARCHIVED` ·
`REJECTED → DRAFT | ARCHIVED` · `SUSPENDED → ACTIVE` (moderator only) `| ARCHIVED`. Archived is final.
Editing **what a product is** (category, title, text, brand, specs, photos, registration) sends a live or paused product back to
`PENDING_REVIEW` (hidden until re-approved); **price, promotion, stock, delivery rates and order limits** can be changed live.

## Ownership

Every seller route is `/farms/:farmId/products…` and every lookup includes the farm id: another farm's product is a 404, whatever its
id. Platform staff cannot sell on a farm's behalf. Workers/viewers are refused (403); users without the seller role cannot create products
(`SELLER_REQUIRED`, setting `marketplace.requireSellerRole`).

## Inventory: stock cannot go negative

`stock` (on hand) and `reserved` (promised to unpaid orders) are projections of `inventory_movements`. **Reserving is one atomic
conditional update** — `reserved += qty` only where `stock − reserved ≥ qty` and the product is ACTIVE — so any number of concurrent orders can
never take more than exists (tested: 25 buyers racing for 7 units get exactly 7; 8 buyers × 3 units against 10 get 3).

1. **Checkout** reserves each line (`reserve` movement). Anything that fails afterwards gives the units back.
2. **Payment** (the existing Part 13 flow → `markOrderPaid`) turns the reservation into a **sale**: stock and reserved both drop.
3. **Cancelled / expired unpaid order** → reservation **released**. **Refund** (cancel after payment, returned shipment) → sold units **restocked**
   (a seller can count out damaged goods with an adjustment).
   Each step is recorded once per order and product (unique index), so redelivered webhooks or the cleanup job racing a request cannot
   double count. `runInventoryCleanup` (part of the existing cleanup job) finishes what a crash leaves half-done — reservations whose order was never
   created, paid orders whose stock was not deducted, closed orders still holding stock — and `reconcileInventory` compares every product to its movement log (repairable).
   Sellers adjust stock with a reason (`delta` or `set`); never below what is reserved or below zero.

## Price, promotion, snapshots

`effectivePrice` (pure, in shared-utils): the promotion price while `startsAt ≤ now < endsAt` and it is lower than the list price. Browse filters/sorts use
the price the buyer pays _now_. **Checkout freezes** title, photo, SKU, brand, unit, category name, specifications, registration number, list price, price source
(regular/promotion), quantity and unit price on the order — later edits, promotions, renames or archiving never change it (tested). The buyer also sends what they _saw_
(items and shipping per seller); if a price, shipping rate or the cart changed, checkout stops (`409 PRICE_CHANGED | SHIPPING_CHANGED | CART_CHANGED`) before anything is reserved.

## Cart and checkout

The cart stores ids and quantities; prices, availability and problems (`unavailable`, `out_of_stock`, `insufficient_stock`, min/max, `own_product`…) are computed live on every read.
`POST /shop/cart/checkout` creates **one ordinary order per seller farm** — same statuses, payment (`POST /payments`), cancellation/refund, shipping tracking and ledger rules as animal orders —
**all or nothing**: if a later seller's stock is gone, earlier orders are cancelled and their stock released. Buyers pay each order separately. Fees come from the commission rules **per line** (by product
category key; the animal-type keys of Part 13 and product category keys share the namespace), summed, and kept as `feeSnapshot.lines`.
**Shipping** is the seller's own per-product rate (flat or by province), charged once per product line and summed per seller; a delivery time appears only if the seller gave one, and is labelled an estimate. FARM+
never invents a carrier rate. Shop orders cannot be re-quoted (cancel and check out again).

## Reviews

Only a buyer whose order containing the product was **DELIVERED** can review it, once (1–5 stars, text); sellers cannot review their own products. Moderators (`content.moderate`) can hide/restore a review; the product's
average is kept in step. A buyer can delete their own review (and write another).

## Search

`GET /shop/products` — ACTIVE products in open categories only; text (title/brand/SKU, regex-escaped), category (incl. one level of children), price range, in stock, on sale, farm; sort by newest, price, rating, most sold; page/pageSize ≤ 48.
Substring matching, not a search engine: replace with a real index for large catalogues.

## Limits / not done

- No variants (size/flavour) — one SKU per product. No bulk import, no tiered pricing, no coupons, no tax/VAT.
- One shipping rate per product line, seller-stated; no carrier rate integration for products, no weight-based shipping.
- One order per seller; no combined payment for several sellers.
- Stock is restocked automatically on refund (the seller adjusts for damage).
- Mobile app: no shop screens yet (order detail displays product items; payment works as for animals).
- The compliance lists are a mechanism plus a starter list, not legal advice.
