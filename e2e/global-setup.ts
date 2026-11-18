import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { MongoMemoryServer } from 'mongodb-memory-server';

const ROOT = join(import.meta.dirname, '..');
const API_PORT = process.env['E2E_API_PORT'] ?? '4310';
const WEB_PORT = process.env['E2E_WEB_PORT'] ?? '5310';

async function waitFor(url: string, what: string, ms = 90_000): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${what} did not become ready at ${url}`);
}

function start(
  name: string,
  cwd: string,
  command: string,
  args: string[],
  env: Record<string, string>,
): ChildProcess {
  const child = spawn(command, args, {
    cwd,
    env: { PATH: process.env['PATH'] ?? '', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on(
    'data',
    (d: Buffer) => process.env['E2E_VERBOSE'] && process.stdout.write(`[${name}] ${d}`),
  );
  child.stderr?.on(
    'data',
    (d: Buffer) => process.env['E2E_VERBOSE'] && process.stderr.write(`[${name}] ${d}`),
  );
  return child;
}

export default async function globalSetup(): Promise<() => Promise<void>> {
  const mongo = await MongoMemoryServer.create();
  const uri = mongo.getUri('farmplus_e2e');
  // Everything below is throw-away: random secrets generated per run, a disposable database, mock providers.
  process.env['E2E_MONGODB_URI'] = uri;
  process.env['E2E_API'] = `http://localhost:${API_PORT}`;
  const api = start(
    'api',
    join(ROOT, 'services/api'),
    join(ROOT, 'services/api/node_modules/.bin/tsx'),
    ['src/server.ts'],
    {
      NODE_ENV: 'development',
      API_PORT,
      MONGODB_URI: uri,
      JWT_ACCESS_SECRET: randomBytes(48).toString('base64'),
      MFA_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
      CORS_ORIGINS: `http://localhost:${WEB_PORT}`,
      PAYMENT_PROVIDER: 'mock', // test-mode provider: no real money, "Simulate successful payment" button
      PAYMENT_WEBHOOK_SECRET: randomBytes(24).toString('hex'),
      RATE_LIMIT_ENABLED: 'false', // many sign-ins from one address
      // Pinned here: the API also reads the developer's .env, which may turn verification on for local testing.
      AUTH_REQUIRE_VERIFICATION: 'false',
      // Social sign-in through the mock provider: it bounces straight back to the API callback, then to the web page.
      OAUTH_MOCK: 'true',
      API_PUBLIC_URL: `http://localhost:${API_PORT}`,
      OAUTH_RETURN_URLS: `http://localhost:${WEB_PORT}/farms/oauth-callback`,
      LOG_LEVEL: 'warn',
    },
  );
  const web = start(
    'web',
    join(ROOT, 'apps/web'),
    join(ROOT, 'apps/web/node_modules/.bin/vite'),
    ['--port', WEB_PORT, '--strictPort'],
    { API_PORT },
  );
  await waitFor(`http://localhost:${API_PORT}/ready`, 'API');
  await waitFor(`http://localhost:${WEB_PORT}/`, 'web app');
  return async () => {
    web.kill('SIGTERM');
    api.kill('SIGTERM');
    await mongo.stop();
  };
}
