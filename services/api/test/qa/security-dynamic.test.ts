/* eslint-disable @typescript-eslint/no-explicit-any -- responses are inspected loosely in tests */
import request from 'supertest';
import { Types } from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WEBHOOK_TOLERANCE_SECONDS, signWebhook } from '../../src/modules/media/provider/signature';
import { AuditLog, FinancialAuditLog, Role, User, UserRole } from '../../src/models';
import {
  createFarmer,
  createStaff,
  createUser,
  login,
  makeFarm,
  PASSWORD,
  register,
  PAYMENT_SECRET,
  SHIPPING_SECRET,
  startHarness,
  WEBHOOK_SECRET,
  type TestHarness,
} from '../helpers';
import { findSecrets } from './secret-scan';

let h: TestHarness;
let hLimited: TestHarness;
let hProxy: TestHarness;
let hMedia: TestHarness;
beforeAll(async () => {
  h = await startHarness();
  hLimited = await startHarness({ RATE_LIMIT_ENABLED: 'true' });
  hProxy = await startHarness({ RATE_LIMIT_ENABLED: 'true', TRUST_PROXY: '1' });
  hMedia = await startHarness({ MEDIA_ALLOWED_HOSTS: 'cdn.example.com' });
});
afterAll(async () => {
  await hMedia.stop();
  await hProxy.stop();
  await hLimited.stop();
  await h.stop();
});
const api = (app = h.app) => ({
  get: (p: string) => request(app).get(`/api/v1${p}`),
  post: (p: string) => request(app).post(`/api/v1${p}`),
});

// ---------------------------------------------------------------------------------------------------------------------
describe('webhook signature verification (video, payments, shipping)', () => {
  const ENDPOINTS: [string, string, string][] = [
    ['video', '/api/v1/webhooks/video', WEBHOOK_SECRET],
    ['payments', '/api/v1/webhooks/payments', PAYMENT_SECRET],
    ['shipping', '/api/v1/webhooks/shipping', SHIPPING_SECRET],
  ];
  const event = JSON.stringify({ id: 'evt_qa_1', type: 'noop.event', data: { ref: 'unknown' } });
  const now = () => Math.floor(Date.now() / 1000);
  const post = (path: string, body: string, headers: Record<string, string>) => {
    const r = request(h.app).post(path).set('content-type', 'application/json');
    for (const [k, v] of Object.entries(headers)) r.set(k, v);
    return r.send(body);
  };
  const header = (secret: string, time: number, body: string) =>
    `time=${time},sig1=${signWebhook(secret, time, body)}`;

  it.each(ENDPOINTS)(
    '%s: every way of getting the signature wrong is refused with 401 and audited',
    async (_name, path, secret) => {
      const before = await AuditLog.countDocuments({ action: 'webhook.rejected' });
      const t = now();
      const cases: [string, Record<string, string>, string][] = [
        ['no header', {}, event],
        ['empty header', { 'webhook-signature': '' }, event],
        ['garbage header', { 'webhook-signature': 'hello' }, event],
        ['missing sig', { 'webhook-signature': `time=${t}` }, event],
        ['missing time', { 'webhook-signature': `sig1=${signWebhook(secret, t, event)}` }, event],
        [
          'non-numeric time',
          { 'webhook-signature': `time=abc,sig1=${signWebhook(secret, t, event)}` },
          event,
        ],
        [
          'fractional time',
          { 'webhook-signature': `time=${t}.5,sig1=${signWebhook(secret, t, event)}` },
          event,
        ],
        [
          'wrong secret',
          { 'webhook-signature': header('another-secret-another-secret-1', t, event) },
          event,
        ],
        ['empty secret', { 'webhook-signature': header('', t, event) }, event],
        [
          'tampered body',
          { 'webhook-signature': header(secret, t, event) },
          event.replace('noop', 'evil'),
        ],
        [
          'signature of a different timestamp',
          { 'webhook-signature': `time=${t - 1},sig1=${signWebhook(secret, t, event)}` },
          event,
        ],
        [
          'too old (replay)',
          { 'webhook-signature': header(secret, t - WEBHOOK_TOLERANCE_SECONDS - 5, event) },
          event,
        ],
        [
          'too far in the future',
          { 'webhook-signature': header(secret, t + WEBHOOK_TOLERANCE_SECONDS + 5, event) },
          event,
        ],
        [
          'truncated signature',
          { 'webhook-signature': `time=${t},sig1=${signWebhook(secret, t, event).slice(0, 20)}` },
          event,
        ],
        [
          'uppercase hex is not "equal enough"',
          { 'webhook-signature': `time=${t},sig1=${signWebhook(secret, t, event).toUpperCase()}` },
          event,
        ],
      ];
      for (const [name, headers, body] of cases) {
        const res = await post(path, body, headers);
        expect(res.status, name).toBe(401);
        expect(res.body.error.code, name).toBe('INVALID_SIGNATURE');
      }
      expect(await AuditLog.countDocuments({ action: 'webhook.rejected' })).toBeGreaterThanOrEqual(
        before + cases.length,
      );
    },
  );

  it.each(ENDPOINTS)(
    '%s: a correctly signed request is accepted (and malformed JSON under a valid signature is a 400, not a crash)',
    async (_name, path, secret) => {
      const t = now();
      const ok = await post(path, event, { 'webhook-signature': header(secret, t, event) });
      expect([200, 202]).toContain(ok.status);
      const bad = '{"id":';
      const res = await post(path, bad, { 'webhook-signature': header(secret, t, bad) });
      // payments/shipping answer 400; the video webhook ignores unparseable notifications. Never a 5xx.
      expect([200, 400]).toContain(res.status);
    },
  );

  // (The video webhook is excluded below: with the development mock provider it has a built-in secret, and production
  // validation makes VIDEO_WEBHOOK_SECRET mandatory whenever the real provider is selected.)
  it.each(ENDPOINTS.filter((e) => e[0] !== 'video'))(
    '%s: the endpoint does not exist while its secret is unset — not even a signature made with an empty secret works',
    async (_name, path) => {
      const { createApp } = await import('../../src/app');
      const env = {
        ...h.env,
        PAYMENT_WEBHOOK_SECRET: undefined,
        SHIPPING_WEBHOOK_SECRET: undefined,
        VIDEO_WEBHOOK_SECRET: undefined,
      } as typeof h.env;
      const app = createApp(env, {
        video: h.video,
        payments: h.payments,
        ai: h.ai,
        notifier: h.notifier,
      });
      const t = now();
      for (const secret of ['', 'undefined', 'null', WEBHOOK_SECRET]) {
        const res = await request(app)
          .post(path)
          .set('content-type', 'application/json')
          .set('webhook-signature', header(secret, t, event))
          .send(event);
        expect(res.status, `secret "${secret}"`).toBe(404);
      }
    },
  );
});

