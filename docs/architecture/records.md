# Breeding, growth, health & feeding (Part 08)

API: `services/api/src/modules/{records,breeding,health,animal-growth,feeding,farm-expenses}` · Collections: `breeding_records`, `health_records`,
`weight_records`, `feeding_records`, `farm_expenses`. Web: `apps/web/src/pages/farms/records/`. Mobile: growth only (`app/animal/growth/[id].tsx`: measurements, criteria, alerts, entry form); the other record kinds are web-only.

## One record core, five kinds

Every kind is described by a `RecordSpec` (`records/record-core.ts`) and shares the same behaviour and the same routes (`record-routes.ts`):

- **Append-only.** Nothing is deleted or silently overwritten. A record is either _corrected_ or _voided_.
- **Correction** (`POST …/:id/corrections {reason, changes}`): reason is mandatory (≥ 3 chars); the merged record is re-validated with the kind's create
  schema; immutable fields (farm, animal, identity of the record) are rejected; every changed field is stored in `history[]` as `{field, from, to}` with
  who/when/why; `revision` is incremented. `null` clears an optional field. No-op corrections → `409 NO_CHANGE`.
- **Void** (`POST …/:id/void {reason}`): sets `voided*`, keeps the record in all histories (flagged), and blocks any further change (`409 RECORD_VOIDED`).
- **Attachments**: https links only, host allow-list shared with animal media (`MEDIA_ALLOWED_HOSTS`), max count per record; removal needs a reason and is
  kept in the history.
- **Traceability**: `createdBy`, `updatedBy`, `revision`, `history[]` on every record; status events on breeding records are history entries too.
- **Isolation**: every lookup is `{ _id, farmId }` after the farm permission check. Non-members get `404`, members lacking a permission `403 FARM_FORBIDDEN`,
  archived farms `409 FARM_ARCHIVED`, archived animals `409 ANIMAL_ARCHIVED`.

## Permissions (defined once in `shared-types/farms.ts`)

| Permission                           | owner | manager | worker | viewer |
| ------------------------------------ | :---: | :-----: | :----: | :----: |
| `records.read`                       |   ✔   |    ✔    |   ✔    |   ✔    |
| `records.write` (create, attach)     |   ✔   |    ✔    |   ✔    |        |
| `records.correct` (correct, void)    |   ✔   |    ✔    |        |        |
| `breeding.read`                      |   ✔   |    ✔    |   ✔    |   ✔    |
| `breeding.write` (create, events)    |   ✔   |    ✔    |   ✔    |        |
| `breeding.correct` (correct, void)   |   ✔   |    ✔    |        |        |
| `expenses.read` / `expenses.write`\* |   ✔   |    ✔    |        |        |

\* Expenses are financial data: they are only reachable with `expenses.*` (also by id, and in the animal history timeline). Platform `farms.read` staff get `records.read`.
Existing databases: role→permission mappings are code, no migration. `animal_types.manage` (Part 07) must be granted by an admin to configure species values.

## Domain rules

- **Health** — types: illness, treatment, vaccination, recovery, checkup. _Provenance is explicit_: a `condition` requires `conditionStatedBy`
  (owner / vet / worker…), medication requires `prescribedBy`; vaccination needs a vaccine name; `outcome` is only valid on a recovery. The platform
  never diagnoses, suggests a condition, medicine or dose; the UI shows a standing notice. No medication catalogue is shipped.
- **Weights** — kg, plausible range, plus the species maximum only if an admin configured `maxWeightKg`. Growth = plain arithmetic (change, days, kg/day).
- **Feeding** — `log` (what was fed, when) or `schedule` (recurring times); quantity + unit; for one animal, a group label or the whole farm.
- **Expenses** — money is stored as **integer satang** (`amountMinor`), max 2 decimals on input, never floats; summary sums integers.
- **Breeding** — dam must be female, sire male and of the same type (or an external sire noted as free text); ages checked only if
  `minBreedingAgeDays` is configured; parent/child pairing blocked, sibling pairing is a warning; one open pregnancy per dam; overlapping breedings blocked.
  Status flow `bred → pregnant → delivered` or `failed`. Expected delivery uses `gestationDays` only when configured for the species — otherwise none is invented.
- **Offspring** do not duplicate identities: delivery either _registers_ a new animal (born on farm, parents set), _links_ an existing animal (only its
  parents are set; conflicts → `409 PARENT_CONFLICT`/`ALREADY_OFFSPRING`), or notes a stillbirth/death without an identity. A unique partial index on
  `delivery.offspring.animalId` (non-voided) prevents one animal being the offspring of two breedings. Voiding a breeding unlinks its offspring.
- MongoDB transactions are not assumed (standalone dev DB): delivery is claimed with an atomic compare-and-set and rolled back on failure.
- Breeding has its own `breeding.*` permissions (same holders as `records.*` by default); the animal timeline omits breeding
  entries for members without `breeding.read`.
