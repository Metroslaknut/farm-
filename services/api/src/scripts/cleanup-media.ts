import { loadApiEnv } from '@farmplus/config/server';
import { connectDb, disconnectDb } from '../db/connect';
import { runMediaCleanup } from '../modules/media/cleanup.service';
import { createVideoProvider } from '../modules/media/provider';

/** One-off media housekeeping (cron-friendly): `pnpm --filter @farmplus/api media:cleanup` */
const env = loadApiEnv();
await connectDb(env.MONGODB_URI);
try {
  console.log(JSON.stringify(await runMediaCleanup({ env, video: createVideoProvider(env) })));
} finally {
  await disconnectDb();
}
