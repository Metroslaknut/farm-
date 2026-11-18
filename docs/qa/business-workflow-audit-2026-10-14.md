# FARM+ — End-to-end business workflow audit (second pass)

**Date:** 14 Oct 2026 · **Environment:** macOS arm64, Node 26.5, in-memory MongoDB (`mongodb-memory-server`), mock payment / shipping / video / AI providers, local Chrome. Synthetic users and data only; no production database, Atlas cluster, real provider, real money or customer data.

> Not a statement that FARM+ is production-ready. AI-assisted work: review the fixes before relying on them.

## Method

The 13 Oct [business-workflow-audit.md](business-workflow-audit.md) marked most scenarios PASS by pointing at existing suites; the same day's code audit still found defects in workflows marked PASS. This pass wrote **new scenario tests** that drive each workflow through the real HTTP API and then **query MongoDB directly** to check the stored state (plus ledger invariants for money flows), and **five new browser journeys** for UI paths no test had driven. Every failing scenario was checked against the code and the spec before being classed as a defect; each defect was then fixed and its scenario re-run.

| Suite (new)                                    | File                                                        | Cases |
| ---------------------------------------------- | ----------------------------------------------------------- | ----- |
| A Users & roles · I Reporting                  | `services/api/test/workflows/audit-a-i.test.ts`             | 38    |
| B Farms & animals · G AI                       | `services/api/test/workflows/audit-b-g.test.ts`             | 45    |
| C Community & media                            | `services/api/test/workflows/audit-c.test.ts`               | 35    |
| D Marketplace · E Orders & shipping            | `services/api/test/workflows/audit-d-e.test.ts`             | 40    |
| F Payments & wallet · H Products & inventory   | `services/api/test/workflows/audit-f-h.test.ts`             | 40    |
| UI → API → DB journeys                         | `e2e/tests/audit-ui-journeys.spec.ts`                       | 5     |
| Commission rule edit (found while fixing D3-b) | `services/api/test/regressions/finance.test.ts` (AUDIT2-F5) | 1     |

**First run: 176 PASS, 28 FAIL (plus 1 UI defect found by an intermittent browser failure, below). After fixes: all scenarios PASS.** Statuses below: **PASS** = passed on first run; **FIXED** = failed on first run (real defect), fixed, passes on re-run.

## Defects found and fixed (29)

