/**
 * Validate the environment a deployment would start with, WITHOUT starting anything and without printing values:
 *   pnpm --filter @farmplus/api env:check          (reads the process environment and local .env files)
 * Used as a pipeline step before deploy: a bad configuration fails the release, not the first request.
 */
import {
  EnvValidationError,
  deployEnvOf,
  loadApiEnv,
  productionWarnings,
} from '@farmplus/config/server';

try {
  const env = loadApiEnv();
  const warnings = productionWarnings(env);
  process.stdout.write(
    `${JSON.stringify({ ok: true, nodeEnv: env.NODE_ENV, deployment: deployEnvOf(env), warnings }, null, 2)}\n`,
  );
} catch (error) {
  if (error instanceof EnvValidationError) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
  throw error;
}
