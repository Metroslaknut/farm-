import { describe, expect, it } from 'vitest';
import {
  EnvValidationError,
  apiEnvSchema,
  deployEnvOf,
  parseEnv,
  productionWarnings,
} from '@farmplus/config/server';

const secrets = {
  MONGODB_URI: 'mongodb://127.0.0.1:27017/farmplus',
  JWT_ACCESS_SECRET: 'x'.repeat(32),
  MFA_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
};

/** A complete, valid production configuration: individual tests break one thing at a time. */
const prod = {
  NODE_ENV: 'production',
  MONGODB_URI: 'mongodb+srv://farmplus_api:Zq8vK2mPx@cluster0.abcde.mongodb.net/farmplus',
  JWT_ACCESS_SECRET: 'kJ8s0Qw3mZx9Lp2Vn7TaYb5RcD1eHf4GuIo6WiXtB0AyNhCq',
  MFA_ENCRYPTION_KEY: Buffer.from('0123456789abcdef0123456789ABCDEF').toString('base64'),
  CORS_ORIGINS: 'https://app.example.com,https://admin.example.com',
  TRUST_PROXY: '1',
  VIDEO_PROVIDER: 'cloudflare',
  CLOUDFLARE_ACCOUNT_ID: 'acc',
  CLOUDFLARE_STREAM_API_TOKEN: 'token',
  CLOUDFLARE_STREAM_CUSTOMER_CODE: 'code',
  VIDEO_WEBHOOK_SECRET: 'w'.repeat(20),
};

describe('API env validation', () => {
  it('applies defaults', () => {
    const env = parseEnv(apiEnvSchema, secrets);
    expect(env).toMatchObject({
      NODE_ENV: 'development',
      API_PORT: 4000,
      CORS_ORIGINS: [],
      RATE_LIMIT_ENABLED: true,
      AUTH_REQUIRE_VERIFICATION: false,
    });
  });

  it('parses comma-separated CORS origins', () => {
    const env = parseEnv(apiEnvSchema, {
      ...secrets,
      CORS_ORIGINS: 'http://a.test, http://b.test',
    });
    expect(env.CORS_ORIGINS).toEqual(['http://a.test', 'http://b.test']);
  });

  it('rejects an invalid port', () => {
    expect(() => parseEnv(apiEnvSchema, { ...secrets, API_PORT: 'abc' })).toThrow(
      EnvValidationError,
    );
  });

  it('requires CORS_ORIGINS in production and turns verification on by default', () => {
    expect(() => parseEnv(apiEnvSchema, { ...secrets, NODE_ENV: 'production' })).toThrow(
      /CORS_ORIGINS/,
    );
    const env = parseEnv(apiEnvSchema, {
      ...prod,
      VIDEO_PROVIDER: 'cloudflare',
      CLOUDFLARE_ACCOUNT_ID: 'acc',
      CLOUDFLARE_STREAM_API_TOKEN: 'token',
      CLOUDFLARE_STREAM_CUSTOMER_CODE: 'code',
      VIDEO_WEBHOOK_SECRET: 'w'.repeat(20),
    });
    expect(env.AUTH_REQUIRE_VERIFICATION).toBe(true);
  });

  it('refuses missing or weak secrets', () => {
    expect(() => parseEnv(apiEnvSchema, {})).toThrow(/JWT_ACCESS_SECRET/);
    expect(() => parseEnv(apiEnvSchema, { ...secrets, JWT_ACCESS_SECRET: 'short' })).toThrow(
      /JWT_ACCESS_SECRET/,
    );
    expect(() => parseEnv(apiEnvSchema, { ...secrets, MFA_ENCRYPTION_KEY: 'AAAA' })).toThrow(
      /MFA_ENCRYPTION_KEY/,
    );
  });
});

