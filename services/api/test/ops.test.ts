/* eslint-disable @typescript-eslint/no-explicit-any -- response bodies are inspected loosely in tests */
import mongoose from 'mongoose';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { apiEnvSchema, parseEnv } from '@farmplus/config/server';
import { createApp } from '../src/app';
import { setErrorReporter } from '../src/lib/error-reporter';
import { lifecycle } from '../src/lib/lifecycle';
import { configureLogger, logger, maskText, redact } from '../src/lib/logger';
import { Session } from '../src/models';
import { createUser, startHarness, type TestHarness } from './helpers';

let h: TestHarness;
const lines: Record<string, any>[] = [];
beforeAll(async () => {
  h = await startHarness();
  configureLogger({ level: 'debug', sink: (_l, line) => lines.push(JSON.parse(line)) });
});
afterAll(async () => {
  configureLogger({ level: 'info', sink: null });
  await h.stop();
});
afterEach(() => {
  lines.length = 0;
  lifecycle.reset();
  setErrorReporter(null);
  vi.restoreAllMocks();
});

describe('structured logging', () => {
  it('writes one JSON object per line with level, time and message', () => {
    logger.info('hello', { a: 1 });
    expect(lines[0]).toMatchObject({ level: 'info', msg: 'hello', a: 1 });
    expect(new Date(lines[0]!['ts']).toString()).not.toBe('Invalid Date');
  });

  it('redacts sensitive keys, connection-string passwords and bearer tokens — at any depth', () => {
    logger.error('failed', {
      password: 'hunter2',
      nested: { authorization: 'Bearer abcdefghijklmnop', apiKey: 'k-123', ok: 'visible' },
      headers: { cookie: 's=1' },
      text: 'connect to mongodb+srv://app:SuperSecretPw@cluster0.x.mongodb.net/db failed; sent Bearer eyJhbGciOiJIUzI1NiJ9.abc.def',
      list: [{ token: 't' }],
      error: new Error('could not reach mongodb://u:pw12345@h:27017/db'),
    });
    const out = JSON.stringify(lines[0]);
    for (const secret of [
      'hunter2',
      'abcdefghijklmnop',
      'k-123',
      's=1',
      'SuperSecretPw',
      'eyJhbGci',
      'pw12345',
    ])
      expect(out, secret).not.toContain(secret);
    expect(out).toContain('visible');
    expect(lines[0]!['nested'].authorization).toBe('[redacted]');
    expect(lines[0]!['error'].message).toContain('mongodb://u:[redacted]@h');
  });

  it('honours the level threshold and never throws into the caller', () => {
    configureLogger({ level: 'warn' });
    logger.info('quiet');
    logger.warn('loud');
    expect(lines.map((l) => l['msg'])).toEqual(['loud']);
    configureLogger({
      level: 'debug',
      sink: () => {
        throw new Error('disk full');
      },
    });
    expect(() => logger.error('x')).not.toThrow();
    configureLogger({ sink: (_l, line) => lines.push(JSON.parse(line)) });
    expect(maskText('plain')).toBe('plain');
    expect(redact('a')).toBe('a');
  });

  it('child loggers carry their context', () => {
    logger.child({ job: 'cleanup' }).info('done', { n: 2 });
    expect(lines[0]).toMatchObject({ job: 'cleanup', n: 2 });
  });
});

describe('request ids and the access log', () => {
  it('assigns an id, returns it, and logs one line without bodies, headers or query strings', async () => {
    const res = await request(h.app)
      .post('/api/v1/auth/login?token=URLSECRET')
      .set('authorization', 'Bearer should-never-be-logged-123')
      .send({ identifier: 'nobody@example.test', password: 'BodySecret-123' });
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    const access = lines.filter((l) => l['msg'] === 'request rejected' || l['msg'] === 'request');
    expect(access).toHaveLength(1);
    expect(access[0]).toMatchObject({
      method: 'POST',
      path: '/api/v1/auth/login',
      status: res.status,
      requestId: res.headers['x-request-id'],
    });
    expect(typeof access[0]!['durationMs']).toBe('number');
    const out = JSON.stringify(lines);
    for (const s of ['URLSECRET', 'BodySecret', 'should-never-be-logged', 'nobody@example.test'])
      expect(out, s).not.toContain(s);
  });

  it('keeps a caller-supplied id only when it is a harmless token (no log forging)', async () => {
    const ok = await request(h.app).get('/api/v1/health').set('x-request-id', 'trace-1234-abcd');
    expect(ok.headers['x-request-id']).toBe('trace-1234-abcd');
    for (const bad of ['short', 'has space in it 123', 'line\\nbreak-injection', 'x'.repeat(100)]) {
      const res = await request(h.app).get('/api/v1/health').set('x-request-id', bad);
      expect(res.headers['x-request-id']).not.toBe(bad);
      expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    }
  });

  it('does not log health or readiness probes, and includes the user id once authenticated', async () => {
    await request(h.app).get('/health');
    await request(h.app).get('/ready');
    await request(h.app).get('/api/v1/health');
    expect(lines.filter((l) => l['msg'].startsWith('request'))).toHaveLength(0);
    const u = await createUser(h.app);
    lines.length = 0;
    await request(h.app).get('/api/v1/auth/me').set(u.auth);
    expect(lines.find((l) => l['path'] === '/api/v1/auth/me')).toMatchObject({
      userId: u.id,
      status: 200,
    });
  });
});