| Scenario        | Sev    | Expected → actual (first run)                                                                                                                                                                                                                          | Root cause                                                                                 | Fix (file)                                                                                                                                                                            |
| --------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D3-b            | High   | PATCH of only a listing's title must keep its photos → photos emptied, delivery reset to pickup                                                                                                                                                        | Zod 4 applies `.default()` inside `.optional()`: the update schema reused defaulted fields | defaults moved to the create schema (`validation/marketplace.ts`)                                                                                                                     |
| F5 (own)        | High   | Changing the fee of a category-scoped commission rule must keep its categories → rule silently became all-category                                                                                                                                     | same Zod default pattern in the commission update schema                                   | `validation/finance.ts`                                                                                                                                                               |
| H3b             | High   | Same cart checked out twice in parallel → **2 orders, stock reserved twice** (buyer could pay twice)                                                                                                                                                   | checkout read and ordered the cart with no claim                                           | atomic, expiring per-cart checkout lock; 2nd gets 409 `CHECKOUT_IN_PROGRESS` or finds the cart emptied (`cart.service.ts`, `cart.model.ts`)                                           |
| D8-b            | High   | A marketplace-sold animal edited back to "active" could be listed and sold again                                                                                                                                                                       | listing only checked the editable animal status                                            | refuse listing when a SOLD listing exists (`listings.service.ts`)                                                                                                                     |
| B1-3            | High   | Archived farm's live listing still accepted offers (201) and stayed searchable; seller could not pause it                                                                                                                                              | marketplace never checked the farm's archived status                                       | offers/counters/accepts refused (409 `FARM_ARCHIVED`), hidden from search/detail; no listing data changed (`marketplace/common.ts`, `negotiations.service.ts`, `listings.service.ts`) |
| G3-2            | High   | AI narrative stating a price in Thai or full-width digits (๙๘๗,๖๕๔ บาท) was accepted                                                                                                                                                                   | number check matched ASCII digits only                                                     | Unicode digits normalised before checks (`ai/narrative.ts`)                                                                                                                           |
| A3-4            | Medium | Reset link issued before a password change still reset the password afterwards                                                                                                                                                                         | change-password did not invalidate reset tokens                                            | delete outstanding reset tokens on change (`auth.service.ts`)                                                                                                                         |
| D8-c            | Medium | Animal recorded deceased after listing could still be reserved by accepting an offer                                                                                                                                                                   | sellability checked only at create/submit                                                  | re-checked on accept and renew (`assertAnimalSellable`)                                                                                                                               |
| D2-b            | Medium | Renewing an expired listing while another is open → 500                                                                                                                                                                                                | duplicate-key error not mapped                                                             | 409 `ALREADY_LISTED`                                                                                                                                                                  |
| F4d             | Medium | A zero-amount capture callback → 500, and every later reconcile repair → 500                                                                                                                                                                           | ledger refuses a zero journal                                                              | nothing is parked/refunded for 0; mismatch still recorded (`payments.service.ts`)                                                                                                     |
| B8-2            | Medium | 3 parallel voids of one record all succeeded (3 history entries)                                                                                                                                                                                       | read-modify-save without concurrency check                                                 | compare-and-set on `revision`; losers 409 `RECORD_CHANGED` (`record-core.ts`)                                                                                                         |
| B8-3            | Medium | 3 parallel corrections all returned 200 but only one survived (lost updates)                                                                                                                                                                           | same                                                                                       | same                                                                                                                                                                                  |
| G3-3            | Medium | "nine hundred thousand baht" (spelled-out price) passed the narrative check                                                                                                                                                                            | only digits checked                                                                        | number words next to a currency word rejected                                                                                                                                         |
| G3-4            | Medium | "The animal is healthy" passed (AI must not make health claims)                                                                                                                                                                                        | starter blocked-term list lacked health-status terms                                       | EN/TH health terms added to `ai.blockedNarrativeTerms` default (`settings.service.ts`)                                                                                                |
| G7-3            | Medium | Anthropic adapter: response body stalling after headers hung past the timeout                                                                                                                                                                          | timer cleared before the body was read                                                     | deadline covers the body (`ai/provider.ts`)                                                                                                                                           |
| C1-04           | Medium | Comment on a **deleted** post could still be edited                                                                                                                                                                                                    | container not checked on edit                                                              | edit requires the post/video to be visible and open (`comments.service.ts`)                                                                                                           |
| E1-c            | Low    | Buyer who later joined the selling farm as manager could still check out (pickup)                                                                                                                                                                      | pickup has no quote step, which held the check                                             | self-dealing check in `createOrder`                                                                                                                                                   |
| B1-4            | Low    | Archiving an archived farm overwrote `archivedAt`                                                                                                                                                                                                      | no no-change guard                                                                         | 409 `NO_CHANGE`                                                                                                                                                                       |
| B2-4            | Low    | 8 parallel "add member" with one e-mail → some 500s                                                                                                                                                                                                    | duplicate key unmapped                                                                     | 409 `ALREADY_MEMBER`                                                                                                                                                                  |
| B9-3            | Low    | Another farm's animal id under `/farms/A/animals/:id/assessments` → 200 (empty)                                                                                                                                                                        | animal not scoped to farm                                                                  | 404                                                                                                                                                                                   |
| C2-05           | Low    | Post author could like a comment under their own **hidden** post                                                                                                                                                                                       | comment reactions ignored container state                                                  | container must be open                                                                                                                                                                |
| C7-05           | Low    | Two moderators resolving one report at once: one 409 but both wrote moderation history/audit                                                                                                                                                           | content acted on before the report was claimed                                             | report claimed atomically first; released if the action fails                                                                                                                         |
| F6c / F8b / F8c | Low    | Parallel identical refund/payout callbacks booked once but wrote 2–4 financial audit entries                                                                                                                                                           | audit written whether or not this call won the state change                                | audit only by the winning compare-and-set (`refunds.service.ts`, `withdrawals.service.ts`)                                                                                            |
| I2-2            | Low    | Dashboard with animal-type filter: sales stayed farm-wide, costs filtered, net-over-cost mixed both silently                                                                                                                                           | no disclosure                                                                              | note added; net-over-cost `null` when scopes differ (`analytics/farm.service.ts`)                                                                                                     |
| I2-3            | Low    | Orders CSV accepted `animalType` and exported every order anyway                                                                                                                                                                                       | filter ignored                                                                             | 400 for that combination (`analytics/exports.ts`)                                                                                                                                     |
| I5-2            | Low    | Staff without MFA on admin analytics got `FORBIDDEN` instead of `MFA_REQUIRED`                                                                                                                                                                         | route-level check didn't consider withheld permissions                                     | same answer as `requirePermission` (`analytics.routes.ts`)                                                                                                                            |
| UI-I05 / UI1    | Low    | Farm dashboard: a date typed before the animal-type list finished loading was silently wiped, so Apply used a different range than typed (seen as an intermittent browser failure; reproduced deterministically in `analytics-ui.test.tsx` AUDIT2-UI1) | the whole filter form was remounted when the type options arrived                          | only the animal-type `<select>` remounts (`apps/web/src/pages/farms/FarmDashboardPage.tsx`); no visual change                                                                         |

