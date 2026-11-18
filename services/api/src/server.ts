import {
  EnvValidationError,
  deployEnvOf,
  loadApiEnv,
  productionWarnings,
} from '@farmplus/config/server';
import { createApp } from './app';
import { connectDb, disconnectDb } from './db/connect';
import { reportError } from './lib/error-reporter';
import { TokenSigner } from './lib/jwt';
import { lifecycle } from './lib/lifecycle';
import { configureLogger, logger, maskText } from './lib/logger';
import { seedAnimalTypes } from './modules/animal-types/seed';
import { runMarketplaceCleanup } from './modules/marketplace/cleanup.service';
import { runOrdersCleanup } from './modules/orders/orders.service';
import { seedProductCategories } from './modules/products/compliance';
import { createPaymentProvider } from './modules/finance/provider';
import { runMediaCleanup } from './modules/media/cleanup.service';
import { createVideoProvider } from './modules/media/provider';
import { attachRealtime, closeRealtime } from './modules/realtime/socket';
import { syncRbac } from './rbac/seed';
import { SERVICE_NAME, SERVICE_VERSION } from './service-info';

async function main(): Promise<void> {
  let env;
  try {
    env = loadApiEnv();
  } catch (error) {
    if (error instanceof EnvValidationError) {
      // Names the failing variables, never their values.
      process.stderr.write(`${error.message}\n`);
      process.exit(1);
    }
    throw error;
  }

  configureLogger({
    level: env.LOG_LEVEL,
    base: {
      service: SERVICE_NAME,
      version: SERVICE_VERSION,
      deployment: deployEnvOf(env),
      ...(env.GIT_SHA ? { commit: env.GIT_SHA } : {}),
    },
  });
  for (const warning of productionWarnings(env)) logger.warn(`config: ${warning}`);

  // Unexpected failures are reported and the process exits, so the orchestrator restarts a clean instance rather
  // than leaving one running in an unknown state.
  process.on('uncaughtException', (error) => {
    reportError(error, { source: 'process' });
    process.exit(1);
  });
  process.on('unhandledRejection', (reason) => {
    reportError(reason, { source: 'process' });
    process.exit(1);
  });

  // Production never builds or drops indexes implicitly; they are a release step (`pnpm db:indexes`).
  await connectDb(env.MONGODB_URI, { syncIndexes: env.NODE_ENV !== 'production' });
  await syncRbac();
  await seedAnimalTypes();
  await seedProductCategories();

  const video = createVideoProvider(env);
  const payments = createPaymentProvider(env);
  const server = createApp(env, { video, payments }).listen(env.API_PORT, env.API_HOST, () => {
    logger.info('listening', { host: env.API_HOST, port: env.API_PORT, nodeEnv: env.NODE_ENV });
  });
  const realtime = attachRealtime(server, { env, signer: TokenSigner.fromEnv(env) });

  // Housekeeping for failed/expired uploads and stale live sessions. Idempotent, so running it on every instance is safe.
  const job = (name: string, run: () => Promise<unknown>) =>
    run().catch((error: unknown) => reportError(error, { source: 'job', route: name }));
  const cleanup = setInterval(() => {
    void job('media-cleanup', () => runMediaCleanup({ env, video }));
    // Offers, listings and reservations that ran out of time.
    void job('marketplace-cleanup', () => runMarketplaceCleanup());
    // Unpaid orders past their deadline, shipped orders past the confirmation grace period.
    void job('orders-cleanup', () => runOrdersCleanup(new Date(), payments));
  }, 10 * 60_000);
  cleanup.unref();

  // Graceful shutdown: first report "not ready" so the load balancer stops sending traffic, wait for it to notice,
  // then stop accepting connections, let in-flight requests finish and close the database.
  let stopping = false;
  const shutdown = (signal: string): void => {
    if (stopping) return;
    stopping = true;
    logger.info('shutting down', { signal, drainMs: env.SHUTDOWN_DELAY_MS });
    lifecycle.beginShutdown();
    clearInterval(cleanup);
    setTimeout(() => {
      void closeRealtime(realtime);
      server.close(() => void disconnectDb().finally(() => process.exit(0)));
      setTimeout(() => process.exit(1), 10_000).unref();
    }, env.SHUTDOWN_DELAY_MS);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${maskText(`[api] failed to start: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`)}\n`,
  );
  process.exit(1);
});