// ---------------------------------------------------------------------------------------------------------------------
describe('media links: only https URLs on allowed hosts, whichever endpoint accepts them', () => {
  const HOSTILE = [
    'http://cdn.example.com/a.jpg',
    'javascript:alert(1)',
    'data:text/html;base64,PHNjcmlwdD4=',
    'file:///etc/passwd',
    'ftp://cdn.example.com/a.jpg',
    '//cdn.example.com/a.jpg',
    'https://evil.example.org/a.jpg',
    'https://cdn.example.com.evil.org/a.jpg',
    'https://evilcdn.example.com/a.jpg',
    'https://cdn.example.com@evil.org/a.jpg',
    'https://evil.org/cdn.example.com/a.jpg',
    'https://evil.org#@cdn.example.com/',
    'https://evil.org?cdn.example.com',
    'https://cdn.example.com.:443@evil.org/',
    'https://xn--cdn-example-9ta.com/a.jpg',
    'https://CDN.EXAMPLE.COM.evil.org/a.jpg',
  ];
  const GOOD = [
    'https://cdn.example.com/a.jpg',
    'https://CDN.Example.com/a.jpg',
    'https://img.cdn.example.com/a.jpg',
    'https://cdn.example.com:8443/a.jpg',
  ];

  it('registration documents (opened by administrators) obey the allow-list — fixed by this audit', async () => {
    for (const url of HOSTILE) {
      const user = await createUser(hMedia.app);
      const res = await request(hMedia.app)
        .post('/api/v1/registrations')
        .set(user.auth)
        .send({ type: 'identity', documents: [{ kind: 'id_card', url }] });
      expect(res.status, url).toBe(400);
    }
    for (const url of GOOD) {
      const user = await createUser(hMedia.app);
      const res = await request(hMedia.app)
        .post('/api/v1/registrations')
        .set(user.auth)
        .send({ type: 'identity', documents: [{ kind: 'id_card', url }] });
      expect(res.status, url).toBe(201);
    }
  });

  it('animal photos and community posts obey the same rules', async () => {
    const owner = await createFarmer(hMedia.app);
    const farmId = await makeFarm(hMedia.app, owner, 'Media Farm');
    const types = await request(hMedia.app).get('/api/v1/animal-types').set(owner.auth);
    const animal = await request(hMedia.app)
      .post(`/api/v1/farms/${farmId}/animals`)
      .set(owner.auth)
      .send({ animalCode: 'M-1', animalTypeId: types.body.animalTypes[0].id, sex: 'male' });
    expect(animal.status, JSON.stringify(animal.body)).toBe(201);
    for (const url of HOSTILE) {
      const photo = await request(hMedia.app)
        .post(`/api/v1/farms/${farmId}/animals/${animal.body.animal.id}/media`)
        .set(owner.auth)
        .send({ kind: 'photo', url });
      expect(photo.status, `animal ${url}`).toBe(400);
      const post = await request(hMedia.app)
        .post('/api/v1/posts')
        .set(owner.auth)
        .send({ body: 'hello', media: [{ kind: 'image', url }] });
      expect(post.status, `post ${url}`).toBe(400);
    }
    const ok = await request(hMedia.app)
      .post(`/api/v1/farms/${farmId}/animals/${animal.body.animal.id}/media`)
      .set(owner.auth)
      .send({ kind: 'photo', url: GOOD[0] });
    expect(ok.status).toBe(201);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('rate limiting', () => {
  it('sign-in is throttled per client; the response says so and tells the client when to retry', async () => {
    const { email } = await register(hLimited.app);
    const statuses: number[] = [];
    let last: request.Response | undefined;
    for (let i = 0; i < 14; i++) {
      last = await api(hLimited.app)
        .post('/auth/login')
        .send({ identifier: email, password: 'wrong-password-123' });
      statuses.push(last.status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 401 || s === 423 || s === 429)).toBe(true);
    expect(statuses).toContain(429);
    expect(last!.body.error.code).toBe('RATE_LIMITED');
    expect(Object.keys(last!.headers).some((k) => k.startsWith('ratelimit'))).toBe(true);
  });

  it('one account being throttled does not lock out other accounts or Google sign-in from the same address (QA #13)', async () => {
    const locked = 'locked-account@example.test';
    for (let i = 0; i < 12; i++)
      await api(hLimited.app)
        .post('/auth/login')
        .send({ identifier: locked, password: 'wrong-password-123' });
    const lockedAgain = await api(hLimited.app)
      .post('/auth/login')
      .send({ identifier: locked.toUpperCase(), password: 'wrong-password-123' });
    expect(lockedAgain.status).toBe(429); // the same account, whatever its case
    const other = await api(hLimited.app)
      .post('/auth/login')
      .send({ identifier: 'someone-else@example.test', password: 'wrong-password-123' });
    expect(other.status).not.toBe(429);
    const google = await api(hLimited.app).get('/auth/oauth/google/start');
    expect(google.status).not.toBe(429);
  });

  it('one address cannot try account after account without limit', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 105; i++)
      codes.push(
        (
          await api(hLimited.app)
            .post('/auth/login')
            .send({ identifier: `spray-${i}@example.test`, password: 'wrong-password-123' })
        ).status,
      );
    expect(codes.slice(-3)).toEqual([429, 429, 429]);
  });

  it('cannot be bypassed by forging X-Forwarded-For when no proxy is trusted', async () => {
    const results: number[] = [];
    for (let i = 0; i < 14; i++) {
      const res = await api(hLimited.app)
        .post('/auth/password/forgot')
        .set('X-Forwarded-For', `203.0.113.${i + 1}`)
        .send({ identifier: 'nobody@example.test' });
      results.push(res.status);
    }
    expect(results).toContain(429); // sensitive endpoints allow 10 per window regardless of the claimed address
  });

  it('with a trusted proxy each real client address has its own budget, and the budget is still enforced per address', async () => {
    const hit = (ip: string) =>
      api(hProxy.app)
        .post('/auth/password/forgot')
        .set('X-Forwarded-For', ip)
        .send({ identifier: 'nobody@example.test' });
    const a = [] as number[];
    for (let i = 0; i < 12; i++) a.push((await hit('198.51.100.7')).status);
    expect(a).toContain(429);
    expect((await hit('198.51.100.8')).status).not.toBe(429); // a different client is unaffected
    expect((await hit('198.51.100.7')).status).toBe(429); // the first stays limited
  });

  it('registration, token refresh and second-factor checks are throttled too', async () => {
    for (const [path, body] of [
      ['/auth/register', { email: 'x', password: 'y' }],
      ['/auth/refresh', { refreshToken: 'nope' }],
      ['/auth/mfa/verify', { mfaToken: 'nope', code: '123456' }],
    ] as const) {
      const codes: number[] = [];
      for (let i = 0; i < 70; i++) {
        codes.push((await api(hLimited.app).post(path).send(body)).status);
        if (codes.at(-1) === 429) break;
      }
      expect(codes, path).toContain(429);
    }
  }, 120_000);
});

// ---------------------------------------------------------------------------------------------------------------------
describe('CSRF: there is no ambient authority to forge', () => {
  it('never sets a cookie, on any authentication response', async () => {
    const { email } = await register(h.app);
    const loginRes = await api()
      .post('/auth/login')
      .send({ identifier: email, password: PASSWORD });
    const session = await login(h.app, email);
    const responses = [
      loginRes,
      await api().get('/auth/me').set(session.auth),
      await api().post('/auth/refresh').send({ refreshToken: session.refreshToken }),
      await request(h.app).get('/api/v1/health'),
    ];
    for (const r of responses) expect(r.headers['set-cookie']).toBeUndefined();
  });

  it('a cross-site request that only carries cookies (what a browser attaches automatically) is unauthenticated', async () => {
    const user = await createUser(h.app);
    for (const [method, path] of [
      ['post', '/api/v1/farms'],
      ['post', '/api/v1/notifications/read-all'],
      ['delete', '/api/v1/shop/cart'],
      ['post', '/api/v1/auth/logout'],
    ] as const) {
      const res = await (request(h.app) as any)
        [method](path)
        .set('Origin', 'https://evil.example.org')
        .set(
          'Cookie',
          `access_token=${user.accessToken}; token=${user.accessToken}; session=${user.refreshToken}`,
        )
        .set('Content-Type', 'text/plain')
        .send('{"name":"x"}');
      expect(res.status, `${method} ${path}`).toBe(401);
    }
    expect((await api().get('/auth/me').set(user.auth)).status).toBe(200); // and the session is untouched
  });

  it('refuses to answer a cross-origin browser: no CORS grant to unlisted origins, no credentials flag', async () => {
    const res = await request(h.app)
      .options('/api/v1/farms')
      .set('Origin', 'https://evil.example.org')
      .set('Access-Control-Request-Method', 'POST');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    expect(res.headers['access-control-allow-credentials']).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('NoSQL / operator injection', () => {
  it('operator objects in credentials are rejected as invalid input, never evaluated', async () => {
    const victim = await register(h.app);
    for (const body of [
      { identifier: { $ne: null }, password: { $ne: null } },
      { identifier: victim.email, password: { $gt: '' } },
      { identifier: { $regex: '.*' }, password: PASSWORD },
      { identifier: { $in: [victim.email] }, password: PASSWORD },
      { email: victim.email, password: { $exists: true } },
    ]) {
      const res = await api().post('/auth/login').send(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body.tokens ?? res.body.accessToken).toBeUndefined();
    }
    expect(
      (
        await api()
          .post('/auth/refresh')
          .send({ refreshToken: { $ne: null } })
      ).status,
    ).toBe(400);
    expect(
      (
        await api()
          .post('/auth/password/reset')
          .send({ token: { $ne: null }, password: 'a-long-new-password-1' })
      ).status,
    ).toBe(400);
    expect(
      (
        await api()
          .post('/auth/verify/email')
          .send({ token: { $gt: '' } })
      ).status,
    ).toBe(400);
  });

  it('operators in query strings are not interpreted as filters', async () => {
    const root = await createStaff(h.app, ['super_admin']);
    const base = await request(h.app).get('/api/v1/admin/users').set(root.auth);
    expect(base.status).toBe(200);
    for (const qs of [
      '?status[$ne]=active',
      '?q[$regex]=.*',
      '?email[$exists]=true',
      '?status=active&status[$ne]=x',
      '?role[$in][]=super_admin',
    ]) {
      const res = await request(h.app).get(`/api/v1/admin/users${qs}`).set(root.auth);
      // either refused as invalid, or ignored — it must never return a DIFFERENT, filtered/unfiltered set chosen by the attacker
      expect([200, 400], qs).toContain(res.status);
      if (res.status === 200)
        expect(res.body.total ?? res.body.items?.length).toBe(
          base.body.total ?? base.body.items?.length,
        );
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('session and privilege revocation take effect on the very next request', () => {
  it('suspending an account ends its existing tokens at once', async () => {
    const root = await createStaff(h.app, ['super_admin']);
    const user = await createUser(h.app);
    expect((await api().get('/auth/me').set(user.auth)).status).toBe(200);
    const res = await request(h.app)
      .put(`/api/v1/users/${user.id}/status`)
      .set(root.auth)
      .send({ status: 'suspended', reason: 'qa suspension test' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const after = await api().get('/auth/me').set(user.auth);
    expect(after.status).toBe(401);
    expect(['ACCOUNT_INACTIVE', 'SESSION_REVOKED']).toContain(after.body.error.code); // suspension also revokes the sessions
    expect(
      (await api().post('/auth/refresh').send({ refreshToken: user.refreshToken })).status,
    ).toBe(401);
    expect(
      (
        await api()
          .post('/auth/login')
          .send({ identifier: (await User.findById(user.id))!.email, password: PASSWORD })
      ).status,
    ).not.toBe(200);
  });

  it('revoking a role removes its permissions on the next request, with no token refresh needed', async () => {
    const root = await createStaff(h.app, ['super_admin']);
    const mod = await createStaff(h.app, ['moderator']);
    expect((await request(h.app).get('/api/v1/moderation/reports').set(mod.auth)).status).toBe(200);
    const role = await Role.findOne({ key: 'moderator' });
    const revoke = await request(h.app)
      .delete(`/api/v1/users/${mod.id}/roles/moderator`)
      .set(root.auth);
    expect([200, 204], JSON.stringify(revoke.body)).toContain(revoke.status);
    expect([401, 403]).toContain(
      (await request(h.app).get('/api/v1/moderation/reports').set(mod.auth)).status,
    ); // sessions end or the permission is gone
    expect(await UserRole.countDocuments({ userId: mod.id, roleId: role!._id })).toBe(0);
  });

  it('logout and logout-all kill access and refresh tokens; revoking a session by id kills only that session', async () => {
    const { email } = await register(h.app);
    const a = await login(h.app, email);
    const b = await login(h.app, email);
    const c = await login(h.app, email);
    const list = await api().get('/auth/sessions').set(a.auth);
    expect(list.body.sessions.length).toBeGreaterThanOrEqual(3);
    const bSession = list.body.sessions.find((s: any) => !s.current)!;
    await request(h.app).delete(`/api/v1/auth/sessions/${bSession.id}`).set(a.auth).expect(204);
    const statuses = await Promise.all(
      [a, b, c].map(async (s) => (await api().get('/auth/me').set(s.auth)).status),
    );
    expect(statuses.filter((x) => x === 401)).toHaveLength(1);
    await api().post('/auth/logout-all').set(a.auth).expect(204);
    for (const s of [a, b, c]) {
      expect((await api().get('/auth/me').set(s.auth)).status).toBe(401);
      expect(
        (await api().post('/auth/refresh').send({ refreshToken: s.refreshToken })).status,
      ).toBe(401);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('audit logging', () => {
  it('records security-relevant actions with the actor, and never stores secrets in the trail', async () => {
    const root = await createStaff(h.app, ['super_admin']);
    const user = await createUser(h.app);
    const target = await createUser(h.app);
    await request(h.app)
      .post(`/api/v1/users/${target.id}/roles`)
      .set(root.auth)
      .send({ roleKey: 'seller' });
    await request(h.app).delete(`/api/v1/users/${target.id}/roles/seller`).set(root.auth);
    await request(h.app)
      .put(`/api/v1/users/${target.id}/status`)
      .set(root.auth)
      .send({ status: 'suspended', reason: 'audit coverage test' });
    await request(h.app)
      .post('/api/v1/auth/password/change')
      .set(user.auth)
      .send({ currentPassword: PASSWORD, newPassword: 'another long passphrase 1' });
    await makeFarm(h.app, await createFarmer(h.app), 'Audit Farm');
    // every action below must now exist, attributed to somebody (or to the webhook source for unauthenticated events)
    for (const action of [
      'auth.register',
      'auth.mfa_enabled',
      'user.role_assigned',
      'user.role_revoked',
      'user.status_changed',
      'auth.password_changed',
      'farm.created',
    ]) {
      const row = await AuditLog.findOne({ action }).sort({ createdAt: -1 });
      expect(row, action).toBeTruthy();
      expect(row!.actorId, action).toBeTruthy();
    }
    expect(
      await AuditLog.findOne({
        action: 'user.status_changed',
        'metadata.reason': { $exists: true },
      }),
    ).toBeTruthy();
  });

  it('no audit row (general or financial) contains a password, token, hash, key or connection string', async () => {
    const rows = [...(await AuditLog.find().lean()), ...(await FinancialAuditLog.find().lean())];
    expect(rows.length).toBeGreaterThan(10);
    const problems: string[] = [];
    for (const row of rows) {
      const clean = { ...(row as any), hash: undefined, prevHash: undefined }; // the chain's own hashes are by design
      for (const f of findSecrets(
        JSON.parse(JSON.stringify(clean, (_k, v) => (v instanceof Types.ObjectId ? String(v) : v))),
      ))
        problems.push(`${(row as any).action}: ${f}`);
    }
    expect(problems).toEqual([]);
  });
});