## Scenario results

Columns condensed: preconditions and steps are summarised; the test name in the file carries the full steps. Related API is the main endpoint exercised.

### A. User registration and roles — 13 PASS, 1 FIXED

| ID       | Scenario (steps → expected)                                                                                                                     | Status          | Related API                              |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | --------------- | ---------------------------------------- |
| A1-1     | 9 invalid sign-ups → 400, no user row                                                                                                           | PASS            | `POST /auth/register`                    |
| A1-2     | Valid sign-up: normalised email, buyer role only, separate status fields at defaults, password hashed                                           | PASS            | register, login                          |
| A2-1/2/3 | Duplicate email (case/space variants), 4 parallel sign-ups, duplicate phone → one account, 409s                                                 | PASS            | register                                 |
| A3-1/2/3 | Expired/wrong-purpose tokens refused without burning; newer reset kills older; reset revokes all access + refresh tokens; old password refused  | PASS            | verify, reset, refresh                   |
| A3-4     | Reset link issued before a password change is dead afterwards                                                                                   | **FIXED** (Med) | `/auth/password/change`                  |
| A4-1/2/3 | Registration approve (needs reason + permission, grants `farm_owner`), reject, reapply, self-decision 403, suspension removes role              | PASS            | `/registrations`, `/admin/registrations` |
| A5-1/2   | Suspension kills access/refresh tokens and REST writes; unsuspend doesn't revive old sessions; suspended between password and TOTP → refused    | PASS            | `/admin/users/:id/status`, MFA           |
| A6-1/2/3 | Role grant/revoke and role-permission edits apply on the next request with the same token; MFA role revocation ends sessions                    | PASS            | roles                                    |
| A7-1/2/3 | Admin routes: anonymous 401, buyer 403, un-MFA 403 `MFA_REQUIRED`; self-grant/escalation refused; mass assignment of status/role/verified → 400 | PASS            | admin, users                             |
| A8-1/2/3 | Account status, identity verification, seller verification, subscription and payment status are separate fields; changing one leaves the others | PASS            | model + various                          |

### B. Farm and animal management — 10 PASS, 7 FIXED (by case)

