import type mongoose from 'mongoose';
import { fightingCockCatalogue } from '../../modules/animal-types/fighting-cock-catalogue';

type Db = mongoose.mongo.Db;

/**
 * Data migrations: changes to existing DOCUMENTS or to indexes that cannot be expressed by "create what is missing"
 * (e.g. replacing a unique index with a different one). Rules — see docs/ops/migrations.md:
 *  - **Forward only and idempotent**: running `up` twice must be harmless (check before you change).
 *  - **Expand → migrate → contract**: a release must work both before and after its migration runs, so the previous
 *    release can still serve traffic if you roll the application back. Destructive "contract" steps ship one release later.
 *  - **Never edit an applied migration** (its checksum is recorded; a mismatch blocks the run). Add a new one.
 *  - Large collections: process in batches, never load everything into memory.
 *  - Each migration needs an approved plan before it is applied to production (dry-run output is attached to it).
 */
export interface MigrationContext {
  db: Db;
  log: (message: string) => void;
}
export interface Migration {
  /** `NNNN-short-name`; applied in lexical order. */
  id: string;
  description: string;
  up(context: MigrationContext): Promise<void>;
}

export const MIGRATIONS: Migration[] = [
  {
    id: '0001-baseline',
    description: 'Marks the schema as managed by migrations. Changes nothing.',
    async up({ log }) {
      log('baseline recorded; no data change');
    },
  },
  {
    id: '0002-fighting-cock-catalogue',
    description:
      'Adds the fighting-cock rearing type, 5 breed groups and 39 breeds to the chicken animal type (only entries that ' +
      'are missing; nothing existing is renamed, deactivated or removed), files an already-existing breed with the same ' +
      'key under its catalogue group where it has none, and marks chicken/duck as egg-laying where unset.',
    async up({ db, log }) {
      // Untyped on purpose: the migration must not depend on today's model types.
      const types = db.collection<Record<string, unknown>>('animal_types');
      const catalogue = fightingCockCatalogue();
      const chicken = await types.findOne({ key: 'chicken' });
      if (!chicken) {
        // Very old or hand-built databases: create the type with the catalogue (never touches other types).
        await types.insertOne({
          key: 'chicken',
          name: 'Chicken',
          nameTh: 'ไก่',
          status: 'active',
          reproduction: 'egg',
          isSeeded: true,
          gestationDays: null,
          minBreedingAgeDays: null,
          maxWeightKg: null,
          ...catalogue,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        log('chicken type created with the fighting-cock catalogue');
      } else {
        const has = (list: unknown, key: string) =>
          Array.isArray(list) && list.some((x: { key?: string }) => x?.key === key);
        const rearing = catalogue.rearingTypes.filter((r) => !has(chicken['rearingTypes'], r.key));
        const groups = catalogue.breedGroups.filter((x) => !has(chicken['breedGroups'], x.key));
        const breeds = catalogue.breeds.filter((x) => !has(chicken['breeds'], x.key));
        if (rearing.length + groups.length + breeds.length > 0) {
          const push: Record<string, { $each: unknown[] }> = {
            rearingTypes: { $each: rearing },
            breedGroups: { $each: groups },
            breeds: { $each: breeds },
          };
          await types.updateOne({ _id: chicken._id }, {
            $push: push,
            $set: { updatedAt: new Date() },
          } as unknown as mongoose.mongo.UpdateFilter<Record<string, unknown>>);
        }
        log(
          `chicken: added ${rearing.length} rearing type(s), ${groups.length} group(s), ${breeds.length} breed(s)`,
        );
        // A breed that already existed under a catalogue key (e.g. added by hand) gets the catalogue's group and
        // composition only where those fields are unset; its name, Thai name and active flag are left as they are.
        let filed = 0;
        for (const b of catalogue.breeds) {
          if (!has(chicken['breeds'], b.key)) continue;
          const set: Record<string, unknown> = { 'breeds.$[b].groupKey': b.groupKey };
          const res = await types.updateOne(
            { _id: chicken._id },
            { $set: set },
            { arrayFilters: [{ 'b.key': b.key, 'b.groupKey': { $in: [null] } }] },
          );
          if (b.composition) {
            await types.updateOne(
              { _id: chicken._id },
              { $set: { 'breeds.$[b].composition': b.composition } },
              { arrayFilters: [{ 'b.key': b.key, 'b.composition': { $in: [null] } }] },
            );
          }
          filed += res.modifiedCount;
        }
        log(`chicken: filed ${filed} existing breed(s) under their catalogue group`);
      }
      const egg = await types.updateMany(
        { key: { $in: ['chicken', 'duck'] }, reproduction: { $exists: false } },
        { $set: { reproduction: 'egg' } },
      );
      log(`reproduction=egg set on ${egg.modifiedCount} type(s) that had none`);
    },
  },
];
