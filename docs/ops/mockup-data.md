# Mockup (test) data

`pnpm seed:mockup` fills a **development** database with realistic, fictitious data for trying the shop, farm,
animal and marketplace features: 10 shops with 10–15 products each, and 10 farms with 20 animals each (200 in total),
with growth and health history, parent links and live sale listings. Code: `services/api/src/scripts/seed-mockup.ts`
and `services/api/src/scripts/mockup/`.

## Commands

```bash
# .env (root): MONGODB_URI=… and SEED_MOCKUP_PASSWORD=<min 12 chars>
pnpm seed:mockup -- --confirm-db <database>            # seed (safe to repeat), then verify
pnpm seed:mockup -- --verify                           # read-only: counts, links, duplicates
pnpm seed:mockup -- --clean --confirm-db <database>    # delete ONLY the mockup data
pnpm --filter @farmplus/api seed:mockup:images         # developer tool: refresh the image manifest
```

`--confirm-db` must equal the database named in `MONGODB_URI`, so a stale shell variable cannot write to the wrong
database. Nothing runs with `NODE_ENV=production`. Connection strings are never printed.

## Accounts

| E-mail                                                  | Roles                     | Owns                    |
| ------------------------------------------------------- | ------------------------- | ----------------------- |
| `s01@mockup.farmplus.test` … `s10@mockup.farmplus.test` | seller, buyer             | one shop each (S01–S10) |
| `f01@mockup.farmplus.test` … `f10@mockup.farmplus.test` | farm_owner, seller, buyer | one livestock farm each |

All of them sign in with `SEED_MOCKUP_PASSWORD`. That password is set when a user is created, so changing it later
does not change existing accounts. Roles are granted directly, the way an approved registration would grant them.
`.test` addresses can never receive mail.

## How mockup data is recognised

**The marker is the user e-mail domain `@mockup.farmplus.test`.** Everything else is found from those users:

- farms and shops by `farms.createdBy`
- products, inventory, animals, records and listings by their `farmId`

The seed adds no extra fields or collections. Descriptions and notes also say `ข้อมูลทดสอบ (Mockup)`, so people can
see in the UI that the data is fictitious.

## What is written

| Collection                 | Content                                                                                                                         |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `users`, `user_roles`      | 20 owners (above)                                                                                                               |
| `farms`, `farm_members`    | 10 shops + 10 farms (real province/district and coordinates, invented street addresses and phone numbers), owner membership     |
| `products`                 | SKU `MOCK-Sxx-nnn`, a mix per shop: on sale, on promotion, out of stock, paused, waiting for review, regulated draft            |
| `inventory_movements`      | the `initial` (opening stock) movement of each product with stock                                                               |
| `animals`                  | code `<TYPE>-nnn` per farm, breed key from the catalogue, birth date, sex, colour, photo, origin, `sireId`/`damId` for families |
| `weight_records`           | 2–4 points of growth history per animal, computed from each breed's growth curve                                                |
| `health_records`           | one routine `checkup` per animal (no medicines, doses or diagnoses)                                                             |
| `listings`                 | 3 `ACTIVE` listings per farm (the animal is `for_sale`)                                                                         |
| `animal_types` (catalogue) | adds the missing types `fish`, `dog`, `cat`, `sheep` and `other`, and missing breeds of existing types; nothing is renamed      |

Product groups use the existing categories. Pet equipment and farm tools go in `equipment`, feed in `feed`, and
vitamins and minerals in `supplements`. Antiparasitics and disinfectants go in `medicines` as **DRAFT** with an
invented `MOCK-REG-…` number. That category stays closed until a compliance review is recorded, so these products are
never shown to buyers. Every product passes the platform's prohibited-term and claim checks (tested).

## Re-running

Every document has a natural key: user e-mail, owner + farm name, farm + SKU, or farm + animal code. Each one is
written with `$setOnInsert`, so a second run inserts only what is missing and **never changes existing documents**.
That includes changes you made while testing. Growth, health, listing and parent-link data is added only to animals
that have none yet.

## Mockup data in a real user's farm

To try the screens with a real account, `--owner` fills that user's existing farm with one shop's products and one
farm's animals (default: S03's 12 products and F03's 20 buffalo and cattle, with growth/health records, 3 live
listings and parent links). The user, the farm and their roles are **not** changed, so selling may still need the
seller role.

```bash
pnpm seed:mockup -- --owner <email> [--farm-id <id>] [--shop S03] [--farm F03] --confirm-db <database>
pnpm seed:mockup -- --owner <email> [--farm-id <id>] --clean --confirm-db <database>
```

Inside that farm the marker is the SKU prefix `MOCK-U` and animal notes equal to `ข้อมูลทดสอบ (Mockup) — ไม่ใช่ข้อมูลจริง`.
The normal `--clean` does **not** see this data; only `--owner … --clean` removes it, and it refuses if orders, offers,
reviews, breeding records or real animals' parent links use it. Because the farm's real registration date is used,
animals born before it are recorded as purchased, and a farm registered recently has short growth histories.

## Removing it

`--clean` deletes the mockup users, their farms and everything that belongs to those farms or users (animals,
records, listings, products, inventory, memberships, sessions, carts, notifications). It **refuses and deletes
nothing** if orders, offers, chats, posts, comments or product reviews involve mockup data, because those are other
people's records. Settle or remove them first. Animal types and breeds the seed added stay in the catalogue. Audit
logs are kept.

## Images

Product and animal photos are Wikimedia Commons thumbnails listed in `mockup/images.ts`. Each one was downloaded and
checked when the manifest was built. Each entry links to its Commons page, which gives the author and licence;
attribute them if the images are shown outside development. A key with no checked image falls back to a labelled
`placehold.co` image. Avatars are `placehold.co` initials. Farms have no profile or cover image fields, so none are
seeded.