| ID       | Scenario                                                                                             | Status           | Related              |
| -------- | ---------------------------------------------------------------------------------------------------- | ---------------- | -------------------- |
| B1-1/2   | Farm create; archive blocks 23 kinds of child writes; restore re-enables                             | PASS             | farms                |
| B1-3     | Archived farm's live listing cannot be traded or found                                               | **FIXED** (High) | marketplace          |
| B1-4     | Re-archive keeps original `archivedAt`                                                               | **FIXED** (Low)  | farms                |
| B2-1/2/3 | 11 actions × 5 roles; escalation cases; removed member loses access next request                     | PASS             | farm access, members |
| B2-4     | Parallel add of the same member → one 201, rest 409                                                  | **FIXED** (Low)  | members              |
| B3-1..4  | Duplicate animal codes (case/space/concurrent; other farm allowed), auto-code, immutable fields      | PASS             | animals              |
| B4-1/2/3 | Parentage: cross-farm, wrong sex/species, younger parent, self, cycles; archived dam allowed         | PASS             | animals              |
| B5-1/2/3 | Weight validation; growth rate equals hand-computed 0.783/2.607/1.3 (avg 1.338); per-type max weight | PASS             | weights, growth      |
| B6-1/2/3 | Health and feeding validation and ordering                                                           | PASS             | records              |
| B7-1/2   | Expenses: 1,395.11 THB total equals DB aggregate after void and correction; invalid amounts refused  | PASS             | expenses             |
| B8-1     | History shows corrections once, voids flagged, date filter, money hidden from worker                 | PASS             | history              |
| B8-2/3   | Parallel void / correction of one record                                                             | **FIXED** (Med)  | record-core          |
| B9-1/2   | Another farm's record and animal ids via every endpoint → 404, nothing changed                       | PASS             | records              |
| B9-3     | Another farm's animal's assessments → 404                                                            | **FIXED** (Low)  | ai routes            |

### C. Community and media — 32 PASS, 3 FIXED

| ID            | Scenario                                                                                                                                                                                     | Status          |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| C1-01/02/03   | Author-only edits; soft delete hidden everywhere incl. profile counts; moderated post locked                                                                                                 | PASS            |
| C1-04         | Comment under a deleted post cannot be edited                                                                                                                                                | **FIXED** (Med) |
| C2-01..04     | 10 parallel likes → 1; mixed like/unlike counts = rows; comment/reply counts through delete/hide/restore; follows idempotent, self-follow refused, suspended user                            | PASS            |
| C2-05         | No likes on comments under hidden content                                                                                                                                                    | **FIXED** (Low) |
| C3-01..05     | Feed cursor paging (identical timestamps, no gaps/duplicates), visibility rules, trending order, limit/cursor validation                                                                     | PASS            |
| C4-01..07     | Media URL allow-list (http, look-alike hosts, userinfo, `javascript:`), upload type/size/duration, failed upload + retry, provider outage, webhook signature (4 tamper cases), size mismatch | PASS            |
| C5-01..04     | Video visibility (owner/follower/stranger/anonymous), revocation on unfollow, delete invalidates playback, hidden video                                                                      | PASS            |
| C6-01..04     | Live host authorization, ended session final, 6 parallel creates → 1, parallel end/connect                                                                                                   | PASS            |
| C7-01..04, 06 | Report → hide → restore with counters and audit; self-moderation refused; comment removal counters                                                                                           | PASS            |
| C7-05         | Two moderators resolving one report at once → one action, one audit                                                                                                                          | **FIXED** (Low) |

### D. Marketplace and negotiation — 13 PASS, 4 FIXED

| ID       | Scenario                                                                                                                               | Status           |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| D1-a/b   | Listing from eligible animal; other farm's / sold / deceased / archived / already listed refused                                       | PASS             |
| D2-a     | 6 concurrent listings for one animal → 1                                                                                               | PASS             |
| D2-b     | Renew expired listing while another is open → 409 not 500                                                                              | **FIXED** (Med)  |
| D3-a     | Seller/manager/self-moderation cannot approve                                                                                          | PASS             |
| D3-b     | Partial edit keeps photos and delivery options                                                                                         | **FIXED** (High) |
| D4-a..d  | Own-listing offers refused; amount bounds; turn rules; fixed price                                                                     | PASS             |
| D5-a/b   | Expired offer cannot be accepted; cleanup idempotent                                                                                   | PASS             |
| D6-a     | Accept reserves at agreed amount once; competing negotiations cancelled                                                                | PASS             |
| D7-a/b/c | 6 parallel accepts → 1; 6 parallel checkouts → 1 order; 4 parallel delivery checkouts → 1 order, 1 quote used                          | PASS             |
| D8-a     | Completed sale: listing SOLD, animal `sold`, relist refused (animal stays on seller farm: ownership transfer is out of scope per spec) | PASS             |
| D8-b     | Sold animal edited back to active cannot be relisted                                                                                   | **FIXED** (High) |
| D8-c     | Animal deceased after listing cannot be reserved                                                                                       | **FIXED** (Med)  |
| D9-a/b   | Worker/viewer/outsider/removed manager and cross-farm paths refused                                                                    | PASS             |

