/**
 * Database operations, as ONE reviewed entry point (run from the repository: `pnpm --filter @farmplus/api db <command>`,
 * or from a release image: `node dist/scripts/db.js <command>`):
 *
 *   indexes [--apply]                 compare declared vs actual indexes; --apply creates the missing ones (never drops)
 *   migrate [--apply]                 show / apply pending data migrations
 *   backup <dir>                      logical backup (set BACKUP_ENCRYPTION_KEY to encrypt)
 *   verify-backup <dir>               check every file against the manifest
 *   restore <dir> --confirm-db <name> restore into an EMPTY database (never overwrites)
 *
 * Mutating commands (`--apply`, `restore`) require `--confirm-db <name>` equal to the database named in MONGODB_URI, so a
 * command cannot hit the wrong environment because of a stale shell variable. Nothing here drops, deletes or overwrites.
 */
import { EnvValidationError, loadDbOpsEnv } from '@farmplus/config/server';
import mongoose from 'mongoose';
import '../models';
import { checkIndexes } from '../ops/indexes';
import { createBackup, restoreBackup, verifyBackup } from '../ops/backup';
import { planMigrations, runMigrations } from '../ops/migrations';
import { SERVICE_VERSION } from '../service-info';

const out = (value: unknown) => process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
const fail = (message: string): never => {
  process.stderr.write(`${message}\n`);
  process.exit(1);
};

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

export function assertConfirmed(
  actualDb: string,
  confirmed: string | undefined,
  what: string,
): void {
  if (confirmed !== actualDb)
    fail(
      `${what} needs --confirm-db ${actualDb} (the database named in MONGODB_URI). Refusing to continue.`,
    );
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  let env;
  try {
    env = loadDbOpsEnv();
  } catch (error) {
    if (error instanceof EnvValidationError) fail(error.message);
    throw error;
  }
  // Index building is the explicit job of `indexes --apply`; connecting must never trigger it implicitly.
  mongoose.set('autoIndex', false);
  mongoose.set('autoCreate', false); // a maintenance command must not create collections as a side effect
  await mongoose.connect(env.MONGODB_URI, { serverSelectionTimeoutMS: 10_000 });
  const db = mongoose.connection.db!;
  const apply = args.includes('--apply');
  const confirmed = flag(args, '--confirm-db');

  try {
    switch (command) {
      case 'indexes': {
        if (apply) assertConfirmed(db.databaseName, confirmed, 'indexes --apply');
        const report = await checkIndexes({ apply });
        out({ database: db.databaseName, apply, ...report });
        if (report.conflicts.length > 0)
          fail(
            'Some indexes could not be created (conflicts). Plan a migration; nothing was dropped.',
          );
        if (!apply && report.missing.length > 0 && args.includes('--check'))
          fail('Indexes are missing. Run `db indexes --apply` as part of the release.');
        break;
      }
      case 'migrate': {
        if (apply) assertConfirmed(db.databaseName, confirmed, 'migrate --apply');
        const plan = await planMigrations(db);
        if (plan.unknown.length > 0)
          process.stderr.write(
            `warning: database has migrations this build does not know (${plan.unknown.join(', ')}): the database is ahead of the code\n`,
          );
        if (!apply) {
          out({ database: db.databaseName, apply: false, ...plan });
          if (plan.tampered.length > 0) fail('An applied migration was modified. Do not continue.');
          break;
        }
        out({
          database: db.databaseName,
          apply: true,
          ...(await runMigrations(db, {
            log: (m) => process.stderr.write(`${m}\n`),
            appVersion: SERVICE_VERSION,
          })),
        });
        break;
      }
      case 'backup': {
        const dir = args[0] ?? fail('usage: backup <dir>');
        const manifest = await createBackup(db, dir, {
          encryptionKey: env.BACKUP_ENCRYPTION_KEY,
          appVersion: SERVICE_VERSION,
        });
        out({
          dir,
          database: manifest.database,
          encrypted: manifest.encrypted,
          collections: manifest.collections.map((c) => ({ name: c.name, count: c.count })),
        });
        break;
      }
      case 'verify-backup': {
        const dir = args[0] ?? fail('usage: verify-backup <dir>');
        const result = await verifyBackup(dir, { encryptionKey: env.BACKUP_ENCRYPTION_KEY });
        out(result);
        if (!result.ok) process.exit(1);
        break;
      }
      case 'restore': {
        const dir = args[0] ?? fail('usage: restore <dir> --confirm-db <name>');
        assertConfirmed(db.databaseName, confirmed, 'restore');
        out({
          database: db.databaseName,
          ...(await restoreBackup(db, dir, { encryptionKey: env.BACKUP_ENCRYPTION_KEY })),
        });
        break;
      }
      default:
        fail('usage: db <indexes|migrate|backup|verify-backup|restore> [options]');
    }
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((error: unknown) =>
  fail(`db command failed: ${error instanceof Error ? error.message : String(error)}`),
);