describe('error reporting', () => {
  it('shows the client a generic 500 with a request id, and reports the real error with context but no secrets', async () => {
    const u = await createUser(h.app);
    const reported: any[] = [];
    setErrorReporter((error, context) => reported.push({ error, context }));
    vi.spyOn(Session, 'findById').mockRejectedValue(
      new Error('db exploded: mongodb://svc:TopSecret99@h/db'),
    );
    const res = await request(h.app).get('/api/v1/auth/me?x=1').set(u.auth);
    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    });
    expect(JSON.stringify(res.body)).not.toMatch(/exploded|stack|TopSecret/);
    expect(reported).toHaveLength(1);
    expect(reported[0].context).toMatchObject({
      requestId: res.headers['x-request-id'],
      method: 'GET',
      route: '/api/v1/auth/me',
      status: 500,
      source: 'http',
    });
    const failed = lines.find((l) => l['msg'] === 'request failed');
    expect(failed).toMatchObject({ status: 500 });
  });

  it('the default reporter logs a structured error (with the password masked) and a broken reporter cannot hide the error', async () => {
    const u = await createUser(h.app);
    vi.spyOn(Session, 'findById').mockRejectedValue(
      new Error('boom mongodb://svc:TopSecret99@h/db'),
    );
    await request(h.app).get('/api/v1/auth/me').set(u.auth);
    const entry = lines.find((l) => l['msg'] === 'unhandled error');
    expect(entry).toMatchObject({ level: 'error', source: 'http', status: 500 });
    expect(JSON.stringify(entry)).not.toContain('TopSecret99');
    expect(entry!['requestId']).toBeTruthy();
    lines.length = 0;
    setErrorReporter(() => {
      throw new Error('reporter down');
    });
    await request(h.app).get('/api/v1/auth/me').set(u.auth);
    expect(lines.some((l) => l['msg'] === 'unhandled error')).toBe(true);
  });
});

describe('liveness and readiness', () => {
  it('/health is cheap, dependency-free and identifies the build', async () => {
    const env = { ...h.env, GIT_SHA: 'abc1234' };
    const app = createApp(env, {
      video: h.video,
      payments: h.payments,
      ai: h.ai,
      notifier: h.notifier,
    });
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: 'ok',
      service: 'farmplus-api',
      environment: 'test',
      deployment: 'development',
      commit: 'abc1234',
    });
    expect((await request(app).get('/api/v1/health')).body.status).toBe('ok');
    const state = vi.spyOn(mongoose.connection, 'readyState', 'get').mockReturnValue(0);
    try {
      expect((await request(app).get('/health')).status).toBe(200); // liveness never depends on the database
    } finally {
      state.mockRestore();
    }
  });

  it('/ready is 200 with a live database and reveals only up/down', async () => {
    const res = await request(h.app).get('/ready');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: 'ready',
      checks: { database: 'up', shuttingDown: false },
    });
    expect((await request(h.app).get('/api/v1/ready')).status).toBe(200);
  });

  it('/ready is 503 when the database is down or unresponsive, without leaking why', async () => {
    const state = vi.spyOn(mongoose.connection, 'readyState', 'get').mockReturnValue(0);
    try {
      const res = await request(h.app).get('/ready');
      expect(res.status).toBe(503);
      expect(res.body).toMatchObject({ status: 'not_ready', checks: { database: 'down' } });
      expect(JSON.stringify(res.body)).not.toMatch(/mongo|error|host/i);
    } finally {
      state.mockRestore();
    }
    const admin = vi
      .spyOn(mongoose.connection.db!, 'admin')
      .mockReturnValue({ ping: () => Promise.reject(new Error('socket closed')) } as never);
    try {
      const res = await request(h.app).get('/ready');
      expect(res.status).toBe(503);
      expect(res.body.checks.database).toBe('down');
    } finally {
      admin.mockRestore();
    }
  });

  it('/ready turns 503 as soon as shutdown begins, while /health stays 200, so traffic drains first', async () => {
    lifecycle.beginShutdown();
    const ready = await request(h.app).get('/ready');
    expect(ready.status).toBe(503);
    expect(ready.body.checks).toMatchObject({ database: 'up', shuttingDown: true });
    expect((await request(h.app).get('/health')).status).toBe(200);
  });
});