### E. Orders and shipping — 16 PASS, 1 FIXED

| ID       | Scenario                                                                                                                         | Status          |
| -------- | -------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| E1-a/b   | Order price = accepted counter-offer (4,500,000 not asking 5,000,000); repeat checkout refused; seller side/third party refused  | PASS            |
| E1-c     | Buyer who joined the selling farm cannot check out                                                                               | **FIXED** (Low) |
| E2-a     | Product order snapshot unchanged after price/title edits; stale cart → `PRICE_CHANGED`                                           | PASS            |
| E3-a/b/c | Quote ownership, expiry, province, forged option/client shipping refused; quote amount used exactly; seller terms change → stale | PASS            |
| E4-a/b   | Unpaid order cannot be processed/shipped/confirmed; payment window expiry releases listing                                       | PASS            |
| E5-a/b/c | Cancellation per state; parallel buyer+seller cancel of paid order → exactly 1 refund of 4,250,000; shipped order rules          | PASS            |
| E6-a/b   | Shipment transitions validated; carrier webhook signature (missing/bad/tampered/stale) → 401; out-of-order ignored               | PASS            |
| E7-a/b/c | Delivery confirmation buyer-only, once; auto-confirm only after carrier report (+3 days); pickup flow                            | PASS            |
| E8-a/b   | Refund = amount received incl. shipping, once; delivered order has no refund path; repeated "returned" → 1 refund                | PASS            |

### F. Payments, wallet and commission — 25 PASS, 4 FIXED (+1 from F5 own)

| ID       | Scenario                                                                                                                                                                                    | Status           |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| F1a/b    | Successful payment books one balanced journal; failed books nothing, new attempt works                                                                                                      | PASS             |
| F2a/b    | Same event ×8, same payload with new ids ×4, late `charge.failed` → booked once                                                                                                             | PASS             |
| F3a      | Wrong secret, ±301 s timestamp, tampered body, missing/garbage header → 401, nothing changes                                                                                                | PASS             |
| F4a/b/c  | Under/over-payment parked and refunded exactly (suspense back to start); currency mismatch booked nothing                                                                                   | PASS             |
| F4d      | Zero-amount capture → no 500, reconcile still works                                                                                                                                         | **FIXED** (Med)  |
| F5a/b/c  | Commission min/max/percent at 9 boundaries incl. 10^12; rule window start-inclusive/end-exclusive; 1-satang and ฿100M lines                                                                 | PASS             |
| F5 (own) | Editing a rule's fee keeps its categories                                                                                                                                                   | **FIXED** (High) |
| F6a/b    | Full refund reverses capture exactly; partial refund refused (not supported, documented)                                                                                                    | PASS             |
| F6c      | Parallel identical refund callbacks → one audit entry                                                                                                                                       | **FIXED** (Low)  |
| F7a..f   | Withdrawal request/approve/pay; payout failure and retry; outage retry → 1 payout; self-approval refused; over-balance and 10 parallel requests (exactly 4 succeed); approve vs cancel race | PASS             |
| F8a/d    | Parallel refund approvals / retries → 1 provider call, 1 journal                                                                                                                            | PASS             |
| F8b/c    | Parallel identical payout callbacks → one audit entry                                                                                                                                       | **FIXED** (Low)  |
| F9a      | Mixed run on one farm: balances, ledger sum 0, reconcile clean, audit chain intact                                                                                                          | PASS             |
| F10a/b   | Only the 14 documented money routes accept writes; balance fields on 8 wallet paths refused                                                                                                 | PASS             |

### G. AI assessment — 14 PASS, 4 FIXED

