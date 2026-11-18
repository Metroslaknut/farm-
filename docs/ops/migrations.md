# Database migrations and index management

## Two kinds of change

|             | Index changes                            | Data migrations                                                                                   |
| ----------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------- |
| What        | Indexes declared in the Mongoose schemas | Changes to existing documents, or to indexes that cannot be expressed as "create what is missing" |
| Where       | the models (`src/models/*.model.ts`)     | `src/db/migrations/index.ts` (the `MIGRATIONS` list)                                              |
| Applied by  | `db indexes --apply` (release step)      | `db migrate --apply` (release step)                                                               |
| Recorded in | – (the database _is_ the record)         | `schema_migrations` collection (id, checksum, time, duration, app version)                        |

## Index management

- **Production never builds indexes at startup.** `connectDb(uri, { syncIndexes: false })` (and `autoIndex` off) when `NODE_ENV=production`; development and tests still use `syncIndexes()` for convenience. Reason: `syncIndexes()` **drops** indexes that are not declared and rebuilds work on every instance start.
- **`db indexes`** (dry run) compares declared and actual indexes for every model in `src/db/registry.ts` and reports `missing`, `extra` and `conflicts` — it changes nothing. `--check` exits non-zero if anything is missing (use it in CI/staging gates).
- **`db indexes --apply --confirm-db <name>`** creates only what is **missing**. It never drops. Extra indexes are reported, not removed (they may be hand-made, or needed by the previous release you might roll back to). A same-name/different-definition **conflict** is reported and left alone; changing an index definition is a migration.
- A test (`test/registry.test.ts`) fails if a model is missing from the registry, so index management and backups cannot silently skip a collection. (Part 17's collections were missing from the old startup list; this closes that gap.)
- Index builds on large collections load the cluster: apply in a quiet period; Atlas builds on replica sets with minimal blocking. Add unique indexes only after checking for duplicates (`aggregate` with `$group`/`$match count>1`) in a migration's pre-check.

### Changing an existing index (expand → migrate → contract)

1. **Release N**: declare the _new_ index (different name) in the model → `db indexes --apply` creates it alongside the old one. Code works with both.
2. **Release N+1** (after N is stable and no rollback to <N is planned): a reviewed migration drops the old index (idempotent: `if exists`), and the model no longer declares it.

## Data migrations

Rules (also in the file header of `src/db/migrations/index.ts`):

1. **Forward only and idempotent** — running `up` twice must be harmless; check before changing.
2. **A release must work before _and_ after its migration runs** (expand → migrate → contract). That is what makes an application rollback safe: the previous release still reads the migrated data. Destructive "contract" steps (removing fields, dropping indexes) ship one release later.
3. **Never edit an applied migration.** Its checksum is recorded; a mismatch blocks every run. Add a new migration.
4. **Batch large collections** (`_id` ranges, `bulkWrite`), never load a collection into memory; log progress with `context.log`.
5. **Concurrency**: runs hold a lock (`schema_migrations_lock`, 30-minute expiry); a second run refuses, a crashed run's stale lock is cleared.
6. **A failed migration stops the run** and records nothing for itself, so after fixing the cause a re-run continues (idempotency makes this safe).
7. **No destructive command without an approved plan.** The plan = the migration code + the `db migrate` dry-run output + the rollback/restore statement + a named approver. Production needs the plan attached to the release.

### Writing one

```ts
// src/db/migrations/index.ts
{
  id: '0002-order-add-currency',
  description: 'Backfill orders.currency = "THB" where missing.',
  async up({ db, log }) {
    const res = await db.collection('orders').updateMany({ currency: { $exists: false } }, { $set: { currency: 'THB' } });
    log(`updated ${res.modifiedCount} orders`);
  },
},
```

Test it against a restored copy of production data in staging (never against production first), and add a unit test for non-trivial transformations (see `test/db-ops.test.ts` for the runner behaviour).

### Commands

```bash
pnpm --filter @farmplus/api db indexes                     # dry run
pnpm --filter @farmplus/api db migrate                     # dry run: applied / pending / tampered / unknown
pnpm --filter @farmplus/api db indexes --apply --confirm-db farmplus
pnpm --filter @farmplus/api db migrate --apply --confirm-db farmplus
# from a release artifact:  node dist/scripts/db.js <command>
```

`--confirm-db` must equal the database named in `MONGODB_URI`, so a stale shell variable cannot point a command at the wrong environment. The tool prints JSON and never prints the connection string. In production the URI rules (TLS, credentials, not localhost) apply to these jobs too.

`migrate` warns when the database contains migrations this build does not know (`unknown`): the database is **ahead of the code**, which is expected after a rollback and is why migrations must be backward compatible.

## Atlas notes

- Use the dedicated `farmplus_migrate` user; keep `farmplus_app` unable to create/drop indexes.
- Take an on-demand snapshot before any release that contains a migration.
- Never run ad-hoc `deleteMany`/`drop`/`updateMany` against production from a shell. If an emergency data fix is unavoidable, treat it as a migration: written, reviewed, dry-run, approved, recorded in the incident log.
