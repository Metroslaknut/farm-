/**
 * Server-only configuration (API, Worker). Never import this from Web or Mobile.
 *
 * Strategy:
 *  - Real process environment always wins (production: set variables on the host).
 *  - In development/test, `.env` files at the repo root fill in gaps, most specific first:
 *    `.env.<NODE_ENV>.local` > `.env.<NODE_ENV>` > `.env.local` > `.env`
 *  - Everything is validated once at startup with Zod; invalid config aborts startup.
 */
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';
import { APP_ENVIRONMENTS, DEFAULT_API_PORT } from './index';

export function findRepoRoot(start: string = process.cwd()): string {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return resolve(start);
    dir = parent;
  }
}

export function loadEnvFiles(env: NodeJS.ProcessEnv = process.env): void {
  const nodeEnv = env['NODE_ENV'] ?? 'development';
  const root = findRepoRoot();
  const files = [`.env.${nodeEnv}.local`, `.env.${nodeEnv}`, '.env.local', '.env']
    .map((name) => join(root, name))
    .filter((file) => existsSync(file));
  if (files.length > 0) {
    // dotenv never overrides existing values, so earlier files take priority.
    dotenv.config({ path: files, processEnv: env, quiet: true });
  }
}

const port = z.coerce.number().int().min(1).max(65535);

export const DEPLOY_ENVIRONMENTS = ['development', 'staging', 'production'] as const;
export type DeployEnvironment = (typeof DEPLOY_ENVIRONMENTS)[number];

