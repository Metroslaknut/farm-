import type mongoose from 'mongoose';

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
];