| ID         | Scenario                                                                                           | Status           |
| ---------- | -------------------------------------------------------------------------------------------------- | ---------------- |
| G1-1/2     | Missing weights/birth date → nulls and disclosed gaps; invented number rejected                    | PASS             |
| G2-1/2     | Unsupported species → no score/price; deleted type → 404, no provider call                         | PASS             |
| G3-1       | Malformed output, diagnosis, links, extra fields, oversize rejected                                | PASS             |
| G3-2       | Thai/full-width digit price rejected                                                               | **FIXED** (High) |
| G3-3       | Spelled-out price rejected                                                                         | **FIXED** (Med)  |
| G3-4       | Health-status claim rejected                                                                       | **FIXED** (Med)  |
| G4-1       | No market data → no price, low confidence, warning                                                 | PASS             |
| G5-1, G6-1 | History newest-first and farm-scoped; role permissions on create/read/review                       | PASS             |
| G7-1/2     | Provider timeout/unavailable/rate-limit/throw → failed narrative, usage logged, no commerce effect | PASS             |
| G7-3       | Real adapter honours timeout when the body stalls                                                  | **FIXED** (Med)  |
| G8-1       | Estimates labelled with basis and sample size; facts exact                                         | PASS             |
| G9-1       | AI never changes listings, orders, payments, refunds, wallets or ledger                            | PASS             |

### H. Products and inventory — 11 PASS, 1 FIXED

| ID      | Scenario                                                                                          | Status           |
| ------- | ------------------------------------------------------------------------------------------------- | ---------------- |
| H1a     | Create → submit → only moderator approves; hidden until approved                                  | PASS             |
| H2a/b   | Stock adjustments audited, cannot go below reserved; 12 parallel checkouts/adjustments consistent | PASS             |
| H3a     | 20 buyers for 5 units → 5 orders, no oversell, movements = stock                                  | PASS             |
| H3b     | Same cart checked out twice in parallel → one order                                               | **FIXED** (High) |
| H4a/b   | Out-of-stock and insufficient stock flagged; nothing reserved                                     | PASS             |
| H5a     | Price change between cart and checkout → `PRICE_CHANGED`; order keeps snapshot                    | PASS             |
| H6a     | Regulated category closed, prohibited terms refused, live product unchanged                       | PASS             |
| H7a/b/c | Unpaid cancel releases once; paid cancel/refund restocks once; returned shipment restocks once    | PASS             |

### I. Dashboard and reporting — 14 PASS, 3 FIXED

| ID       | Scenario                                                                                                      | Status          |
| -------- | ------------------------------------------------------------------------------------------------------------- | --------------- |
| I1-1/2   | Dashboard sales, costs, animals equal direct DB sums                                                          | PASS            |
| I2-1     | Refunded/cancelled shown apart; gross − commission = net; released + pending = net                            | PASS            |
| I2-2     | Animal-type filter's effect on sales disclosed; no mixed-scope net-over-cost                                  | **FIXED** (Low) |
| I2-3     | Orders CSV refuses an animal-type filter it cannot apply                                                      | **FIXED** (Low) |
| I3-1/2/3 | 23:30 vs 00:30 Bangkok on the right day in totals, series and CSV; invalid ranges → 400                       | PASS            |
| I4-1..4  | Unrelated owner / removed manager → 404; viewer/worker see only permitted sections; staff without MFA refused | PASS            |
| I5-1/3   | CSV totals equal dashboard per filter; admin totals equal Order sums                                          | PASS            |
| I5-2     | Admin analytics tells un-MFA staff `MFA_REQUIRED`                                                             | **FIXED** (Low) |

### UI → API → DB journeys (browser) — 5 PASS

| ID     | Journey                                                                                                                                        | Status |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| UI-I05 | Owner filters farm dashboard and downloads Costs CSV; file byte-identical to API export, totals equal DB; viewer/stranger cannot export        | PASS   |
| UI-F05 | Seller adds payout account and requests withdrawal in Wallet UI; finance admin (MFA) approves in admin UI; balances, ledger and audit verified | PASS   |
| UI-F04 | Buyer cancels paid order in UI; finance admin approves refund in admin UI; order REFUNDED, ledger balanced                                     | PASS   |
| UI-E05 | Seller ships with carrier/tracking; buyer sees tracking and confirms receipt; DB and ledger verified                                           | PASS   |
| UI-C07 | Member reports a post; moderator hides it in admin UI; post leaves other users' feeds; audit row                                               | PASS   |

## Files changed in this pass