export const baseServerEnvSchema = z.object({
  NODE_ENV: z.enum(APP_ENVIRONMENTS).default('development'),
  /**
   * Which deployment this is. Staging runs with NODE_ENV=production (same hardening and the same validation as
   * production, so staging proves production), and differs only in its resources and in this label.
   */
  DEPLOY_ENV: z.enum(DEPLOY_ENVIRONMENTS).optional(),
  /** Build identifier (commit SHA) shown by /health and in logs. Set by the deploy pipeline. */
  GIT_SHA: z
    .string()
    .regex(/^[A-Za-z0-9._-]{4,64}$/, 'must be 4-64 characters: letters, digits, . _ -')
    .optional(),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

/** Deployment label with its default: production hardening implies `production` unless this is staging. */
export const deployEnvOf = (env: {
  NODE_ENV: string;
  DEPLOY_ENV?: DeployEnvironment | undefined;
}) => env.DEPLOY_ENV ?? (env.NODE_ENV === 'production' ? 'production' : 'development');

const booleanString = z.enum(['true', 'false']).transform((value) => value === 'true');

/** 32 random bytes, base64 encoded. Generate: openssl rand -base64 32 */
const aes256Key = z.string().refine((value) => Buffer.from(value, 'base64').length === 32, {
  message: 'must be 32 bytes, base64 encoded (openssl rand -base64 32)',
});

const INSECURE_TLS =
  /(?:^|[?&])(?:tls|ssl)=false\b|tlsInsecure=true|tlsAllowInvalid(?:Certificates|Hostnames)=true/i;
const LOCAL_HOST = /^(?:localhost|127\.|0\.0\.0\.0|\[?::1\]?$)/i;

/** A secret that is obviously not random: too few distinct characters (e.g. "xxxx…", "changeme…"). */
const lowEntropy = (value: string, minDistinct: number): boolean =>
  new Set(value).size < minDistinct;

/** Why a MongoDB URI is not acceptable for a production-hardened deployment (messages never include the URI). */
export function mongoUriIssues(uri: string): string[] {
  const out: string[] = [];
  if (INSECURE_TLS.test(uri))
    out.push('TLS must not be disabled or relaxed (no tls=false, tlsInsecure, tlsAllowInvalid*)');
  const srv = uri.startsWith('mongodb+srv://');
  if (!srv && !/[?&]tls=true\b/i.test(uri) && !/[?&]ssl=true\b/i.test(uri))
    out.push('must use TLS: a mongodb+srv:// URI (Atlas) or tls=true');
  const authority = /^mongodb(?:\+srv)?:\/\/(?:([^@/]*)@)?([^/?]+)/.exec(uri);
  if (!authority?.[1] || !authority[1].includes(':'))
    out.push('must include database credentials (a dedicated least-privilege user)');
  const hosts = (authority?.[2] ?? '').split(',');
  if (hosts.some((h) => LOCAL_HOST.test(h))) out.push('must not point at localhost in production');
  return out;
}

/**
 * Rules that only apply when running with production hardening (production AND staging). They exist to catch the
 * mistakes that actually cause incidents: plaintext or unverified database connections, wildcard/http CORS, a
 * placeholder secret, rate limiting switched off, a proxy that is not trusted (every client then shares one IP).
 */
function productionIssues(
  env: {
    MONGODB_URI: string;
    CORS_ORIGINS: string[];
    JWT_ACCESS_SECRET: string;
    MFA_ENCRYPTION_KEY: string;
    TRUST_PROXY: number;
    RATE_LIMIT_ENABLED: boolean;
    AUTH_REQUIRE_VERIFICATION?: boolean | undefined;
    LOG_LEVEL: string;
  },
  ctx: z.RefinementCtx,
): void {
  const add = (path: string, message: string) =>
    ctx.addIssue({ code: 'custom', path: [path], message });

  mongoUriIssues(env.MONGODB_URI).forEach((message) => add('MONGODB_URI', message));

  for (const origin of env.CORS_ORIGINS) {
    let parsed: URL | null = null;
    try {
      parsed = new URL(origin);
    } catch {
      /* reported below */
    }
    if (!parsed || parsed.protocol !== 'https:' || parsed.origin !== origin || origin.includes('*'))
      add(
        'CORS_ORIGINS',
        `"${origin}" must be an exact https origin (https://host[:port], no path, no wildcard)`,
      );
    else if (LOCAL_HOST.test(parsed.hostname))
      add('CORS_ORIGINS', `"${origin}" is a local address and must not be allowed in production`);
  }

  if (lowEntropy(env.JWT_ACCESS_SECRET, 12))
    add(
      'JWT_ACCESS_SECRET',
      'looks like a placeholder: generate a random one (openssl rand -base64 48)',
    );
  if (lowEntropy(Buffer.from(env.MFA_ENCRYPTION_KEY, 'base64').toString('hex'), 8))
    add(
      'MFA_ENCRYPTION_KEY',
      'looks like a placeholder: generate a random one (openssl rand -base64 32)',
    );
  if (env.TRUST_PROXY < 1)
    add(
      'TRUST_PROXY',
      'must be >= 1 behind a load balancer/proxy, or every client appears as the proxy IP (rate limits and audit IPs break)',
    );
  if (!env.RATE_LIMIT_ENABLED) add('RATE_LIMIT_ENABLED', 'must stay true in production');
  if (env.AUTH_REQUIRE_VERIFICATION === false)
    add('AUTH_REQUIRE_VERIFICATION', 'must not be disabled in production');
  if (env.LOG_LEVEL === 'debug') add('LOG_LEVEL', 'debug logging is not allowed in production');
}

/** Things that are valid but probably unintended in a production deployment. Printed by `env:check`; never fatal. */
export function productionWarnings(env: ApiEnv): string[] {
  if (env.NODE_ENV !== 'production') return [];
  const w: string[] = [];
  if (env.MEDIA_ALLOWED_HOSTS.length === 0)
    w.push(
      'MEDIA_ALLOWED_HOSTS is empty: photo/video/document links are refused until your CDN host is listed',
    );
  if (env.PAYMENT_PROVIDER === 'none') w.push('PAYMENT_PROVIDER=none: online payment is disabled');
  if (!env.PAYMENT_WEBHOOK_SECRET)
    w.push('PAYMENT_WEBHOOK_SECRET is not set: the payments webhook endpoint is off');
  if (!env.SHIPPING_WEBHOOK_SECRET)
    w.push('SHIPPING_WEBHOOK_SECRET is not set: the shipping webhook endpoint is off');
  if (env.AI_PROVIDER === 'none')
    w.push('AI_PROVIDER=none: assessments have no AI explanation (this is fine)');
  if (!env.GIT_SHA)
    w.push('GIT_SHA is not set: /health and logs cannot say which build is running');
  if (env.VIDEO_PROVIDER === 'none')
    w.push('VIDEO_PROVIDER=none: video uploads and live streams are switched off');
  if (env.PHOTO_STORAGE === 'database')
    w.push(
      'PHOTO_STORAGE=database: uploaded animal photos are stored in MongoDB (set PHOTO_STORAGE=r2 for object storage)',
    );
  return w;
}

const apiEnvObject = baseServerEnvSchema.extend({
  API_HOST: z.string().min(1).default('0.0.0.0'),
  API_PORT: port.default(DEFAULT_API_PORT),
  CORS_ORIGINS: z
    .string()
    .default('')
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),
  /** Number of reverse-proxy hops to trust for client IP (0 = none). */
  TRUST_PROXY: z.coerce.number().int().min(0).max(10).default(0),
  RATE_LIMIT_ENABLED: booleanString.default(true),

  MONGODB_URI: z
    .string()
    .regex(/^mongodb(\+srv)?:\/\//, 'must start with mongodb:// or mongodb+srv://'),

  // Auth (server-only secrets — never expose to clients)
  JWT_ACCESS_SECRET: z.string().min(32, 'must be at least 32 characters'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
  MFA_ENCRYPTION_KEY: aes256Key,
  MFA_ISSUER: z.string().min(1).default('FARM+'),
  /** Hosts animal photos/documents may be linked from (comma-separated). Required in production for media links. */
  MEDIA_ALLOWED_HOSTS: z
    .string()
    .default('')
    .transform((value) =>
      value
        .split(',')
        .map((host) => host.trim().toLowerCase())
        .filter(Boolean),
    ),
  // Animal photos uploaded from a device. `database`: bytes in MongoDB, served by the API (development/test, small
  // deployments). `r2`: Cloudflare R2, served from the bucket's public domain. Credentials are server-only.
  PHOTO_STORAGE: z.enum(['database', 'r2']).default('database'),
  R2_ACCOUNT_ID: z.string().min(1).optional(),
  R2_ACCESS_KEY_ID: z.string().min(1).optional(),
  R2_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  R2_BUCKET: z.string().min(1).optional(),
  /** Public base URL of the bucket's custom domain, e.g. `https://photos.example.com` (no trailing slash). */
  R2_PUBLIC_BASE_URL: z
    .url()
    .transform((value) => value.replace(/\/+$/, ''))
    .optional(),
  // Video & live streaming (Part 10). Credentials are server-only.
  /**
   * `mock` is an in-memory development/test stand-in and is refused in production. `none` switches video and live off
   * (creating them answers 503 VIDEO_NOT_CONFIGURED) so a deployment can run before a streaming account exists.
   */
  VIDEO_PROVIDER: z.enum(['mock', 'cloudflare', 'none']).default('mock'),
  CLOUDFLARE_ACCOUNT_ID: z.string().min(1).optional(),
  CLOUDFLARE_STREAM_API_TOKEN: z.string().min(1).optional(),
  /** The `customer-<code>` part of your Stream playback hostname. */
  CLOUDFLARE_STREAM_CUSTOMER_CODE: z.string().min(1).optional(),
  /** Secret used to authenticate provider webhooks (HMAC). */
  VIDEO_WEBHOOK_SECRET: z.string().min(16, 'must be at least 16 characters').optional(),
  // Orders & shipping (Part 12)
  /** `none`: only the seller's own shipping rules produce quotes. `mock` is a development/test stand-in (refused in production). */
  SHIPPING_PROVIDER: z.enum(['none', 'mock']).default('none'),
  /** Authenticates shipping-status callbacks from carriers/aggregators (HMAC). Without it the endpoint is disabled. */
  SHIPPING_WEBHOOK_SECRET: z.string().min(16, 'must be at least 16 characters').optional(),
  /** Authenticates payment/refund callbacks from the payment provider (HMAC). Without it the endpoint is disabled. */
  PAYMENT_WEBHOOK_SECRET: z.string().min(16, 'must be at least 16 characters').optional(),
  // Finance (Part 13)
  /** `none`: online payment is disabled. `mock` is a development/test stand-in (refused in production). No real provider adapter ships yet. */
  PAYMENT_PROVIDER: z.enum(['none', 'mock']).default('none'),
  // AI assessment (Part 15)
  /** `none`: assessments run without an AI explanation. `mock`: development/test stand-in (refused in production). */
  AI_PROVIDER: z.enum(['none', 'mock', 'anthropic']).default('none'),
  /** Server-side only. Never sent to a client, logged or stored. */
  AI_API_KEY: z.string().min(20, 'must be at least 20 characters').optional(),
  AI_MODEL: z.string().min(2).max(100).default('claude-sonnet-5-5'),
  AI_BASE_URL: z.url().optional(),
  AI_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120_000).default(20_000),
  AI_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(100).max(4000).default(700),
  VIDEO_MAX_UPLOAD_MB: z.coerce.number().int().min(1).max(2000).default(200),
  VIDEO_MAX_DURATION_SECONDS: z.coerce.number().int().min(5).max(900).default(120),
  /** When true, accounts must verify email/phone before they can log in. Default: on in production. */
  AUTH_REQUIRE_VERIFICATION: booleanString.optional(),
  // Social sign-in (Google / Facebook). A provider is offered only when both its id and its secret are set.
  /** Public base URL of this API as browsers reach it (no trailing slash). OAuth redirect URIs are built from it. */
  API_PUBLIC_URL: z
    .url()
    .transform((u) => u.replace(/\/+$/, ''))
    .optional(),
  OAUTH_GOOGLE_CLIENT_ID: z.string().min(1).optional(),
  /** Server-side only. */
  OAUTH_GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
  OAUTH_FACEBOOK_APP_ID: z.string().min(1).optional(),
  /** Server-side only. */
  OAUTH_FACEBOOK_APP_SECRET: z.string().min(1).optional(),
  /** The exact URLs a social sign-in may return to (web callback page, mobile deep link), comma-separated. */
  OAUTH_RETURN_URLS: z
    .string()
    .default('')
    .transform((value) =>
      value
        .split(',')
        .map((url) => url.trim())
        .filter(Boolean),
    ),
  /** Development/test stand-in that signs in a made-up Google/Facebook profile. Refused in production. */
  OAUTH_MOCK: booleanString.default(false),
  /** On SIGTERM the API reports "not ready" for this long before closing, so the load balancer drains it first. */
  SHUTDOWN_DELAY_MS: z.coerce.number().int().min(0).max(60_000).default(5000),
});

/** Every variable the API reads, for documentation and tests. */
export const API_ENV_KEYS = Object.keys(apiEnvObject.shape);

export const apiEnvSchema = apiEnvObject
  .superRefine((env, ctx) => {
    const issue = (path: string, message: string) =>
      ctx.addIssue({ code: 'custom', path: [path], message });
    if (env.NODE_ENV === 'production' && env.OAUTH_MOCK)
      issue('OAUTH_MOCK', 'the mock sign-in provider cannot be used in production');
    for (const [id, secret] of [
      ['OAUTH_GOOGLE_CLIENT_ID', 'OAUTH_GOOGLE_CLIENT_SECRET'],
      ['OAUTH_FACEBOOK_APP_ID', 'OAUTH_FACEBOOK_APP_SECRET'],
    ] as const) {
      if (Boolean(env[id]) !== Boolean(env[secret]))
        issue(env[id] ? secret : id, `set both ${id} and ${secret}, or neither`);
    }
    const social = Boolean(
      env.OAUTH_GOOGLE_CLIENT_ID || env.OAUTH_FACEBOOK_APP_ID || env.OAUTH_MOCK,
    );
    if (social && !env.API_PUBLIC_URL)
      issue('API_PUBLIC_URL', 'required for social sign-in (redirect URIs are built from it)');
    if (social && env.OAUTH_RETURN_URLS.length === 0)
      issue(
        'OAUTH_RETURN_URLS',
        'list where a social sign-in may return (web callback, mobile deep link)',
      );
    for (const url of env.OAUTH_RETURN_URLS) {
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        issue('OAUTH_RETURN_URLS', `"${url}" is not a URL`);
        continue;
      }
      if (env.NODE_ENV === 'production' && parsed.protocol === 'http:')
        issue('OAUTH_RETURN_URLS', `"${url}" must use https in production`);
      if (parsed.hash) issue('OAUTH_RETURN_URLS', `"${url}" must not contain a #fragment`);
    }
    if (env.NODE_ENV === 'production' && env.SHIPPING_PROVIDER === 'mock') {
      ctx.addIssue({
        code: 'custom',
        path: ['SHIPPING_PROVIDER'],
        message: 'the mock shipping provider cannot be used in production',
      });
    }
    if (env.AI_PROVIDER === 'anthropic' && !env.AI_API_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['AI_API_KEY'],
        message: 'required when AI_PROVIDER=anthropic',
      });
    }
    if (env.NODE_ENV === 'production' && env.AI_PROVIDER === 'mock') {
      ctx.addIssue({
        code: 'custom',
        path: ['AI_PROVIDER'],
        message: 'the mock AI provider cannot be used in production',
      });
    }
    if (env.NODE_ENV === 'production' && env.PAYMENT_PROVIDER === 'mock') {
      ctx.addIssue({
        code: 'custom',
        path: ['PAYMENT_PROVIDER'],
        message: 'the mock payment provider cannot be used in production',
      });
    }
    if (env.NODE_ENV === 'production' && env.VIDEO_PROVIDER === 'mock') {
      ctx.addIssue({
        code: 'custom',
        path: ['VIDEO_PROVIDER'],
        message: 'the mock video provider cannot be used in production',
      });
    }
    if (env.VIDEO_PROVIDER === 'cloudflare') {
      for (const key of [
        'CLOUDFLARE_ACCOUNT_ID',
        'CLOUDFLARE_STREAM_API_TOKEN',
        'CLOUDFLARE_STREAM_CUSTOMER_CODE',
        'VIDEO_WEBHOOK_SECRET',
      ] as const) {
        if (!env[key])
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message: 'required when VIDEO_PROVIDER=cloudflare',
          });
      }
    }
    if (env.PHOTO_STORAGE === 'r2') {
      for (const key of [
        'R2_ACCOUNT_ID',
        'R2_ACCESS_KEY_ID',
        'R2_SECRET_ACCESS_KEY',
        'R2_BUCKET',
        'R2_PUBLIC_BASE_URL',
      ] as const) {
        if (!env[key])
          ctx.addIssue({ code: 'custom', path: [key], message: 'required when PHOTO_STORAGE=r2' });
      }
      if (env.NODE_ENV === 'production' && env.R2_PUBLIC_BASE_URL?.startsWith('http:'))
        ctx.addIssue({
          code: 'custom',
          path: ['R2_PUBLIC_BASE_URL'],
          message: 'must use https in production',
        });
    }
    if (env.NODE_ENV === 'production' && env.CORS_ORIGINS.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['CORS_ORIGINS'],
        message: 'CORS_ORIGINS must be set in production',
      });
    }
    const deploy = deployEnvOf(env);
    if (env.NODE_ENV === 'production' && deploy === 'development')
      ctx.addIssue({
        code: 'custom',
        path: ['DEPLOY_ENV'],
        message: 'NODE_ENV=production must be deployed as DEPLOY_ENV=staging or production',
      });
    if (env.NODE_ENV !== 'production' && deploy !== 'development')
      ctx.addIssue({
        code: 'custom',
        path: ['DEPLOY_ENV'],
        message: `DEPLOY_ENV=${deploy} requires NODE_ENV=production (staging must run with production hardening)`,
      });
    if (env.NODE_ENV === 'production') productionIssues(env, ctx);
  })
  .transform((env) => ({
    ...env,
    AUTH_REQUIRE_VERIFICATION: env.AUTH_REQUIRE_VERIFICATION ?? env.NODE_ENV === 'production',
  }));

