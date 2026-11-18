/**
 * Mockup (test) data for development databases (run from the repository):
 *
 *   pnpm --filter @farmplus/api seed:mockup -- --confirm-db <name>          seed (idempotent), then verify
 *   pnpm --filter @farmplus/api seed:mockup -- --verify                     read-only checks and counts
 *   pnpm --filter @farmplus/api seed:mockup -- --clean --confirm-db <name>  delete ONLY the mockup data
 *
 * For a real user's existing farm (their account, farm and roles are not changed):
 *
 *   ... seed:mockup -- --owner <email> [--farm-id <id>] [--shop S03] [--farm F03] --confirm-db <name>
 *   ... seed:mockup -- --owner <email> [--farm-id <id>] --clean --confirm-db <name>
 *
 * Needs MONGODB_URI and, for seeding, SEED_MOCKUP_PASSWORD (min 12 chars: the login password of every mockup user,
 * read from the environment so it stays out of shell history). Writing commands need `--confirm-db` equal to the
 * database named in MONGODB_URI, and nothing runs with NODE_ENV=production. See docs/ops/mockup-data.md.
 */
import { EnvValidationError, loadDbOpsEnv } from '@farmplus/config/server';
import mongoose from 'mongoose';
import '../models';
import { MOCKUP_EMAIL_DOMAIN } from './mockup/catalog';
import {
  cleanMockup,
  cleanMockupForUser,
  seedMockup,
  seedMockupForUser,
  verifyMockup,
} from './mockup/seed';

const fail = (message: string): never => {
  process.stderr.write(`${message}\n`);
  process.exit(1);
};

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let env;
  try {
    env = loadDbOpsEnv();
  } catch (error) {
    if (error instanceof EnvValidationError) fail(error.message);
    throw error;
  }
  if (env.NODE_ENV === 'production')
    fail('Mockup data is for development databases only (NODE_ENV=production).');
  const mode = args.includes('--clean') ? 'clean' : args.includes('--verify') ? 'verify' : 'seed';
  const owner = flag(args, '--owner');
  if (owner !== undefined && mode === 'verify') fail('--owner works with seeding or --clean only.');
  const password = process.env['SEED_MOCKUP_PASSWORD'];
  if (!owner && mode === 'seed' && (!password || password.length < 12))
    fail(
      'SEED_MOCKUP_PASSWORD (min 12 chars) is required: it becomes the login password of every mockup user.',
    );

  // Index building is the job of `db indexes --apply`; this script must not trigger it on a shared cluster.
  mongoose.set('autoIndex', false);
  mongoose.set('strictQuery', true);
  await mongoose.connect(env.MONGODB_URI, { serverSelectionTimeoutMS: 10_000 });
  const db = mongoose.connection.db!;
  const host = mongoose.connection.host;
  console.log(`Connected to database "${db.databaseName}" on ${host}`);

  try {
    if (mode !== 'verify' && flag(args, '--confirm-db') !== db.databaseName)
      fail(
        `${mode} needs --confirm-db ${db.databaseName} (the database named in MONGODB_URI). Nothing was changed.`,
      );

    if (owner) {
      const farmId = flag(args, '--farm-id');
      if (mode === 'clean') {
        const { deleted } = await cleanMockupForUser(owner, farmId);
        console.log(`Deleted the mockup products and animals in the farm of ${owner}:`);
        console.table(deleted);
        return;
      }
      const report = await seedMockupForUser({
        email: owner,
        farmId,
        shopCode: flag(args, '--shop'),
        farmCode: flag(args, '--farm'),
      });
      console.log(`Seeded mockup products and animals into "${report.farmName}" of ${owner}:`);
      console.table(
        [...new Set([...Object.keys(report.created), ...Object.keys(report.existing)])].map(
          (k) => ({
            collection: k,
            inserted: report.created[k] ?? 0,
            alreadyPresent: report.existing[k] ?? 0,
          }),
        ),
      );
      for (const w of report.warnings) console.warn(`warning: ${w}`);
      return;
    }
    if (mode === 'clean') {
      const { deleted } = await cleanMockup();
      console.log(`Deleted mockup data (users @${MOCKUP_EMAIL_DOMAIN} and their farms):`);
      console.table(deleted);
      return;
    }
    if (mode === 'seed') {
      const started = Date.now();
      const report = await seedMockup({ password: password! });
      console.log(`Seed finished in ${((Date.now() - started) / 1000).toFixed(1)}s`);
      console.table(
        [...new Set([...Object.keys(report.created), ...Object.keys(report.existing)])].map(
          (k) => ({
            collection: k,
            inserted: report.created[k] ?? 0,
            alreadyPresent: report.existing[k] ?? 0,
          }),
        ),
      );
      if (report.animalTypesCreated.length)
        console.log(`Animal types added: ${report.animalTypesCreated.join(', ')}`);
      if (report.breedsAdded.length) console.log(`Breeds added: ${report.breedsAdded.join(', ')}`);
      for (const w of report.warnings) console.warn(`warning: ${w}`);
    }

    const verify = await verifyMockup();
    console.log('Verification:');
    console.table(verify.counts);
    console.log(
      `Products per shop: ${verify.productsPerShop.min}–${verify.productsPerShop.max} · animals per farm: ${verify.animalsPerFarm.min}–${verify.animalsPerFarm.max}`,
    );
    if (verify.problems.length) {
      for (const p of verify.problems) console.error(`problem: ${p}`);
      process.exitCode = 1;
    } else console.log('No problems found.');
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((error: unknown) => {
  // Driver errors can echo the connection string: never print credentials.
  const message = error instanceof Error ? error.message : String(error);
  console.error(message.replace(/(mongodb(\+srv)?:\/\/)[^@\s]+@/g, '$1***@'));
  process.exit(1);
});
