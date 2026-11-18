# Backup and restore

Backups hold personal data (PDPA), financial records, hashed credentials and encrypted MFA secrets. Treat every backup as production data: encrypted, access-controlled, retained deliberately, and never restored into an environment with weaker controls.

## Strategy (two layers)

1. **Primary — Atlas Cloud Backup with continuous backup / point-in-time recovery (PITR)** (M10+ cluster). Recommended starting points (adjust to the business's tolerance and cost): snapshots every 6 h retained 7 days, daily 30 days, weekly 12 weeks, monthly 12 months; PITR window 7 days. Snapshots are stored by Atlas in a different failure domain than the cluster; enable a copy to a second region for regional-outage recovery. Restrict who can download or restore snapshots (Atlas project roles; MFA).
2. **Secondary — logical backup with the `db` tool** (`services/api/src/ops/backup.ts`): portable, verifiable, independent of Atlas. Use it **before a risky migration**, for provider-independent archives, and for restore drills. It is not a replacement for PITR (it is a point-in-time dump, not continuous).

Targets (recommendations, **not measured**): RPO ≤ 5 minutes with PITR (≤ 24 h with logical backups only); RTO ≤ 4 hours for a full restore at current data volumes. Measure the real figures in the first drill and record them below.

## The logical backup tool

```bash
# environment: MONGODB_URI (the read-only backup user), optional BACKUP_ENCRYPTION_KEY
pnpm --filter @farmplus/api db backup  /secure/backups/2026-06-15T0200      # or: node dist/scripts/db.js backup <dir>
pnpm --filter @farmplus/api db verify-backup /secure/backups/2026-06-15T0200
```

- One NDJSON file per collection in canonical Extended JSON (ObjectIds, dates, decimals and binary survive), the index definitions, and `manifest.json` with per-file SHA-256 and document counts. Collections are exported in `_id` order, so hashes are stable.
- Files are written `0600` in a `0700` directory; the command **refuses a non-empty directory**.
- With `BACKUP_ENCRYPTION_KEY` (32 bytes base64) every file is AES-256-GCM encrypted (`*.ndjson.enc`); a wrong key or any flipped bit fails verification. Keep the key in the secret manager, **separate from the backup storage**. Losing the key means losing the backup.
- Upload the directory to encrypted, versioned, access-logged object storage with a retention rule; do not leave copies on laptops or CI runners.
- The tool never writes to the source database (`autoCreate`/`autoIndex` are off).

## Restore procedures

**Principle: restore into a NEW, empty database/cluster, verify it, then switch the application over (change `MONGODB_URI`) — never restore over live data.**

### A. Atlas snapshot or point in time (preferred)

1. Declare the incident ([rollback-incident.md](rollback-incident.md)); stop writes if corruption is ongoing (scale the API to zero or set maintenance mode at the load balancer).
2. In Atlas: **Restore** → choose the snapshot or a PITR timestamp just before the damage → restore to a **new cluster** (or a new database via the download/automated restore path).
3. Validate on the new cluster (checklist below) with a read-only user.
4. Point the API's `MONGODB_URI` secret at the new cluster, redeploy, run the verification script.
5. Keep the damaged cluster (network-isolated) until the post-incident review ends, then delete it.

### B. Logical backup

```bash
# 1. empty target database on the target cluster (new database name or a new cluster)
export MONGODB_URI='mongodb+srv://…/farmplus_restored'            # restore user, target database only
export BACKUP_ENCRYPTION_KEY=…                                    # if the backup is encrypted
node dist/scripts/db.js verify-backup /secure/backups/2026-06-15T0200
node dist/scripts/db.js restore /secure/backups/2026-06-15T0200 --confirm-db farmplus_restored
node dist/scripts/db.js indexes --check                           # nothing missing
node dist/scripts/db.js migrate                                   # pending vs applied (database must not be ahead of the code)
```

Guarantees enforced by the tool: the backup is verified first (any checksum/authentication failure aborts before a single write); the target must be **empty** in every collection that the backup contains (otherwise it stops and changes nothing); `--confirm-db` must equal the database in the URI; nothing is dropped or overwritten; after inserting it re-reads and re-hashes every collection and fails if anything differs; indexes (including unique and partial ones) are recreated after the data.

### Validation checklist (after any restore)

- [ ] `db verify-backup` / Atlas restore completed without errors; collection counts match the manifest (`restore` prints them).
- [ ] `db indexes` shows no missing indexes and no conflicts.
- [ ] Start a **staging** API against the restored database: `/ready` is 200, an existing user can sign in, an order, a wallet balance and the audit log chain (`verifyAuditChain`) look right.
- [ ] Finance reconciliation: ledger totals equal wallet balances (admin finance → reconciliation) — the ledger is append-only, so a mismatch means the restore is incomplete.
- [ ] Data-protection: the restored copy has the same access restrictions as production, and is deleted when the drill ends.

## Restore drill

Run quarterly and after any change to the backup tooling. **Automated version (runs in CI)**: `services/api/test/db-ops.test.ts` seeds a real MongoDB, backs it up (plain and encrypted), restores into a new database and compares every collection document-for-document (types, dates, decimals, binary, Thai text), the index sets, the unique/partial index definitions, refusal to restore over data, tamper/truncation detection, wrong-key failure, 5,000-document streaming, and the CLI end to end. **Manual version** (needs Atlas): restore the latest snapshot to a scratch cluster, run the checklist, record the times.

| Date                                                | Method | Data size | Time to restore | Result | Who |
| --------------------------------------------------- | ------ | --------- | --------------- | ------ | --- |
| _(first drill pending — requires an Atlas project)_ |        |           |                 |        |     |

## Scenarios

| Scenario                                       | Response                                                                                                                                                                               |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Accidental deletion / bad deploy corrupts data | PITR to just before the event → new cluster → validate → switch (A)                                                                                                                    |
| A migration misbehaves                         | Stop; do not "fix forward" blindly. Restore the pre-migration snapshot to a new cluster if data was damaged; otherwise ship a corrective migration (migrations.md)                     |
| Region/cluster outage                          | Atlas failover first; if the whole region is lost, restore the cross-region snapshot copy (A)                                                                                          |
| Credential compromise / ransomware             | Rotate database users and secrets first, isolate, restore from a snapshot older than the intrusion into a **new** cluster with new credentials; preserve the old cluster for forensics |
| Need a copy for analysis                       | Anonymise first; never copy production to staging or laptops                                                                                                                           |
