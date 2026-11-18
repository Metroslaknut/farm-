import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  API_ENV_KEYS,
  apiEnvSchema,
  dbOpsEnvSchema,
  parseEnv,
  workerEnvSchema,
} from '@farmplus/config/server';

const root = join(process.cwd(), '..', '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    out[line.slice(0, eq)] = line.slice(eq + 1);
  }
  return out;
}

/** Fill the placeholders of a template with realistic generated values, as a real deployment would. */
function fill(template: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(template)) {
    if (value === '') continue; // optional and unset
    if (key === 'MONGODB_URI')
      out[key] = 'mongodb+srv://farmplus_api:Zq8vK2mPx9@cluster0.abcde.mongodb.net/farmplus';
    else if (key === 'JWT_ACCESS_SECRET') out[key] = randomBytes(48).toString('base64');
    else if (key === 'MFA_ENCRYPTION_KEY') out[key] = randomBytes(32).toString('base64');
    else if (value === '<secret>') out[key] = randomBytes(24).toString('hex');
    else if (value === '<id>' || value === '<code>') out[key] = 'abc123def456';
    else if (value === '<set-by-the-deploy-pipeline>') out[key] = 'abc1234';
    else out[key] = value;
  }
  return out;
}

describe.each(['staging', 'production'])('%s environment template', (name) => {
  const raw = parseEnvFile(read(`deploy/env/${name}.env.example`));

  it('is a valid configuration once its placeholders are filled — staging proves production', () => {
    const env = parseEnv(apiEnvSchema, fill(raw));
    expect(env).toMatchObject({
      NODE_ENV: 'production',
      DEPLOY_ENV: name,
      TRUST_PROXY: 1,
      RATE_LIMIT_ENABLED: true,
    });
    expect(env.CORS_ORIGINS.every((o) => o.startsWith('https://'))).toBe(true);
  });

  it('uses only variables the API actually reads', () => {
    for (const key of Object.keys(raw)) expect(API_ENV_KEYS, key).toContain(key);
  });

  it('contains no secret: every sensitive value is a placeholder or empty', () => {
    for (const [key, value] of Object.entries(raw)) {
      if (
        /SECRET|TOKEN|API_KEY|MONGODB_URI|ENCRYPTION_KEY/.test(key) &&
        !/_TTL_|_TOKENS$/.test(key)
      )
        expect(['', '<secret>'], `${key}=${value}`).toContain(value);
      expect(value, key).not.toMatch(/mongodb(\+srv)?:\/\/[^<\s]*:[^<\s]+@/); // no credentials inside any value
    }
  });

  it('refuses to start with a missing secret (the placeholder is not a valid value)', () => {
    expect(() => parseEnv(apiEnvSchema, raw)).toThrow(
      /MONGODB_URI|JWT_ACCESS_SECRET|MFA_ENCRYPTION_KEY/,
    );
  });
});

describe('other templates', () => {
  it('the worker and web templates parse / contain only public values', () => {
    const worker = parseEnvFile(read('deploy/env/worker.env.example'));
    expect(parseEnv(workerEnvSchema, { ...worker, GIT_SHA: 'abc1234' })).toMatchObject({
      WORKER_HEALTH_PORT: 4100,
    });
    const web = parseEnvFile(read('deploy/env/web.env.example'));
    for (const key of Object.keys(web)) expect(key).toMatch(/^(VITE_|WEB_)/);
    const mobile = parseEnvFile(read('deploy/env/mobile.env.example'));
    for (const key of Object.keys(mobile))
      expect(key).toMatch(/^(EXPO_PUBLIC_|FARMPLUS_|EAS_PROJECT_ID)/);
  });

  it('database operations need only the connection string (no application secrets)', () => {
    const parsed = parseEnv(dbOpsEnvSchema, { MONGODB_URI: 'mongodb://127.0.0.1:27017/farmplus' });
    expect(Object.keys(parsed)).not.toContain('JWT_ACCESS_SECRET');
    expect(() =>
      parseEnv(dbOpsEnvSchema, {
        NODE_ENV: 'production',
        DEPLOY_ENV: 'staging',
        MONGODB_URI: 'mongodb://127.0.0.1:27017/farmplus',
      }),
    ).toThrow(/MONGODB_URI/);
  });
});

describe('documentation covers every variable', () => {
  const envExample = read('.env.example');
  const docs = read('docs/ops/environments.md');
  it('.env.example and docs/ops/environments.md mention every API variable', () => {
    for (const key of API_ENV_KEYS) {
      expect(envExample, `.env.example is missing ${key}`).toMatch(new RegExp(`\\b${key}\\b`));
      expect(docs, `docs/ops/environments.md is missing ${key}`).toContain(`\`${key}\``);
    }
    for (const key of [
      'WORKER_NAME',
      'WORKER_HEALTH_PORT',
      'BACKUP_ENCRYPTION_KEY',
      'VITE_API_BASE_URL',
      'WEB_MEDIA_HOSTS',
      'WEB_REQUIRE_API_BASE',
      'EXPO_PUBLIC_API_BASE_URL',
      'FARMPLUS_LINK_HOST',
      'EAS_PROJECT_ID',
    ])
      expect(docs, `docs/ops/environments.md is missing ${key}`).toContain(`\`${key}\``);
  });

  it('the repository ignores real environment files and ships the pipeline files', () => {
    const ignore = read('.gitignore');
    expect(ignore).toMatch(/^\.env$/m);
    expect(ignore).toMatch(/^\.env\.\*$/m);
    expect(ignore).toMatch(/^!\.env\.example$/m);
    for (const f of [
      '.github/workflows/ci.yml',
      '.github/workflows/release.yml',
      '.github/workflows/mobile-eas.yml',
      'services/api/Dockerfile',
      'services/worker/Dockerfile',
      'apps/mobile/eas.json',
    ])
      expect(existsSync(join(root, f)), f).toBe(true);
  });

  it('CI runs the required checks and never uses production credentials', () => {
    const ci = read('.github/workflows/ci.yml');
    for (const step of [
      'pnpm typecheck',
      'pnpm lint',
      'pnpm test',
      'pnpm build',
      'gitleaks',
      'audit-policy.mjs',
    ])
      expect(ci).toContain(step);
    expect(ci).toMatch(/permissions:\s*\n\s*contents: read/);
    expect(ci).not.toMatch(/secrets\.(?!GITHUB_TOKEN)/);
    const release = read('.github/workflows/release.yml');
    expect(release).toContain('environment: ${{ inputs.environment }}');
    expect(release).toMatch(/--apply --confirm-db/);
    expect(release).not.toMatch(
      /tlsInsecure|tlsAllowInvalid|NODE_TLS_REJECT_UNAUTHORIZED|--insecure|curl -k/,
    );
  });
});
