import { createHash } from 'node:crypto';
import type mongoose from 'mongoose';

type Db = mongoose.mongo.Db;
import { MIGRATIONS, type Migration } from '../db/migrations';

const COLLECTION = 'schema_migrations';
const LOCK = 'schema_migrations_lock';
const LOCK_MINUTES = 30;

export const checksumOf = (m: Migration): string =>
  createHash('sha256').update(`${m.id}\n${m.description}\n${m.up.toString()}`).digest('hex');

export interface MigrationPlan {
  applied: { id: string; appliedAt: Date }[];
  pending: { id: string; description: string }[];
  /** Applied earlier, but the code for it changed: never run anything until a person looks at this. */
  tampered: string[];
  /** Applied in the database but unknown to this build: the database is AHEAD of the code (e.g. after a rollback). */
  unknown: string[];
}

export async function planMigrations(
  db: Db,
  migrations: Migration[] = MIGRATIONS,
): Promise<MigrationPlan> {
  const rows = await db
    .collection<{ _id: string; checksum: string; appliedAt: Date }>(COLLECTION)
    .find()
    .sort({ _id: 1 })
    .toArray();
  const known = new Map(migrations.map((m) => [m.id, m]));
  const done = new Set(rows.map((r) => r._id));
  return {
    applied: rows.map((r) => ({ id: r._id, appliedAt: r.appliedAt })),
    pending: migrations
      .filter((m) => !done.has(m.id))
      .map((m) => ({ id: m.id, description: m.description })),
    tampered: rows
      .filter(
        (r) => known.has(r._id) && known.get(r._id) && checksumOf(known.get(r._id)!) !== r.checksum,
      )
      .map((r) => r._id),
    unknown: rows.filter((r) => !known.has(r._id)).map((r) => r._id),
  };
}

export interface MigrationResult extends MigrationPlan {
  ran: { id: string; durationMs: number }[];
}

/**
 * Apply pending migrations in order. Refuses to run if an applied migration was edited, or if a concurrent run holds
 * the lock. Stops at the first failure (nothing is recorded for the failed one, so fixing and re-running is safe
 * because every migration is idempotent).
 */
export async function runMigrations(
  db: Db,
  options: { migrations?: Migration[]; log?: (m: string) => void; appVersion?: string } = {},
): Promise<MigrationResult> {
  const migrations = [...(options.migrations ?? MIGRATIONS)].sort((a, b) =>
    a.id.localeCompare(b.id),
  );
  const log = options.log ?? (() => undefined);
  const plan = await planMigrations(db, migrations);
  if (plan.tampered.length > 0)
    throw new Error(
      `Applied migration(s) were modified after they ran: ${plan.tampered.join(', ')}. Add a new migration instead.`,
    );
  const result: MigrationResult = { ...plan, ran: [] };
  if (plan.pending.length === 0) return result;

  const locks = db.collection<{ _id: string; expiresAt: Date }>(LOCK);
  const now = new Date();
  await locks.deleteOne({ _id: 'lock', expiresAt: { $lt: now } }); // a crashed run's stale lock
  try {
    await locks.insertOne({
      _id: 'lock',
      expiresAt: new Date(now.getTime() + LOCK_MINUTES * 60_000),
    });
  } catch {
    throw new Error(
      'Another migration run holds the lock (or crashed within the last 30 minutes).',
    );
  }
  try {
    for (const m of migrations) {
      if (!plan.pending.some((p) => p.id === m.id)) continue;
      const started = Date.now();
      log(`applying ${m.id}: ${m.description}`);
      await m.up({ db, log: (msg) => log(`  ${m.id}: ${msg}`) });
      const durationMs = Date.now() - started;
      await db.collection<{ _id: string }>(COLLECTION).insertOne({
        _id: m.id,
        checksum: checksumOf(m),
        description: m.description,
        appliedAt: new Date(),
        durationMs,
        appVersion: options.appVersion ?? null,
      } as never);
      result.ran.push({ id: m.id, durationMs });
    }
  } finally {
    await locks.deleteOne({ _id: 'lock' });
  }
  return { ...result, ...(await planMigrations(db, migrations)), ran: result.ran };
}
