# Farm management (Part 07)

API modules: `services/api/src/modules/{farms,animals,animal-types}` · Collections: `farms`, `farm_members`, `animal_types`, `animals`.
Web: `apps/web/src/pages/farms/` (route `/farms`, design-system layout). Mobile: `app/(tabs)/my-farm.tsx`, `app/farm/**`, `app/animal/[id].tsx`.
Both clients call the same REST API through `@farmplus/api-client`, and validate forms with the same Zod schemas (`@farmplus/validation`).

## Authorisation model (two layers, both enforced by the API)

1. **Who may create a farm** — the `farm_owner` role (granted when a farm-owner registration is approved, Part 04) or platform `farms.manage`.
   Controlled by setting `farms.requireFarmOwnerRole` (default on) so an operator can open it up.
2. **What you may do on a farm** — your _farm role_ (`farm_members`), whose permissions are defined once in
   `shared-types` (`FARM_ROLE_PERMISSIONS`) and are never stored per member:

| Role                             | Permissions                                                             |
| -------------------------------- | ----------------------------------------------------------------------- |
| owner (exactly one: the creator) | everything, incl. archive farm                                          |
| manager                          | edit farm, manage members below manager, animals read/write/**archive** |
| worker                           | read farm/members, animals read/**write** (no archive)                  |
| viewer                           | read-only                                                               |

Platform staff reach farms they do not belong to through Part 03/04 permissions: `farms.read` → read-only, `farms.manage` → everything except
archiving the farm. Both need an MFA-verified session (otherwise `403 MFA_REQUIRED`).

Rules enforced in `farm-access.ts` / `members.service.ts`:

- **No probing:** a farm you have no relationship with is `404`, never `403`. A member lacking one permission gets `403 FARM_FORBIDDEN`.
- **Every animal lookup includes its farm** (`{ _id, farmId }`): an animal id from another farm is `404` through any URL (IDOR-tested). `GET /animals/:id`
  (used by deep links) authorises through the animal's own farm.
- **No privilege escalation:** you may only assign/change/remove roles _strictly below your own_; `owner` is not assignable, cannot be changed, removed
  or leave; nobody can change their own role; a member id from another farm is `404`.
- Removing a member revokes access immediately (permissions are resolved per request).
- **Archived farms are read-only** (`409 FARM_ARCHIVED`); archived animals are read-only (`409 ANIMAL_ARCHIVED`).
- Adding a member by e-mail reveals whether an account exists → rate-limited (30/hour/IP) and documented as a known trade-off (no invitation flow yet).

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

## Animal types are data (not code)

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
media links are refused (`MEDIA_NOT_CONFIGURED`) until it is set. **Not built:** the upload itself (signed upload URLs) — it needs a storage provider decision.

## Lists

`GET /farms` and `GET /farms/:id/animals`: `page`, `pageSize ≤ 100`, `q` (code/name, regex-escaped), filters (`animalTypeId`, `breed`, `sex`, `status`,
`archived=false|true|all`), `sortBy` (animalCode · name · birthDate · createdAt) and `order`. Code sorting is natural (A-2 before A-10).
Web keeps list state in the URL; Mobile uses infinite scroll with de-duplication.

## Audit

`farm.created/updated/archived/restored` (`farm.updated` lists changed fields, incl. `animalTypeIds`), `farm.member_added/role_changed/removed/left`, `animal.created/updated/archived/restored/media_added/media_removed`,
`animal_type.created/updated/breed_added/breed_updated`, `settings.updated`.

## Limitations / follow-ups

- Members UI (add/remove people) is not built — API only (tested). Animal types are managed at `/admin/animal-types`.
- Mobile registers, edits (`/animal/edit/:id`, shared `AnimalForm`), archives/restores animals and records growth (`/animal/growth/:id`); it cannot manage media, and has no pedigree or trades screens (web only).
- No ownership transfer, invitations, or per-member custom permissions. Role permissions are fixed in code.
- No file upload, no animal import.
- Existing databases need `animal_types.manage` granted to the admin role by hand (new installs get it); starter types are seeded on API start.