describe('production (and staging) validation', () => {
  const bad = (over: Record<string, string>, expected: RegExp) =>
    expect(() => parseEnv(apiEnvSchema, { ...prod, ...over })).toThrow(expected);

  it('accepts a complete production configuration and labels it', () => {
    const env = parseEnv(apiEnvSchema, prod);
    expect(env).toMatchObject({
      NODE_ENV: 'production',
      AUTH_REQUIRE_VERIFICATION: true,
      SHUTDOWN_DELAY_MS: 5000,
    });
    expect(deployEnvOf(env)).toBe('production');
    const staging = parseEnv(apiEnvSchema, { ...prod, DEPLOY_ENV: 'staging', GIT_SHA: 'abc1234' });
    expect(deployEnvOf(staging)).toBe('staging'); // staging runs the same hardening
    expect(staging.GIT_SHA).toBe('abc1234');
  });

  it('refuses a database connection without verified TLS', () => {
    bad({ MONGODB_URI: 'mongodb://u:p@db.example.com:27017/farmplus' }, /must use TLS/);
    bad(
      { MONGODB_URI: 'mongodb+srv://u:p@c.example.net/farmplus?tls=false' },
      /TLS must not be disabled/,
    );
    bad(
      { MONGODB_URI: 'mongodb+srv://u:p@c.example.net/farmplus?tlsInsecure=true' },
      /TLS must not be disabled/,
    );
    bad(
      { MONGODB_URI: 'mongodb+srv://u:p@c.example.net/farmplus?tlsAllowInvalidCertificates=true' },
      /TLS must not be disabled/,
    );
    bad(
      { MONGODB_URI: 'mongodb+srv://u:p@c.example.net/farmplus?tlsAllowInvalidHostnames=true' },
      /TLS must not be disabled/,
    );
    expect(
      parseEnv(apiEnvSchema, {
        ...prod,
        MONGODB_URI: 'mongodb://u:p@db.example.com:27017/farmplus?tls=true',
      }).NODE_ENV,
    ).toBe('production');
  });

  it('refuses an unauthenticated or local database', () => {
    bad({ MONGODB_URI: 'mongodb+srv://c.example.net/farmplus' }, /credentials/);
    bad({ MONGODB_URI: 'mongodb://u:p@127.0.0.1:27017/farmplus?tls=true' }, /localhost/);
  });

  it('never prints the database password in the error', () => {
    try {
      parseEnv(apiEnvSchema, {
        ...prod,
        MONGODB_URI: 'mongodb://u:SuperSecretPw@db.example.com/farmplus',
      });
      throw new Error('should have failed');
    } catch (e) {
      expect(String((e as Error).message)).not.toContain('SuperSecretPw');
    }
  });

  it('allows only exact https origins', () => {
    bad({ CORS_ORIGINS: '*' }, /exact https origin/);
    bad({ CORS_ORIGINS: 'http://app.example.com' }, /exact https origin/);
    bad({ CORS_ORIGINS: 'https://*.example.com' }, /exact https origin/);
    bad({ CORS_ORIGINS: 'https://app.example.com/path' }, /exact https origin/);
    bad({ CORS_ORIGINS: 'https://app.example.com,http://localhost:5173' }, /exact https origin/);
    bad({ CORS_ORIGINS: 'https://localhost:5173' }, /local address/);
  });

  it('refuses placeholder secrets, disabled safeguards and an untrusted proxy', () => {
    bad({ JWT_ACCESS_SECRET: 'x'.repeat(40) }, /placeholder/);
    bad({ JWT_ACCESS_SECRET: 'changemechangemechangemechangeme' }, /placeholder/);
    bad({ MFA_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64') }, /placeholder/);
    bad({ TRUST_PROXY: '0' }, /TRUST_PROXY/);
    bad({ RATE_LIMIT_ENABLED: 'false' }, /RATE_LIMIT_ENABLED/);
    bad({ AUTH_REQUIRE_VERIFICATION: 'false' }, /AUTH_REQUIRE_VERIFICATION/);
    bad({ LOG_LEVEL: 'debug' }, /LOG_LEVEL/);
  });

  it('keeps every mock provider out of production', () => {
    bad({ PAYMENT_PROVIDER: 'mock' }, /mock payment/);
    bad({ SHIPPING_PROVIDER: 'mock' }, /mock shipping/);
    bad({ AI_PROVIDER: 'mock' }, /mock AI/);
    bad({ VIDEO_PROVIDER: 'mock' }, /mock video/);
  });

  it('keeps the deployment label consistent with the hardening level', () => {
    bad({ DEPLOY_ENV: 'development' }, /DEPLOY_ENV/);
    expect(() => parseEnv(apiEnvSchema, { ...secrets, DEPLOY_ENV: 'staging' })).toThrow(
      /requires NODE_ENV=production/,
    );
    expect(() => parseEnv(apiEnvSchema, { ...secrets, DEPLOY_ENV: 'production' })).toThrow(
      /DEPLOY_ENV/,
    );
    expect(() => parseEnv(apiEnvSchema, { ...prod, GIT_SHA: 'bad sha!' })).toThrow(/GIT_SHA/);
  });

  it('local development stays easy: none of the production rules apply', () => {
    expect(parseEnv(apiEnvSchema, secrets).NODE_ENV).toBe('development');
    expect(deployEnvOf(parseEnv(apiEnvSchema, secrets))).toBe('development');
  });

  it('warns (without failing) about things that are valid but probably unintended', () => {
    const warnings = productionWarnings(parseEnv(apiEnvSchema, prod));
    expect(warnings.join('\n')).toMatch(/MEDIA_ALLOWED_HOSTS/);
    expect(warnings.join('\n')).toMatch(/GIT_SHA/);
    expect(productionWarnings(parseEnv(apiEnvSchema, secrets))).toEqual([]);
  });
});
