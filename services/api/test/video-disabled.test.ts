import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiEnvSchema, parseEnv, productionWarnings } from '@farmplus/config/server';
import { Media } from '../src/models';
import { DisabledVideoProvider, createVideoProvider } from '../src/modules/media/provider';
import { createUser, startHarness, testEnv, type Session, type TestHarness } from './helpers';
import { API, videoBody } from './video-helpers';

/** VIDEO_PROVIDER=none: a deployment without a streaming account. Everything except creating video/live works. */
let h: TestHarness;
let alice: Session;

beforeAll(async () => {
  h = await startHarness({ VIDEO_PROVIDER: 'none' });
  alice = await createUser(h.app);
});
afterAll(async () => {
  await h.stop();
});

describe('VIDEO_PROVIDER=none', () => {
  it('uses the disabled provider', () => {
    expect(h.video).toBeInstanceOf(DisabledVideoProvider);
    expect(
      createVideoProvider(testEnv('mongodb://127.0.0.1/x', { VIDEO_PROVIDER: 'none' })).name,
    ).toBe('none');
  });

  it('refuses new uploads and live streams with a stable code, and records nothing', async () => {
    const before = await Media.countDocuments();
    const upload = await request(h.app)
      .post(`${API}/videos/uploads`)
      .set(alice.auth)
      .send(videoBody());
    expect(upload.status).toBe(503);
    expect(upload.body.error.code).toBe('VIDEO_NOT_CONFIGURED');
    const live = await request(h.app).post(`${API}/live`).set(alice.auth).send({ title: 'Hi' });
    expect(live.status).toBe(503);
    expect(live.body.error.code).toBe('VIDEO_NOT_CONFIGURED');
    expect(await Media.countDocuments()).toBe(before);
  });

  it('still requires sign-in first (no information to anonymous callers)', async () => {
    expect((await request(h.app).post(`${API}/videos/uploads`).send(videoBody())).status).toBe(401);
  });

  it('lists keep working (empty), and webhooks are rejected', async () => {
    const feed = await request(h.app).get(`${API}/videos`).set(alice.auth);
    expect(feed.status).toBe(200);
    const hook = await request(h.app)
      .post(`${API}/webhooks/video`)
      .set('content-type', 'application/json')
      .send('{"uid":"x"}');
    expect(hook.status).toBe(401);
  });

  it('is allowed with production hardening (unlike mock) and only warns', () => {
    const env = parseEnv(apiEnvSchema, {
      NODE_ENV: 'production',
      DEPLOY_ENV: 'staging',
      TRUST_PROXY: '1',
      RATE_LIMIT_ENABLED: 'true',
      CORS_ORIGINS: 'https://farmplus-web-staging.pages.dev',
      MONGODB_URI: 'mongodb+srv://farmplus_api:Zq8vK2mPx9@cluster0.abcde.mongodb.net/farmplus',
      JWT_ACCESS_SECRET: randomBytes(48).toString('base64'),
      MFA_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
      VIDEO_PROVIDER: 'none',
      SHIPPING_PROVIDER: 'none',
      PAYMENT_PROVIDER: 'none',
      AI_PROVIDER: 'none',
    });
    expect(env.VIDEO_PROVIDER).toBe('none');
    expect(productionWarnings(env).join('\n')).toMatch(/VIDEO_PROVIDER=none/);
  });
});
