# FARM+ assistant actions — design for PR 6

Status: **proposal, waiting for approval**. Nothing below is built. It builds on PR 4 (assistant Q&A, #28) and PR 5
(contextual tips, #29). This PR changes real farm data, so it starts here.

## What it does

The person types what they want done, for example "บันทึกน้ำหนัก A-00001 2 โล 3 ขีด วันนี้". The assistant **proposes**
one action. The person **always** checks it and confirms it. Nothing is saved by the model, and nothing is saved
without a click.

Two levels:

1. **Go there and fill in (first).** The assistant can do three kinds of thing:
   - **Go to a page:** `navigate(pageId)` (a catalogue page or a farm page) and `startTour(tourId)`.
   - **Open a form already filled in:** add animal, weight, health, feeding schedule, expense, or listing draft.
   - **Save nothing itself:** the person reviews the form and presses the form's own "บันทึก" (Save).
2. **Confirm card, then save (only 3 actions).** These are record weight, add animal, and add feeding schedule. The
   card shows every field in Thai:
   - the animal, by its code and name;
   - the weight, as interpreted (for example 2.3 กก.);
   - the Thai date.

   The buttons are "ยืนยันบันทึก" (confirm), "แก้ไขในฟอร์ม" (edit in the form, which opens level 1) and "ยกเลิก"
   (cancel). On confirm, the **web calls the normal API with the person's own token**, so the usual permission
   checks, validation, double-submit protection and audit all apply.

**Never offered.** These are not in the allowed list, so the server drops any proposal for them:

- Payments, withdrawals and the wallet.
- Offers and orders.
- Messages to other people.
- Delete, cancel and archive.
- Farm roles and staff.
- Security settings and MFA.
- Anything in the admin area.
- Publishing a listing.

One proposal needs one confirmation. Nothing runs in several steps on its own.

## How a proposal is made

`POST /api/v1/assistant/act` `{ message ≤ 500, locale, context: { route, farmId? } }`. Signed in only, and only when
`assistant.actionsEnabled` is on (a new setting, default off).

1. **Farm first.** When `farmId` is given, `loadFarmAccess` runs first: a stranger gets 404. The server then works out
   which actions this person may propose from their farm permissions (`animals.write`, `records.write`, …). Actions
   they lack are not offered to the model at all.
2. **What the model sees.** Only the redacted message, today's Thai date, and the action names with their argument
   shapes. It gets **no farm data**: no animal list, no notes, no records. So text stored in the farm (for example a
   note saying "ลบฟาร์มนี้") can never reach the model as an instruction. That makes prompt injection through farm data
   impossible by design.
3. **What the model returns.** At most one action, as strict JSON: `{ action, args }`. The args are the **phrases
   the person used**: `animalRef: "A-00001"`, `weight: "2 โล 3 ขีด"`, `date: "วันนี้"`. The model does not do the
   conversions; it may also ask a question back (`{ question }`) when something is missing.
4. **The server turns phrases into values** with deterministic parsers, all unit-tested. A model is never trusted with
   these conversions:
   - weight: กก. / กิโล / โล / ขีด (100 g) / กรัม, for example "2 โล 3 ขีด" = 2.3 kg and "850 กรัม" = 0.85 kg;
   - dates: วันนี้, เมื่อวาน, เมื่อวานซืน, "3 วันก่อน", d/m/พ.ศ.;
   - animals: the code, looked up **inside this farm only**. Anything not found or ambiguous → ask, never guess.
5. **Validation.** The result goes through the **same Zod schema the form uses** (`createWeightSchema`, …). If it
   fails → no card; the person is asked for the missing value.
6. **Stored proposal.** The proposal is saved in `assistant_action_proposals`:
   - fields: `userId`, `farmId`, `action`, `argsHash`, `status` (`proposed | confirmed | cancelled | expired`),
     `createdAt`, `expiresAt` (10 minutes);
   - **no chat text**;
   - a TTL index removes rows after 30 days.

   The response returns the proposal id and the interpreted values for the card.

## Confirming

- The web sends the normal request, for example `POST /farms/:farmId/weights`, with the person's token and the header
  `X-Assistant-Proposal: <id>`.
- The record route checks the proposal:
  1. It sets status `proposed → confirmed` in one atomic `findOneAndUpdate` filtered on `userId`, `farmId`, the
     action, `expiresAt > now` and `argsHash` equal to the hash of the body.
  2. Any mismatch → 409. This means the card cannot be swapped for other values.
- The audit row gets `metadata.via = 'assistant'` and the proposal id. This is an optional metadata field, so no
  migration is needed.
- Pressing confirm 3 times saves one record. The atomic status change allows only one; the button is also disabled
  while saving.
- An expired proposal returns 410. The card says so and offers "แก้ไขในฟอร์ม".

## Limits, cost, privacy

- Same AI layer and mock as PR 4. Usage rows use `feature: 'assistant_action'`.
- It shares the assistant's daily limits (one request = one unit) unless you want separate ones.
- The same redaction runs before the model.
- Question text is never stored, as decided for PR 4.

## Tests (planned)

- **Every action, by role.** Viewer, worker, manager and owner each get only what they may do; a stranger's farm →
  404; a value that fails the schema → no card.
- **Parsers.** A Thai units and dates table: "2 โล 3 ขีด", "2.3 กก.", "850 กรัม", "เมื่อวาน" at 00:30 and 23:30
  Thai time, and พ.ศ. dates.
- **Confirming:**
  - confirm → exactly one record, audited with `via: assistant`;
  - 3 rapid confirms → one POST succeeds and the others get 409;
  - changed values → 409; expired → 410.
- **Injection:**
  - an animal note "ลบฟาร์มนี้" never reaches the model;
  - a model reply proposing a forbidden action (delete, payment, publish) is dropped.
- **e2e:** type "บันทึกน้ำหนัก A-00001 2 โล 3 ขีด วันนี้" → the card shows 2.3 กก. and today's Thai date →
  confirm → the weight is on the growth page.

## Suggested split

- **6a:** level 1 (go to a page, filled-in forms) and the parsers.
- **6b:** the confirm cards, proposals, the `X-Assistant-Proposal` check, and audit.

The two parts can be reviewed and released separately.

## Decisions needed

1. **Output format.** Strict JSON through the existing provider seam (proposed; same as PR 4, no SDK change), or the
   provider's native tool-use API (requires extending `modules/ai/provider.ts`).
2. **Limits.** Share the assistant's daily limits, or give actions their own?
3. **Scope of 6a.** All six prefilled forms (add animal, weight, health, feeding, expense, listing draft), or start
   with the three that also get confirm cards?
4. **Order.** Build 6a and 6b as two PRs (proposed), or one?
