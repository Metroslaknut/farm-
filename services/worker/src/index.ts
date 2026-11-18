import { EnvValidationError, loadWorkerEnv } from '@farmplus/config/server';
import { startHealthServer, type WorkerHealthState } from './health';
import { WorkerRuntime } from './runtime';

/** One JSON line per event, like the API, so one log pipeline and one set of alerts covers both. */
const log = (level: 'info' | 'error', msg: string, fields: Record<string, unknown> = {}) =>
  (level === 'error' ? process.stderr : process.stdout).write(
    `${JSON.stringify({ ts: new Date().toISOString(), level, msg, service: 'farmplus-worker', ...fields })}\n`,
  );

async function main(): Promise<void> {
  let env;
  try {
    env = loadWorkerEnv();
  } catch (error) {
    if (error instanceof EnvValidationError) {
      process.stderr.write(`${error.message}\n`);
      process.exit(1);
    }
    throw error;
  }

  process.on('uncaughtException', (error) => {
    log('error', 'uncaught exception', { error: error.message, stack: error.stack });
    process.exit(1);
  });
  process.on('unhandledRejection', (reason) => {
    log('error', 'unhandled rejection', { error: String(reason) });
    process.exit(1);
  });

  const runtime = new WorkerRuntime(env.WORKER_NAME);
  // Jobs are registered here in later Parts.
  await runtime.start();
  const health: WorkerHealthState = {
    name: env.WORKER_NAME,
    startedAt: Date.now(),
    shuttingDown: false,
  };
  const server = env.WORKER_HEALTH_PORT
    ? await startHealthServer(env.WORKER_HEALTH_PORT, health)
    : null;
  log('info', 'started', {
    worker: runtime.name,
    nodeEnv: env.NODE_ENV,
    ...(env.GIT_SHA ? { commit: env.GIT_SHA } : {}),
    jobs: runtime.jobCount,
    healthPort: env.WORKER_HEALTH_PORT ?? null,
  });

  // Keep the process alive until a signal arrives (no queue connection exists yet).
  const keepAlive = setInterval(() => undefined, 60_000);
  const shutdown = async (signal: string): Promise<void> => {
    log('info', 'shutting down', { signal });
    health.shuttingDown = true;
    clearInterval(keepAlive);
    await runtime.stop();
    server?.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

void main();
