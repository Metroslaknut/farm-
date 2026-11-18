/* eslint-disable @typescript-eslint/no-explicit-any -- provider payloads are loosely typed on purpose */
import { describe, expect, it, vi } from 'vitest';
import { apiEnvSchema, parseEnv } from '@farmplus/config/server';
import {
  CloudflareStreamProvider,
  MockVideoProvider,
  ProviderError,
  WebhookAuthError,
  signWebhook,
} from '../src/modules/media/provider';

const SECRET = 'cf-webhook-secret-for-tests-1234';
const cfg = {
  accountId: 'acc123',
  apiToken: 'cf-token-SECRET',
  customerCode: 'abc',
  webhookSecret: SECRET,
};

const respond = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
function provider(handler: (url: string, init: any) => Response) {
  const fetchMock = vi.fn(async (url: string, init: any) => handler(String(url), init));
  return {
    cf: new CloudflareStreamProvider({ ...cfg, fetch: fetchMock as unknown as typeof fetch }),
    fetchMock,
  };
}
const signed = (body: object, time = Math.floor(Date.now() / 1000), secret = SECRET) => {
  const raw = Buffer.from(JSON.stringify(body));
  return {
    raw,
    headers: { 'webhook-signature': `time=${time},sig1=${signWebhook(secret, time, raw)}` },
  };
};