- **Record code** `BR-00001…` from an atomic per-farm counter (`farms.breedingSeq`), unique per farm (older records have none).
- **Egg-laying species** (`animal_types.reproduction = egg`): `clutch {eggsLaid, eggsFertile, eggsSet, chicksHatched}` (each optional;
  fertile ≤ laid, set ≤ laid, hatched ≤ set) set on create, on delivery, or as an event `POST …/breeding/:id/clutch` (history entry).
  The "pregnancy" step means incubation and "delivery" means hatching; up to 50 offspring per request. Registered chicks inherit the
  rearing type when both recorded parents share it.
- **Parents' breeds and suggestion**: every record shows `sireBreed`/`damBreed` (read live from the animals) and
  `offspringBreedSuggestion` (`@farmplus/shared-utils` `suggestOffspringBreed`, shared with the web form): same breed → that breed;
  union of the parents' components equals an active breed's composition → that breed (พม่าม้าล่อ × เหลืองหางขาว → "พม่า + ไทย",
  F1 × พม่า → "พม่า + ไทย", × ไซ่ง่อน → "พม่า + ไซ่ง่อน + ไทย"); one group → that group; otherwise none; a missing parent/breed →
  `parent_unknown`. It only pre-fills the form: lineage is always the real sire/dam.
- `GET …/breeding?animalId=` lists the records where an animal is dam or sire.
- **Photos from the device**: `POST …/breeding/:id/photos` (body = the image, `breeding.write`, upload rate limit) goes through the
  same checks and storage as animal photos (`storeDevicePhoto`: JPEG/PNG/WebP sniffed, ≤ 3 MB, database or R2, served by
  `/animal-photos/:key`; the `animal_photos` document is filed under the dam with `breedingRecordId`) and becomes a `photo`
  attachment with its history entry. Removing an attachment (reason required) also deletes an uploaded photo's file.

## Growth tracking against admin-set criteria

- **Measurements** live in `weight_records`: `weightKg` (required) plus optional `heightCm`, `lengthCm` and a free-text `bodyCondition`
  (as observed; never scored). All are correctable with a reason like any record field.
- **Criteria** live in `animal_growth_standards` (managed at `/admin/growth-standards`, API `/api/v1/growth-standards`, permission
  `animal_types.manage`): per animal type, optional breed, sex (`male`/`female`/`any`), kind `weight_for_age` (age range in days, from inclusive …
  to exclusive, with min/max weight/height/length) or `breeding_age` / `sale_age` (age window only). **No values are shipped.**
  Every criterion names its source: `reference` (citation required) or `system_recommendation` (shown to farmers as "system recommendation, not an
  academic standard"). Active ranges of the same type/breed/sex/kind may not overlap (`409 OVERLAPPING_STANDARD`); criteria are never deleted, only
  deactivated; edits are merged and re-validated as a whole; every change is audited (`growth_standard.*`).
- **Evaluation** (`modules/growth-standards/evaluate.ts`, pure): the most specific active criterion wins (breed+sex > breed > sex > general).
  No birth date → `no_age` (nothing judged, no age invented); no criterion → `no_standard`; an estimated birth date → `ageEstimated: true` on every
  comparison and alert.
- `GET /farms/:farmId/animals/:animalId/growth` returns, per measurement, `ageDays` and `evaluation` (below / within / above per metric), plus the
  applicable criteria (chart bands), breeding/sale window status and `alerts` for the latest measurement. The farm summary counts on-farm animals
  whose latest measurement is outside (`outsideStandard`). Web: growth page with chart by age, criterion band, status column and alerts.

## Species configuration is data

`animal_types` gained optional `gestationDays`, `minBreedingAgeDays`, `maxWeightKg`. **No species values are shipped**; unset means “no check”.

## Complete per-animal history

`GET /farms/:farmId/animals/:animalId/history` merges animal audit events (registration, edits, status, archive), breeding (as dam/sire/offspring), health,
feeding, weights and (with `expenses.read`) expenses, newest first, voided entries flagged, actors named. `/growth` and `/lineage` are sibling endpoints.
`/lineage?generations=1–5` (default 3) also returns the pedigree tree (recorded parents of the same farm, recursively), `generation` (how many
ancestor generations are recorded, walked up to 25 levels) and siblings (`full` / `half_sire` / `half_dam`). Every animal in it (tree,
siblings, offspring) carries `filialGeneration`: 0 = parent stock (no parents recorded), otherwise max(sire, dam) + 1 (F1, F2, …);
`null` when only one parent or an ancestor's generation is unknown — never guessed. Tree nodes also carry breed name and group.

## Known limitations

- Web UI only; mobile screens are deferred. Species configuration UI: `/admin/animal-types` (types, breeds, gestation / breeding age / max weight).
- Attachments are links (no upload storage yet). No notifications/reminders for schedules or expected delivery.
- Correction history is per record; there is no cross-record “undo”.
