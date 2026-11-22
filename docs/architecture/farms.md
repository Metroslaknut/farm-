# Farm management (Part 07)

API modules: `services/api/src/modules/{farms,animals,animal-types}` · Collections: `farms`, `farm_members`, `farm_invitations`, `animal_types`, `animals`.
Web: `apps/web/src/pages/farms/` (route `/farms`, design-system layout). Mobile: `app/(tabs)/my-farm.tsx`, `app/farm/**`, `app/animal/[id].tsx`.
Both clients call the same REST API through `@farmplus/api-client`, and validate forms with the same Zod schemas (`@farmplus/validation`).

## Authorisation model (two layers, both enforced by the API)

1. **Who may create a farm** — the `farm_owner` role (granted when a farm-owner registration is approved, Part 04) or platform `farms.manage`.
   Controlled by setting `farms.requireFarmOwnerRole` (default on) so an operator can open it up.
2. **What you may do on a farm** — your _farm role_ (`farm_members`), whose permissions are defined once in
   `shared-types` (`FARM_ROLE_PERMISSIONS`) and are never stored per member:

| Role                             | Permissions                                                                        |
| -------------------------------- | ---------------------------------------------------------------------------------- |
| owner (exactly one: the creator) | everything, incl. archive farm and **staff management** (`members.manage`)         |
| manager                          | edit farm, animals read/write/**archive**, records, breeding, expenses, listings   |
| worker                           | read farm/members, animals read/**write** (no archive), records and breeding write |
| viewer                           | read-only                                                                          |

**Per-member permissions.** The role is the _ceiling_. The owner may narrow a member's set (`PUT …/members/:memberId/permissions`,
`{permissions: [...] | null}`; `null` = back to the role's defaults). Stored in `farm_members.permissions` (absent/null on
older documents, which therefore keep the role's defaults with no migration) and always intersected with the role at read
time (`effectiveFarmPermissions`), so a stored value can never widen access. Nobody changes their own set; the owner's is
fixed; a role change resets the custom set. `farm.read` is always kept. Changes apply on the next request.

Spec permission names map onto Farm+ keys: `animal.view/create/update/delete` → `animals.read/write/write/archive`,
`breeding.view/create/update/delete` → `breeding.read/write/write/correct`, `farm.report.view` → `farm.read`,
`farm.staff.manage` → `members.manage`, `farm.settings.manage` → `farm.update`.

**One account, many farms.** Membership is per farm (`farm_members` is the User↔Farm N:M link), so one person can own
several farms and be a manager/worker/viewer of others at the same time; `GET /farms` returns `myRole` per farm.

Platform staff reach farms they do not belong to through Part 03/04 permissions: `farms.read` → read-only, `farms.manage` → everything except
archiving the farm. Both need an MFA-verified session (otherwise `403 MFA_REQUIRED`).

Rules enforced in `farm-access.ts` / `members.service.ts`:

- **No probing:** a farm you have no relationship with is `404`, never `403`. A member lacking one permission gets `403 FARM_FORBIDDEN`.
- **Every animal lookup includes its farm** (`{ _id, farmId }`): an animal id from another farm is `404` through any URL (IDOR-tested). `GET /animals/:id`
  (used by deep links) authorises through the animal's own farm.
- **No privilege escalation:** only the owner (or platform `farms.manage`) manages staff; `owner` is not assignable, cannot be changed, removed
  or leave; nobody can change their own role or permissions; a member id from another farm is `404`.
- Removing a member revokes access immediately (permissions are resolved per request) and marks the invitation that created
  the membership `REVOKED`.
- **Archived farms are read-only** (`409 FARM_ARCHIVED`); archived animals are read-only (`409 ANIMAL_ARCHIVED`).
- Inviting by e-mail or phone reveals whether an account exists → exact match only (never partial names) and rate-limited
  (30/hour/IP), a documented trade-off.

## Invitations and join requests (`farm_invitations`)

People get into a farm only with both sides agreeing. Statuses: `PENDING → APPROVED | REJECTED | CANCELLED`, `APPROVED → REVOKED`.

- **Invitation** (owner → person): `POST /farms/:farmId/invitations {email | phone, role, permissions?, message?}`. The invitee answers at
  `POST /farm-invitations/:id/accept|decline`; the owner may withdraw it (`…/invitations/:id/cancel`).
- **Join request** (person → farm): `POST /farm-invitations/requests {farmId, message?}`; the owner answers with
  `POST /farms/:farmId/invitations/:id/approve {role, permissions?}` or `…/reject`; the requester may withdraw (`/farm-invitations/:id/cancel`).
- `GET /farms/:farmId/invitations?status=` (owner) and `GET /farm-invitations?status=` (the caller's own).
- **No access while PENDING**: the `farm_members` row is created only when the invitation becomes `APPROVED`. Every transition is a
  compare-and-set on `status: PENDING`, and a unique partial index allows one open invitation/request per farm and person, so parallel
  requests cannot create duplicates (tested). Accept/decline/request ids are scoped to the caller (someone else's id is 404).
- **Direct add** (`POST /farms/:farmId/members`) is kept for platform staff with `farms.manage` (MFA) only; owners get `403 USE_INVITATION`.
- Notifications: `farm.invitation_received`, `farm.invitation_accepted/declined`, `farm.join_requested`, `farm.join_rejected`
  (approval sends the existing `farm.member_added`). Audit: `farm.invitation_created/cancelled/accepted/declined`,
  `farm.join_requested/join_request_approved/join_request_rejected/join_request_cancelled`, `farm.member_permissions_changed`.

## Onboarding and the "My farm" home

- **Setup status is derived, never stored.** `GET /farms/me` → `{status, canCreateFarm, farms}`: `farm_setup_completed` (member of ≥ 1 farm),
  `farm_setup_required` (no farm, but allowed to create one — `farm_owner` role, setting off, or `farms.manage`), `not_applicable` (no farm and not
  allowed: buyers are never forced into setup). No flag can drift out of sync with memberships.
- **Web:** `RequireFarmSetup` guards every `/farms` page except `new`, `profile`, `settings`: `farm_setup_required` → `/farms/new` (step-by-step: profile →
  location → contact, no cancel/back while required). After saving → `/farms/:id`. Farm settings then live in the profile (`/farms/profile` → `/farms/:id/edit`,
  owners/managers). **Mobile:** the My Farm tab redirects to `/farm/new?setup=1` (re-checked on focus); the profile tab lists the user's farms.
- **Farm types raised:** `farms.animalTypeIds` (optional, refs `animal_types`; must be active when added, already-declared inactive types may be kept).
- **`GET /farms/:farmId/summary`** (`animals.read`): live counts per animal type (archived excluded): total, on farm (`active`+`for_sale`), for sale, sold,
  and _needs a growth check_ = on-farm animals with no non-voided weighing in `farms.growthCheckDays` (setting, default 30; `null` without `records.read`).
  Declared types appear even with zero animals. `outsideStandard`: on-farm animals whose latest measurement is outside its growth criterion (see records.md). `trade` (listings by status, animal orders) only with `listings.manage`.
  Web shows these as cards (click → animal list filtered by type) plus the "My farm" menu filtered by farm permissions.
- **Lineage:** `/farms/:id/lineage` (pick an animal) → `/farms/:id/animals/:animalId/lineage` (pedigree tree, siblings, offspring), from
  `GET …/animals/:id/lineage?generations=1–5` (see records.md).
- **Trades:** `/farms/:id/trades` (owners/managers, `listings.manage`) composes the existing APIs — no separate trading system: counts from
  `/summary`, listings from `/farms/:id/listings` (status filter, cursor paging, real sale price from the reservation), animal orders from
  `/farms/:id/orders` (buyer shown by public display name only; payment state derived from the order status).

`GET /farms/:farmId` includes `owner: {id, displayName}` (display name only), shown on the animal form and animal detail.

## Animal types are data (not code)

Besides breeds, an animal type carries `reproduction` (`live_birth` | `egg`), `rearingTypes[]` (e.g. chicken → fighting cock) and
`breedGroups[]` (`{key, name, nameTh, rearingTypeKey, active}`). A breed may name its `groupKey` and a `composition` (the lineage
components it stands for, e.g. `["burmese","thai"]` for "พม่า + ไทย"; without it a breed counts as its group). Admin API:
`POST/PATCH /animal-types/:id/rearing-types[/:key]`, `POST/PATCH /animal-types/:id/breed-groups[/:key]`, and `groupKey`/`composition` on
the breed endpoints. Entries are deactivated, never deleted; a deactivated group hides its breeds from pickers.

**Fighting-cock starter catalogue**: rearing type `fighting_cock`, 5 groups (`thai`, `burmese`, `saigon`, `foreign`, `crossbred`) and 39
breeds (`modules/animal-types/fighting-cock-catalogue.ts`, frozen). New installs get it with the starter types; existing databases get it
from migration `0002-fighting-cock-catalogue`, which only adds missing entries and never changes existing ones. The spec's crossbreeds
name lines that have no group ("ป่าก๋อย", "บราซิล"), so composition components are free keys (`pakoi`, `brazil`, …); foreign breeds
each stand for their own component.

`animal_types` holds species and their breeds (embedded). A starter catalogue (buffalo, cattle, goat, pig, chicken, duck) is inserted **only when the
collection is empty**; afterwards `animal_types.manage` holders (admin/super_admin) add species, rename, add/deactivate breeds via
`/api/v1/animal-types`. Nothing in the code references a species key (tested by creating "alpaca"/"llama" at runtime and registering animals).
Inactive types/breeds disappear from pickers and cannot be used for new animals; existing animals keep them. Breeds are validated against the type's active catalogue.

## Animal identity

`animalCode` is **unique within a farm, case-insensitively** (`A-1` = `a-1`), via a unique `(farmId, animalCode)` index with a case-insensitive collation —
so concurrent registrations cannot both win (tested: 6 parallel requests → 1×201, 5×409). Archived animals keep their code reserved. A duplicate is
`409 DUPLICATE_ANIMAL_CODE` with a field error on `animalCode`. If the client sends no code the server issues `A-00001…` from an atomic per-farm counter and
skips codes that were typed by hand. Code, type and farm of an existing animal can never be changed.
Codes allow letters, digits and `. _ - /` (max 40, no spaces — safe in URLs, QR codes and ear tags).

## Rearing type, cross-breeds and breed group

`animals.rearingType` (a key of the type's active rearing types) and `animals.crossBreeds[]` (further active breeds of the same type,
not the main breed) are optional. The breed group is **resolved from the catalogue** (`breedGroup` on summaries), never stored on the
animal. `GET …/animals?breedGroup=&rearingType=` filter (a group resolves to its breed keys; index `(farmId, breed)`).
Changing `sireId`/`damId` is audited with old and new values (`animal.updated` → `metadata.lineage`).

## Colour and approximate age

`animals.color` (optional, ≤ 120 chars, `null` clears) holds colour / markings as free text. When the exact birth date is unknown, web and mobile
offer "approximate age" (years + months): `estimatedBirthDate()` in `@farmplus/validation` turns it into a birth date (Thai today minus the age,
day clamped) that is always saved with `birthDateEstimated: true`, so ages and growth comparisons derived from it are flagged as estimates.

## Validation (same schemas in API, Web, Mobile)

Required: `animalTypeId`, `sex`. Dates are calendar days (`YYYY-MM-DD`), not in the future, acquisition ≥ birth. Breed must belong to the type.
Parents (`sireId`/`damId`): same farm, same species, plausible sex, different animals, not itself, no ancestry loops, born after the parent.
Sex cannot be changed if it contradicts recorded offspring. Unknown fields are rejected (`strict`): `farmId`, `archivedAt`, … cannot be injected.

## Media (photos & documents)

Files live in external object storage; the API stores only references: `POST /farms/:farmId/animals/:id/media {kind, url, mimeType?, caption?}`.
`https` only, ≤ 20 per animal, duplicates rejected, photos must be `image/*`. `MEDIA_ALLOWED_HOSTS` restricts link hosts (exact or subdomain); in production
media links are refused (`MEDIA_NOT_CONFIGURED`) until it is set.

**Photos uploaded from a device** come in through `POST /farms/:farmId/animals/:id/photos`:

- The body is the image itself.
- Access is checked first: `animals.write`, an active farm, and an animal that is not archived.
- The upload is limited to 3 MB, and the type is sniffed from the bytes. Only JPEG, PNG and WebP are accepted.
- The upload rate limit applies.

Each photo gets a random 192-bit key. That key is the capability for reading the photo without a token, because an
`<img>` tag cannot send one. An `AnimalPhoto` document records the owner and the metadata. Where the bytes live depends on
`PHOTO_STORAGE`:

- `database` (dev/test default): the bytes are stored in that document and served by
  `GET /api/v1/animal-photos/<key>`, which is public and rate limited per IP.
- `r2` (staging and production): the bytes go to Cloudflare R2 through `modules/animals/photo-storage.ts`, which signs
  requests with SigV4 in `lib/sigv4.ts` and needs no SDK. The media URL is `R2_PUBLIC_BASE_URL/animal-photos/<key>`,
  served by the bucket's custom domain.
  - If the bucket refuses the upload, nothing is recorded, and the client gets `503 PHOTO_STORAGE_UNAVAILABLE`.
  - Removing the media entry deletes the document and the object. A failed object delete is reported, not returned to
    the client.
  - Photos stored in the database before the switch keep being served and removed as before.

## Lists

`GET /farms` and `GET /farms/:id/animals`: `page`, `pageSize ≤ 100`, `q` (code/name, regex-escaped), filters (`animalTypeId`, `breed`, `sex`, `status`,
`archived=false|true|all`), `sortBy` (animalCode · name · birthDate · createdAt) and `order`. Code sorting is natural (A-2 before A-10).
Web keeps list state in the URL; Mobile uses infinite scroll with de-duplication.

## Audit

`farm.created/updated/archived/restored` (`farm.updated` lists changed fields, incl. `animalTypeIds`), `farm.member_added/role_changed/removed/left`, `animal.created/updated/archived/restored/media_added/media_removed`,
`animal_type.created/updated/breed_added/breed_updated`, `settings.updated`.

## Limitations / follow-ups

- Web: `/farms/:farmId/staff` (staff list, invite by e-mail/phone, per-member permissions, revoke, approve/reject join requests,
  shareable join link `/farms/invitations?join=<farmId>`), `/farms/invitations` (accept/decline, ask to join, withdraw), `/farms/list`
  split into farms I own / farms I help run (`GET /farms?relation=owned|managed`). Animal types, rearing types and breed groups are
  managed at `/admin/animal-types`. Mobile has no staff/invitation screens.
- Mobile registers, edits (`/animal/edit/:id`, shared `AnimalForm`), archives/restores animals and records growth (`/animal/growth/:id`); it cannot manage media, and has no pedigree or trades screens (web only).
- No ownership transfer. Role ceilings are fixed in code; per-member sets can only narrow them.
- Notification recipients for seller-side events (`sellerSideUserIds`) honour per-member `listings.manage`.
- No file upload, no animal import.
- Existing databases need `animal_types.manage` granted to the admin role by hand (new installs get it); starter types are seeded on API start.
