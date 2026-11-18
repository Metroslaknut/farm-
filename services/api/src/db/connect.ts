import mongoose from 'mongoose';
import { ALL_MODELS } from './registry';

export interface ConnectOptions {
  /**
   * Build/repair indexes at startup with `syncIndexes()`. Convenient for development and tests, but it also DROPS any
   * index that is not in the schema and does heavy work on every instance start, so production runs with this off
   * and manages indexes explicitly with `pnpm db:indexes` as a release step (see docs/ops/migrations.md).
   */
  syncIndexes?: boolean;
}

export async function connectDb(
  uri: string,
  options: ConnectOptions = {},
): Promise<typeof mongoose> {
  mongoose.set('strictQuery', true);
  // Production: never build indexes implicitly on a live cluster; a missing index is a release-step failure to fix, not a surprise.
  mongoose.set('autoIndex', options.syncIndexes ?? true);
  const connection = await mongoose.connect(uri, { serverSelectionTimeoutMS: 10_000 });
  if (options.syncIndexes ?? true) {
    // Build declared indexes (unique constraints are security-relevant: duplicate accounts, token hashes).
    await Promise.all(ALL_MODELS.map((m) => m.syncIndexes()));
  }
  return connection;
}

export const disconnectDb = (): Promise<void> => mongoose.disconnect();