export const workerEnvSchema = baseServerEnvSchema.extend({
  WORKER_NAME: z.string().min(1).default('farmplus-worker'),
  /** Optional liveness endpoint for the worker's orchestrator (GET /health). Unset = no HTTP listener. */
  WORKER_HEALTH_PORT: port.optional(),
});

/**
 * Environment for database operations (index management, migrations, backup/restore): only what they need, so a
 * maintenance job is not handed application secrets (JWT keys, provider tokens) it has no use for. Production
 * hardening applies to the connection string exactly as for the API.
 */
export const dbOpsEnvSchema = baseServerEnvSchema
  .extend({
    MONGODB_URI: z
      .string()
      .regex(/^mongodb(\+srv)?:\/\//, 'must start with mongodb:// or mongodb+srv://'),
    /** Optional AES-256 key (32 bytes, base64) that encrypts backup files at rest. */
    BACKUP_ENCRYPTION_KEY: aes256Key.optional(),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production')
      for (const message of mongoUriIssues(env.MONGODB_URI))
        ctx.addIssue({ code: 'custom', path: ['MONGODB_URI'], message });
  });
export type DbOpsEnv = z.infer<typeof dbOpsEnvSchema>;

export type ApiEnv = z.infer<typeof apiEnvSchema>;
export type WorkerEnv = z.infer<typeof workerEnvSchema>;

export class EnvValidationError extends Error {
  constructor(readonly issues: string[]) {
    super(`Invalid environment configuration:\n${issues.map((i) => `  - ${i}`).join('\n')}`);
    this.name = 'EnvValidationError';
  }
}

export function parseEnv<S extends z.ZodType>(schema: S, source: NodeJS.ProcessEnv): z.output<S> {
  const result = schema.safeParse(source);
  if (!result.success) {
    throw new EnvValidationError(
      result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
    );
  }
  return result.data;
}

export function loadApiEnv(env: NodeJS.ProcessEnv = process.env): ApiEnv {
  loadEnvFiles(env);
  return parseEnv(apiEnvSchema, env);
}

export function loadDbOpsEnv(env: NodeJS.ProcessEnv = process.env): DbOpsEnv {
  loadEnvFiles(env);
  return parseEnv(dbOpsEnvSchema, env);
}

export function loadWorkerEnv(env: NodeJS.ProcessEnv = process.env): WorkerEnv {
  loadEnvFiles(env);
  return parseEnv(workerEnvSchema, env);
}