describe('transport security, CORS and headers in production', () => {
  const prod = parseEnv(apiEnvSchema, {
    NODE_ENV: 'production',
    DEPLOY_ENV: 'staging',
    MONGODB_URI: 'mongodb+srv://farmplus_api:Zq8vK2mPx@cluster0.abcde.mongodb.net/farmplus',
    JWT_ACCESS_SECRET: 'kJ8s0Qw3mZx9Lp2Vn7TaYb5RcD1eHf4GuIo6WiXtB0AyNhCq',
    MFA_ENCRYPTION_KEY: Buffer.from('0123456789abcdef0123456789ABCDEF').toString('base64'),
    CORS_ORIGINS: 'https://app.example.com',
    TRUST_PROXY: '1',
    VIDEO_PROVIDER: 'cloudflare',
    CLOUDFLARE_ACCOUNT_ID: 'acc',
    CLOUDFLARE_STREAM_API_TOKEN: 'token',
    CLOUDFLARE_STREAM_CUSTOMER_CODE: 'code',
    VIDEO_WEBHOOK_SECRET: 'w'.repeat(20),
  });
  let app: ReturnType<typeof createApp>;
  beforeAll(() => {
    app = createApp(prod, {
      video: h.video,
      payments: null,
      ai: null,
      shipping: null,
      notifier: h.notifier,
    });
  });
  const tls = { 'x-forwarded-proto': 'https' };

  it('redirects plain-HTTP reads to HTTPS, refuses plain-HTTP writes, and lets probes through', async () => {
    const get = await request(app).get('/api/v1/auth/me?a=1').set('host', 'api.example.com');
    expect(get.status).toBe(308);
    expect(get.headers['location']).toBe('https://api.example.com/api/v1/auth/me?a=1');
    const post = await request(app)
      .post('/api/v1/auth/login')
      .set('host', 'api.example.com')
      .send({ identifier: 'a', password: 'b' });
    expect(post.status).toBe(400);
    expect(post.body.error.code).toBe('HTTPS_REQUIRED');
    expect(post.headers['location']).toBeUndefined();
    expect((await request(app).get('/health')).status).toBe(200);
    expect([200, 503]).toContain((await request(app).get('/ready')).status);
    const odd = await request(app).get('/api/v1/health').set('host', 'evil.example.com/../x');
    expect(odd.status).not.toBe(308);
  });

  it('serves HTTPS requests with HSTS and the security headers; API responses are never cacheable', async () => {
    const res = await request(app).get('/api/v1/health').set(tls);
    expect(res.status).toBe(200);
    expect(res.headers['strict-transport-security']).toBe('max-age=15552000; includeSubDomains');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['x-frame-options']).toBeTruthy();
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.deployment).toBe('staging');
    expect(
      (await request(h.app).get('/api/v1/health')).headers['strict-transport-security'],
    ).toBeUndefined(); // not in development
  });

  it('allows exactly the configured origin, never wildcards or credentials', async () => {
    const allowed = await request(app)
      .get('/api/v1/health')
      .set(tls)
      .set('origin', 'https://app.example.com');
    expect(allowed.headers['access-control-allow-origin']).toBe('https://app.example.com');
    expect(allowed.headers['access-control-allow-credentials']).toBeUndefined();
    expect(allowed.headers['access-control-expose-headers']).toMatch(
      /X-Request-Id.*X-Export-Truncated.*Content-Disposition/i,
    );
    for (const origin of [
      'https://evil.example.com',
      'http://app.example.com',
      'https://app.example.com.evil.com',
      'null',
    ]) {
      const res = await request(app).get('/api/v1/health').set(tls).set('origin', origin);
      expect(res.headers['access-control-allow-origin'], origin).toBeUndefined();
    }
  });

  it('answers preflights with only the methods and headers the clients use', async () => {
    const pre = await request(app)
      .options('/api/v1/orders')
      .set(tls)
      .set('origin', 'https://app.example.com')
      .set('access-control-request-method', 'POST')
      .set('access-control-request-headers', 'authorization,content-type,idempotency-key');
    expect(pre.status).toBe(204);
    expect(pre.headers['access-control-allow-methods']).toBe('GET,POST,PUT,PATCH,DELETE');
    expect(pre.headers['access-control-allow-headers']).toMatch(
      /Authorization.*Content-Type.*Idempotency-Key/i,
    );
    expect(pre.headers['access-control-max-age']).toBe('600');
    const evil = await request(app)
      .options('/api/v1/orders')
      .set(tls)
      .set('origin', 'https://evil.example.com')
      .set('access-control-request-method', 'POST');
    expect(evil.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('keeps the dev media endpoints and mock providers out of production', async () => {
    expect((await request(app).get('/api/v1/media/dev/anything').set(tls)).status).toBe(404);
  });
});