describe('Cloudflare Stream adapter (requests)', () => {
  it('creates a direct upload with a server-side token, signed URLs required and the creator recorded', async () => {
    const { cf, fetchMock } = provider(() =>
      respond(200, {
        success: true,
        result: { uploadURL: 'https://upload.example/x', uid: 'vid1' },
      }),
    );
    const up = await cf.createDirectUpload({
      videoId: 'v1',
      creatorId: 'u1',
      maxBytes: 10,
      maxDurationSeconds: 60,
      expiresAt: new Date('2030-01-01T00:00:00Z'),
    });
    expect(up).toEqual({
      providerAssetId: 'vid1',
      url: 'https://upload.example/x',
      method: 'POST',
      encoding: 'multipart',
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, any];
    expect(url).toBe('https://api.cloudflare.com/client/v4/accounts/acc123/stream/direct_upload');
    expect(init.headers.authorization).toBe('Bearer cf-token-SECRET');
    expect(JSON.parse(init.body)).toMatchObject({
      maxDurationSeconds: 60,
      requireSignedURLs: true,
      creator: 'u1',
      expiry: '2030-01-01T00:00:00.000Z',
    });
  });

  it('never leaks the token or the provider error body in thrown errors', async () => {
    const { cf } = provider(() =>
      respond(500, { success: false, errors: [{ message: 'secret-detail cf-token-SECRET' }] }),
    );
    const err = await cf.createLiveInput({ liveId: 'l', title: 't' }).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(String(err.message)).not.toMatch(/SECRET|secret-detail/);
    const down = new CloudflareStreamProvider({
      ...cfg,
      fetch: (async () => {
        throw new Error('ECONNREFUSED cf-token-SECRET');
      }) as unknown as typeof fetch,
    });
    const e2 = await down.getAsset('x').catch((e) => e);
    expect(e2).toBeInstanceOf(ProviderError);
    expect(String(e2.message)).not.toContain('SECRET');
  });

  it('maps asset states, failure codes and a missing asset (404 → null)', async () => {
    const bodies: Record<string, unknown> = {
      pending: { uid: 'a', status: { state: 'pendingupload' } },
      busy: { uid: 'b', status: { state: 'inprogress' } },
      ready: {
        uid: 'c',
        readyToStream: true,
        duration: 9.5,
        size: 123,
        input: { width: 720, height: 1280 },
        status: { state: 'ready' },
      },
      long: {
        uid: 'd',
        status: {
          state: 'error',
          errorReasonCode: 'ERR_DURATION_EXCEED_CONSTRAINT',
          errorReasonText: 'too long',
        },
      },
      weird: { uid: 'e', status: { state: 'error', errorReasonCode: 'ERR_SOMETHING_NEW' } },
    };
    const { cf } = provider((url) => {
      const id = url.split('/stream/')[1]!;
      const key = { a: 'pending', b: 'busy', c: 'ready', d: 'long', e: 'weird' }[id as 'a'];
      return key
        ? respond(200, { success: true, result: bodies[key] })
        : respond(404, { success: false });
    });
    expect(await cf.getAsset('a')).toMatchObject({ state: 'pending_upload' });
    expect(await cf.getAsset('b')).toMatchObject({ state: 'processing' });
    expect(await cf.getAsset('c')).toMatchObject({
      state: 'ready',
      durationSeconds: 9.5,
      width: 720,
      height: 1280,
      sizeBytes: 123,
    });
    expect(await cf.getAsset('d')).toMatchObject({
      state: 'failed',
      failure: { code: 'too_long' },
    });
    expect(await cf.getAsset('e')).toMatchObject({
      state: 'failed',
      failure: { code: 'processing_failed' },
    });
    expect(await cf.getAsset('zzz')).toBeNull();
  });

  it('returns a tokenised playback URL on the customer domain', async () => {
    const { cf, fetchMock } = provider(() =>
      respond(200, { success: true, result: { token: 'TOK' } }),
    );
    const p = await cf.signedPlayback({ kind: 'asset', providerId: 'vid1' }, 600);
    expect(p.url).toBe('https://customer-abc.cloudflarestream.com/TOK/manifest/video.m3u8');
    expect(p.thumbnailUrl).toContain('/TOK/thumbnails/');
    expect(p.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(JSON.parse((fetchMock.mock.calls[0] as any)[1].body).exp).toBeGreaterThan(
      Date.now() / 1000,
    );
  });

  it('delete treats 404 as success; live input exposes the stream key only on read', async () => {
    const { cf } = provider((url, init) =>
      init.method === 'DELETE'
        ? respond(404, { success: false })
        : respond(200, {
            success: true,
            result: { uid: 'in1', rtmps: { url: 'rtmps://live.example/live/', streamKey: 'KEY' } },
          }),
    );
    await expect(cf.deleteAsset('gone')).resolves.toBeUndefined();
    await expect(cf.deleteLiveInput('gone')).resolves.toBeUndefined();
    expect(await cf.getLiveInput('in1')).toEqual({
      providerInputId: 'in1',
      rtmpsUrl: 'rtmps://live.example/live/',
      streamKey: 'KEY',
    });
  });
});

describe('webhook authentication (Cloudflare adapter)', () => {
  const { cf } = provider(() => respond(200, {}));
  const ready = { uid: 'vid1', readyToStream: true, status: { state: 'ready' } };

  it('accepts a correctly signed event and normalises it', () => {
    const { raw, headers } = signed(ready);
    expect(cf.parseWebhook(raw, headers)).toMatchObject({
      type: 'asset.updated',
      asset: { providerAssetId: 'vid1', state: 'ready' },
    });
  });

  it('rejects missing, wrong, tampered, replayed and future-dated signatures', () => {
    const { raw, headers } = signed(ready);
    expect(() => cf.parseWebhook(raw, {})).toThrow(WebhookAuthError);
    expect(() => cf.parseWebhook(raw, { 'webhook-signature': 'time=1,sig1=abc' })).toThrow(
      WebhookAuthError,
    );
    expect(() =>
      cf.parseWebhook(Buffer.from(JSON.stringify({ ...ready, uid: 'other' })), headers),
    ).toThrow(WebhookAuthError);
    const old = signed(ready, Math.floor(Date.now() / 1000) - 3600);
    expect(() => cf.parseWebhook(old.raw, old.headers)).toThrow(WebhookAuthError);
    const future = signed(ready, Math.floor(Date.now() / 1000) + 3600);
    expect(() => cf.parseWebhook(future.raw, future.headers)).toThrow(WebhookAuthError);
    const wrong = signed(ready, undefined, 'another-secret-another-secret');
    expect(() => cf.parseWebhook(wrong.raw, wrong.headers)).toThrow(WebhookAuthError);
  });

  it('notification-channel events authenticate with the shared secret header and map live events', () => {
    const body = Buffer.from(
      JSON.stringify({
        name: 'Stream Live Input',
        data: { event_type: 'live_input.connected', input_id: 'in1' },
      }),
    );
    expect(cf.parseWebhook(body, { 'cf-webhook-auth': SECRET })).toEqual({
      type: 'live.connected',
      providerInputId: 'in1',
    });
    expect(() => cf.parseWebhook(body, { 'cf-webhook-auth': 'nope' })).toThrow(WebhookAuthError);
    const dis = Buffer.from(
      JSON.stringify({ data: { event_type: 'live_input.disconnected', input_id: 'in1' } }),
    );
    expect(cf.parseWebhook(dis, { 'cf-webhook-auth': SECRET })).toEqual({
      type: 'live.disconnected',
      providerInputId: 'in1',
    });
  });

  it('unknown payloads are ignored (after authentication), garbage is never executed', () => {
    const odd = signed({ hello: 'world' });
    expect(cf.parseWebhook(odd.raw, odd.headers)).toMatchObject({ type: 'ignored' });
    const t = Math.floor(Date.now() / 1000);
    const raw = Buffer.from('{{{');
    expect(
      cf.parseWebhook(raw, {
        'webhook-signature': `time=${t},sig1=${signWebhook(SECRET, t, raw)}`,
      }),
    ).toMatchObject({ type: 'ignored' });
  });
});

describe('mock provider', () => {
  it('uses the same signature scheme; file links are signed and expire', async () => {
    const m = new MockVideoProvider(SECRET);
    const body = { type: 'live.connected', providerInputId: 'x' };
    const { raw, headers } = signed(body);
    expect(m.parseWebhook(raw, headers)).toEqual({ type: 'live.connected', providerInputId: 'x' });
    expect(() => m.parseWebhook(raw, {})).toThrow(WebhookAuthError);
    const up = await m.createDirectUpload({
      videoId: 'v',
      creatorId: 'u',
      maxBytes: 100,
      maxDurationSeconds: 10,
      expiresAt: new Date(Date.now() + 60_000),
    });
    const id = up.providerAssetId;
    expect(m.receiveUpload(id, Buffer.from('abc'), 'video/mp4').state).toBe('ready');
    expect(() => m.receiveUpload(id, Buffer.from('abc'), 'video/mp4')).toThrow(ProviderError);
    const pb = await m.signedPlayback({ kind: 'asset', providerId: id }, 60);
    const exp = Number(/exp=(\d+)/.exec(pb.url)![1]);
    const token = /token=([0-9a-f]+)/.exec(pb.url)![1]!;
    expect(m.verifyFileToken(id, exp, token)).toBe(true);
    expect(m.verifyFileToken('other', exp, token)).toBe(false);
    expect(m.verifyFileToken(id, exp - 1000, token)).toBe(false);
  });
});

describe('video environment configuration', () => {
  const base = {
    NODE_ENV: 'production',
    MONGODB_URI: 'mongodb+srv://farmplus_app:Zq8vK2mPx9@cluster0.abcde.mongodb.net/farmplus',
    JWT_ACCESS_SECRET: 'kJ8s0Qw3mZx9Lp2Vn7TaYb5RcD1eHf4GuIo6WiXtB0AyNhCq',
    MFA_ENCRYPTION_KEY: Buffer.from('0123456789abcdef0123456789ABCDEF').toString('base64'),
    CORS_ORIGINS: 'https://app.example.com',
    TRUST_PROXY: '1',
  };
  it('refuses the mock provider in production', () => {
    expect(() => parseEnv(apiEnvSchema, { ...base, VIDEO_PROVIDER: 'mock' })).toThrow(
      /mock video provider/,
    );
    expect(() => parseEnv(apiEnvSchema, base)).toThrow(/mock video provider/); // default is mock
  });
  it('refuses the mock shipping provider in production and weak webhook secrets', () => {
    const video = {
      VIDEO_PROVIDER: 'cloudflare',
      CLOUDFLARE_ACCOUNT_ID: 'a',
      CLOUDFLARE_STREAM_API_TOKEN: 't',
      CLOUDFLARE_STREAM_CUSTOMER_CODE: 'c',
      VIDEO_WEBHOOK_SECRET: 'w'.repeat(20),
    };
    expect(() => parseEnv(apiEnvSchema, { ...base, ...video, SHIPPING_PROVIDER: 'mock' })).toThrow(
      /mock shipping provider/,
    );
    expect(parseEnv(apiEnvSchema, { ...base, ...video }).SHIPPING_PROVIDER).toBe('none');
    expect(() => parseEnv(apiEnvSchema, { ...base, ...video, PAYMENT_PROVIDER: 'mock' })).toThrow(
      /mock payment provider/,
    );
    expect(parseEnv(apiEnvSchema, { ...base, ...video }).PAYMENT_PROVIDER).toBe('none');
    for (const key of ['PAYMENT_WEBHOOK_SECRET', 'SHIPPING_WEBHOOK_SECRET'])
      expect(() =>
        parseEnv(apiEnvSchema, { ...base, NODE_ENV: 'development', [key]: 'short' }),
      ).toThrow();
  });
  it('requires every credential for cloudflare', () => {
    expect(() => parseEnv(apiEnvSchema, { ...base, VIDEO_PROVIDER: 'cloudflare' })).toThrow(
      /CLOUDFLARE_ACCOUNT_ID/,
    );
    const ok = parseEnv(apiEnvSchema, {
      ...base,
      VIDEO_PROVIDER: 'cloudflare',
      CLOUDFLARE_ACCOUNT_ID: 'a',
      CLOUDFLARE_STREAM_API_TOKEN: 't',
      CLOUDFLARE_STREAM_CUSTOMER_CODE: 'c',
      VIDEO_WEBHOOK_SECRET: 'w'.repeat(20),
    });
    expect(ok.VIDEO_PROVIDER).toBe('cloudflare');
  });
  it('rejects a weak webhook secret and silly limits', () => {
    expect(() =>
      parseEnv(apiEnvSchema, { ...base, NODE_ENV: 'development', VIDEO_WEBHOOK_SECRET: 'short' }),
    ).toThrow();
    expect(() =>
      parseEnv(apiEnvSchema, { ...base, NODE_ENV: 'development', VIDEO_MAX_UPLOAD_MB: '99999' }),
    ).toThrow();
  });
});
