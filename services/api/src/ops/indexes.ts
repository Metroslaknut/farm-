import type { Model } from 'mongoose';
import { ALL_MODELS } from '../db/registry';

export interface IndexIssue {
  collection: string;
  name: string;
  detail: string;
}
export interface IndexReport {
  collections: number;
  /** Declared in the schema, absent in the database. `--apply` creates these. */
  missing: IndexIssue[];
  /** In the database, not declared. NEVER dropped automatically (could be hand-made, or used by a rollback target). */
  extra: IndexIssue[];
  /** Applying could not create these (same name, different definition). Needs a reviewed migration. */
  conflicts: IndexIssue[];
  created: IndexIssue[];
}

const describe = (spec: unknown): string => JSON.stringify(spec);

/**
 * Compare the indexes the code declares with the ones the database has. Non-destructive by construction: the only
 * write it can perform is `createIndexes` for declared-but-missing indexes. It never calls `syncIndexes`/`dropIndex`.
 */
export async function checkIndexes(
  options: { apply?: boolean; models?: Model<never>[] } = {},
): Promise<IndexReport> {
  const models = (options.models ?? ALL_MODELS) as Model<never>[];
  const report: IndexReport = {
    collections: models.length,
    missing: [],
    extra: [],
    conflicts: [],
    created: [],
  };
  for (const model of models) {
    const collection = model.collection.name;
    let diff: { toCreate: Record<string, unknown>[]; toDrop: string[] };
    try {
      diff = (await model.diffIndexes()) as typeof diff;
    } catch (error) {
      // A collection that does not exist yet has every declared index missing.
      if ((error as { codeName?: string }).codeName !== 'NamespaceNotFound') throw error;
      diff = {
        toCreate: model.schema.indexes().map(([fields]) => fields as Record<string, unknown>),
        toDrop: [],
      };
    }
    for (const spec of diff.toCreate)
      report.missing.push({
        collection,
        name: describe(spec),
        detail: 'declared in the schema, missing in the database',
      });
    for (const name of diff.toDrop)
      report.extra.push({
        collection,
        name,
        detail: 'in the database but not declared (left untouched)',
      });
    if (options.apply && diff.toCreate.length > 0) {
      try {
        await model.createCollection().catch(() => undefined); // idempotent; needed on a brand-new database
        await model.createIndexes();
        for (const spec of diff.toCreate)
          report.created.push({ collection, name: describe(spec), detail: 'created' });
      } catch (error) {
        report.conflicts.push({
          collection,
          name: 'createIndexes',
          detail:
            `${(error as { codeName?: string }).codeName ?? 'error'}: ${(error as Error).message}`.slice(
              0,
              300,
            ),
        });
      }
    }
  }
  return report;
}