**Production (26):** `apps/web/src/pages/farms/FarmDashboardPage.tsx` · `packages/validation/src/{marketplace,finance}.ts` · `services/api/src/models/cart.model.ts` · `services/api/src/services/auth.service.ts` · `services/api/src/modules/` — `products/cart.service.ts`, `finance/{payments,refunds,withdrawals}.service.ts`, `marketplace/{common,listings.service,negotiations.service}.ts`, `orders/orders.service.ts`, `community/{comments,reactions,moderation}.service.ts`, `analytics/{farm.service,exports,analytics.routes}.ts`, `farms/{farms,members}.service.ts`, `records/record-core.ts`, `ai/{narrative,provider,ai.service,ai.routes}.ts`, `settings/settings.service.ts`.

**Tests:** 5 new `test/workflows/audit-*.test.ts`, 1 new e2e spec, +1 case in `test/regressions/finance.test.ts`, +1 case in `apps/web/test/analytics-ui.test.tsx`. `e2e/tests/business-workflows.spec.ts` WF-UI-H03 now waits for "Added to your cart." before leaving the product page (since add-to-cart reads the cart first, leaving immediately cancelled the request).

**Database:** no migration; one optional field `carts.checkoutLockedUntil` (default `null`, matches missing). **UI:** no visual change.

**Behaviour changes to note:** a second checkout of the same cart while one runs gets 409 `CHECKOUT_IN_PROGRESS`; an archived farm's listings disappear from public browsing until restored; spelled-out prices and health-status words are refused in AI narratives (a deployment that already saved its own `ai.blockedNarrativeTerms` keeps its list); parallel record edits can now return 409 `RECORD_CHANGED`.

## Final test results

| Check                         | Result                                                                                                                                                                                                                                                    |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Typecheck (all packages, e2e) | PASS                                                                                                                                                                                                                                                      |
| Lint                          | PASS                                                                                                                                                                                                                                                      |
| Format                        | FAIL on 3 files, none from this audit: generated `api-journey.json` (pre-existing) and `docs/qa/security-remediation-audit.md`, `services/api/test/qa/security-static.test.ts`, which **another session** created/edited during this run (left untouched) |
| API (Vitest)                  | **1236 / 1236**, 53 files (an earlier run had 2 `rbac.test.ts` failures while another session was editing `role.service.ts` / `rbac.test.ts`; they pass now; none of this audit's changes touch role management)                                          |
| Web                           | **293 / 293** (one inbox UI test failed intermittently in 2 of 10 runs under heavy load — a different test each time, both at the 1 s wait limit; not reproduced in 8 isolated runs; cause not confirmed)                                                 |
| Mobile                        | 157 / 157                                                                                                                                                                                                                                                 |
| Build                         | PASS                                                                                                                                                                                                                                                      |
| Browser e2e                   | **16 / 16** (final full run after the dashboard fix; an earlier full run had UI-I05 fail intermittently, which exposed defect UI1)                                                                                                                        |
| Dependency policy             | 5 advisories, 0 failing                                                                                                                                                                                                                                   |

## Not covered / blocked

| Area                                                                  | Status                                                                       |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Real payment provider sandbox (charges, refunds, payouts, signatures) | BLOCKED — no production adapter exists (`PAYMENT_PROVIDER` is `none`/`mock`) |
| Real video, SMS/e-mail, shipping carrier, AI provider                 | BLOCKED — no credentials                                                     |
| Subscriptions                                                         | NOT IMPLEMENTED (field only)                                                 |
| Mobile UI workflows on devices                                        | NOT RUN                                                                      |
| Atlas, staging, multi-instance, penetration test                      | NOT RUN                                                                      |
| Blocking/muting in community                                          | NOT IMPLEMENTED (documented limitation)                                      |

## Open items (not fixed — decisions)

From earlier passes and still open: MFA enrolment without re-authentication; binding an unverified e-mail/phone; staff adding themselves as farm members; seller self-reported "delivered"; listing pause→edit→resume without review; duplicate-tab session revocation. New from this pass: holders of a delegated `permissions.manage` can add permissions to the system roles `buyer`/`seller`/`farm_owner` (only `super_admin` is protected) — confirm intended; seller-delivered shipping charges stay in the platform `shipping` account (documented as out of scope); archived-farm listing filter uses a list of archived farm ids per search (fine now, revisit at scale).
