# Animal marketplace (Part 11)

API: `services/api/src/modules/marketplace/` · Collections: `listings`, `negotiations`, `listing_events` (+ `listing_favorites`).
Web: `apps/web/src/pages/market/` (`/market`), admin review queue `apps/web/src/pages/admin/listings/` (`/admin/listings`).
Mobile (buyer side): `app/(tabs)/market.tsx`, `app/marketplace/**`. Selling (create/manage listings, answer offers) is **web only**.

## Money

All amounts are **integer satang** (฿1 = 100 satang) end to end: schemas reject floats, zero, negatives, strings and absurd values; the UI converts typed baht with
digit-based parsing (no `19.99 * 100` float trap). Only `THB` is supported; the currency is validated on every offer.

## Who may do what

| Action                                                                             | Required                                                                                                                                                                              |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Create / edit / submit / pause / cancel / sell a listing, answer offers for a farm | farm role **owner or manager** (`listings.manage`) **and** the **`seller` role** (setting `marketplace.requireSellerRole`, default on). Platform staff never sell on a farm's behalf. |
| Browse, search, favourite, make offers                                             | any signed-in user (not the farm's own owners/managers)                                                                                                                               |
| Review / reject / suspend / restore listings, read negotiations                    | platform permission `listings.moderate` (MFA-protected like every staff permission); a moderator cannot moderate a farm they belong to                                                |
| See a negotiation                                                                  | its buyer, the farm's owners/managers, and — read-only — moderators. Anyone else: `404`                                                                                               |

Every seller-side lookup includes the farm id (IDOR-safe). A listing that is not public (draft, pending, rejected, paused, …) is `404` for everyone except its seller side and moderators.

## Listing status machine

`DRAFT → PENDING_REVIEW → ACTIVE ⇄ PAUSED`, `ACTIVE → RESERVED → SOLD`, `PENDING_REVIEW/ACTIVE/PAUSED → REJECTED → (revise) DRAFT`, `ACTIVE → EXPIRED → (renew) ACTIVE`, and `CANCELLED`.
Each transition is one atomic compare-and-set on the listing document (`findOneAndUpdate({_id, status ∈ from})`); only the request that wins writes the event. Invalid transitions are `409 INVALID_STATE`.

- Editing is allowed in `DRAFT`, `REJECTED` (editing returns it to `DRAFT`) and `PAUSED`; an active listing must be paused first. A listing a **moderator** paused cannot be edited or resumed by the seller.
- Submitting needs ≥ 1 photo and an animal that is still sellable. With `marketplace.requireReview` on (default) a moderator approves; off → straight to `ACTIVE`.
- **One open listing per animal** (`DRAFT/PENDING_REVIEW/ACTIVE/RESERVED/PAUSED`): enforced by a unique partial index, so even parallel requests cannot create two (`409 ALREADY_LISTED`).
- Only `active`/`for_sale` animals that are not archived can be listed. Marking a listing sold sets the animal's status to `sold`, which can never be listed (or bought) again.
- **The animal's status follows its listing (server-side, in `transition()`):** when a listing goes on sale (`ACTIVE`/`PAUSED`/`RESERVED`) an
  `active` animal becomes `for_sale` and the listing remembers `animalStatusBefore`; when it closes unsold (`CANCELLED`/`REJECTED`/`EXPIRED`) the animal
  goes back to that status. Both steps are compare-and-set on the animal (`active` → `for_sale`, and back only while still `for_sale`), so a manual
  change made meanwhile (e.g. `deceased`) or a sale is never overwritten. Drafts and listings pending review do not change the animal. Each change is
  audited as `animal.updated` with `metadata.via = 'listing'`. Existing listings created before this rule have no `animalStatusBefore` and are left as they are.
- The listing copies type, breed, sex, age and the farm's province/district at creation; health, breeding and other records stay private.

## Negotiation

One negotiation per (listing, buyer). Its `history[]` is **append-only**: each offer, counter, accept, reject, withdraw, expiry, cancellation and completion is an item with `seq`, actor, party, amount, currency, message and timestamp.
Steps are single atomic updates guarded by `history: {$size: n}` plus the expected state, so concurrent steps conflict instead of interleaving. `listing_events` mirrors every step (and every status change) for the listing's audit trail; `audit_logs` records the actions (never message text).

Server-side rules (never trusted from the client):

- Amount: positive integer satang, currency = listing currency, `≤ asking price`, `≥` the seller's private floor (`minOfferMinor`). A fixed-price listing only accepts the asking price and has no counters.
- Counters move toward each other: a seller never counters below the buyer's offer, a buyer never above the seller's; equal = "accept instead". Only the party whose **turn** it is can counter/accept. Max 20 rounds.
- **Accept/reject quote `expectedSeq`**, the offer the user saw: if a counter arrived meanwhile the answer is `409 STALE_OFFER`, so nobody accepts a price they did not see.
- Offers expire (`marketplace.offerHours`, default 48 h). An expired offer cannot be countered or accepted (`409 OFFER_EXPIRED`); it is marked expired lazily on read and by the cleanup job; the buyer can then reopen the same negotiation with a new offer.
- Seller-side users act as themselves: the actor stored in history is the manager/owner who clicked.

### Accepting = reserving = starting the order

Accepting first reserves the animal by an atomic `ACTIVE → RESERVED` compare-and-set **on the listing** (with `reservation {negotiationId, buyerId, amount, expiresAt}`), then closes the negotiation as `accepted`. Of any number of simultaneous
acceptances for the same animal exactly one wins; the rest get `409 LISTING_UNAVAILABLE`. If the second step loses a race (withdraw/counter/expiry) the reservation is rolled back; a crash between the two steps is repaired by cleanup
(a `RESERVED` listing whose negotiation is not `accepted`). MongoDB transactions are not assumed. Other open negotiations on the listing are cancelled.
The deal then exposes `order: {status: 'awaiting_payment', amountMinor, reservedUntil}` and a listing event `order.initiated` — this is the hand-off to the order step (Part 12), whose payment is handled by the finance module (Part 13). Reservation lasts `marketplace.reservationHours` (48 h);
either party can cancel it (listing back to `ACTIVE`); the seller completes the sale (`SOLD`, animal `sold`, negotiation `completed`).

## Search

`GET /marketplace/listings?q&animalTypeId&breed&province&district&sex&minPriceMinor&maxPriceMinor&sort=newest|price_asc|price_desc&cursor&limit` — only `ACTIVE`, non-expired listings; filters are literal (regex-escaped); cursor pagination is stable for every sort.
Text search is a case-insensitive substring match on title/description/breed/type (fine at this scale; use a text index or search service before the catalogue is large).

## Cleanup

`runMarketplaceCleanup` (every 10 min in the API, `POST /marketplace/moderation/cleanup`, idempotent): expires offers, expires listings past `marketplace.listingDays` (30), releases unfinished reservations.

## Settings (Admin → Settings)

`marketplace.requireSellerRole`, `marketplace.requireReview`, `marketplace.offerHours`, `marketplace.reservationHours`, `marketplace.listingDays`.

## Known limitations

- **No order, payment or escrow yet**: accepting a deal reserves the animal and records `order.initiated`; collecting money and transferring ownership are later parts. Completing the sale is the seller's confirmation.
- Photos are links (allow-listed hosts, https), not uploads. No notifications for new offers/counters (the inbox and "Your turn" badges are the signal). No ratings/reviews, no reporting of listings (use the community report flow later), no multi-animal lots.
- Selling tools are web-only; mobile covers browsing, saving, offers and answering them as a buyer (the negotiation screen also works for sellers).
- Existing databases: new settings default sensibly; `farm_members` roles gain `listings.manage` through code (no migration). Sellers need the `seller` role (granted by approving a seller registration) and the existing `moderator`/`admin` roles already hold `listings.moderate`.
