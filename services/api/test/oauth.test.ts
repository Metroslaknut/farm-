import { createHash, randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiEnvSchema, parseEnv } from '@farmplus/config/server';
import { AuditLog, OAuthFlow, OAuthIdentity, Role, User, UserRole } from '../src/models';
import {
  createStaff,
  register,
  startHarness,
  testEnv,
  uniqueEmail,
  type TestHarness,
} from './helpers';

/** Social sign-in (Google / Facebook) end to end against the mock provider: start → callback → exchange. */
const WEB = 'http://web.test/farms/oauth-callback';
const APP = 'farmplus://oauth-callback';
const API = '/api/v1/auth/oauth';

let h: TestHarness;
let off: TestHarness;
beforeAll(async () => {
  h = await startHarness({
    OAUTH_MOCK: 'true',
    API_PUBLIC_URL: 'http://api.test',
    OAUTH_RETURN_URLS: `${WEB},${APP}`,
  });
  off = await startHarness(); // no social sign-in configured
});
afterAll(async () => {
  await off.stop();
  await h.stop();
});

const pkce = () => {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
};
const mockCode = (p: { subject: string; email?: string; emailVerified?: boolean; name?: string }) =>
  `mock.${Buffer.from(JSON.stringify(p)).toString('base64url')}`;

/** Runs start + callback; returns the final redirect (ticket or error) and the client verifier. */
async function signIn(
  provider: 'google' | 'facebook',
  profile: Parameters<typeof mockCode>[0] | 'cancel' | 'fail',
  returnTo = WEB,
) {
  const { verifier, challenge } = pkce();
  const start = await request(h.app).get(`${API}/${provider}/start`).query({ returnTo, challenge });
  expect(start.status, JSON.stringify(start.body)).toBe(302);
  const state = new URL(start.headers['location']!).searchParams.get('state')!;
  const query =
    profile === 'cancel'
      ? { state, error: 'access_denied' }
      : { state, code: profile === 'fail' ? 'mock.fail' : mockCode(profile) };
  const cb = await request(h.app).get(`${API}/${provider}/callback`).query(query);
  expect(cb.status, JSON.stringify(cb.body)).toBe(302);
  const back = new URL(cb.headers['location']!);
  return {
    back,
    state,
    verifier,
    ticket: back.searchParams.get('ticket'),
    error: back.searchParams.get('error'),
  };
}
const exchange = (ticket: string, verifier: string) =>
  request(h.app).post(`${API}/exchange`).send({ ticket, verifier });

describe('social sign-in: configuration', () => {
  it('lists only configured providers', async () => {
    expect((await request(h.app).get(`${API}/providers`)).body.providers).toEqual([
      'google',
      'facebook',
    ]);
    expect((await request(off.app).get(`${API}/providers`)).body.providers).toEqual([]);
    const { challenge } = pkce();
    expect(
      (await request(off.app).get(`${API}/google/start`).query({ returnTo: WEB, challenge }))
        .status,
    ).toBe(404);
  });

  it('refuses unsafe configuration', () => {
    const base = testEnv('mongodb://127.0.0.1:27017/x');
    const raw = (over: Record<string, string>) => ({
      ...Object.fromEntries(
        Object.entries(base).map(([k, v]) => [k, Array.isArray(v) ? v.join(',') : String(v)]),
      ),
      ...over,
    });
    expect(() => parseEnv(apiEnvSchema, raw({ OAUTH_GOOGLE_CLIENT_ID: 'id-only' }))).toThrow(
      /OAUTH_GOOGLE_CLIENT_SECRET/,
    );
    expect(() =>
      parseEnv(apiEnvSchema, raw({ OAUTH_MOCK: 'true', OAUTH_RETURN_URLS: WEB })),
    ).toThrow(/API_PUBLIC_URL/);
    expect(() =>
      parseEnv(
        apiEnvSchema,
        raw({
          OAUTH_MOCK: 'true',
          API_PUBLIC_URL: 'http://api.test',
          OAUTH_RETURN_URLS: 'http://web.test/x#frag',
        }),
      ),
    ).toThrow(/fragment/);
  });
});

describe('social sign-in: new accounts', () => {
  it('Google: creates an active buyer account with the verified email, and signs it in', async () => {
    const email = uniqueEmail('g');
    const r = await signIn('google', {
      subject: 'g-new-1',
      email,
      emailVerified: true,
      name: 'Somchai G',
    });
    expect(r.back.origin + r.back.pathname).toBe(WEB);
    expect(r.ticket).toBeTruthy();
    const res = await exchange(r.ticket!, r.verifier);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.status).toBe('authenticated');
    const me = await request(h.app)
      .get('/api/v1/auth/me')
      .set({ Authorization: `Bearer ${res.body.tokens.accessToken}` });
    expect(me.status).toBe(200);
    const user = (await User.findOne({ email }))!;
    expect(user).toMatchObject({ status: 'active', displayName: 'Somchai G' });
    expect(user.emailVerifiedAt).toBeTruthy();
    const roles = await UserRole.find({ userId: user._id }).populate('roleId');
    const buyer = await Role.findOne({ key: 'buyer' });
    expect(roles.map((r) => String(r.roleId._id ?? r.roleId))).toEqual([String(buyer!._id)]);
    expect(await OAuthIdentity.countDocuments({ provider: 'google', subject: 'g-new-1' })).toBe(1);
    expect(
      await AuditLog.countDocuments({ action: 'auth.oauth_register', targetId: String(user._id) }),
    ).toBe(1);

    // signing in again with the same Google account reaches the same user
    const again = await signIn('google', { subject: 'g-new-1', email, emailVerified: true });
    const res2 = await exchange(again.ticket!, again.verifier);
    expect(res2.body.user.id).toBe(String(user._id));
    expect(await User.countDocuments({ email })).toBe(1);
  });

  it('Facebook: creates an account WITHOUT binding the (unconfirmed) email', async () => {
    const email = uniqueEmail('fb');
    const r = await signIn('facebook', { subject: 'fb-new-1', email, name: 'Malee F' });
    const res = await exchange(r.ticket!, r.verifier);
    expect(res.body.status).toBe('authenticated');
    const user = (await User.findById(res.body.user.id))!;
    expect(user.email).toBeUndefined();
    expect(user.status).toBe('active');
    // the address stays free: its real owner can still register with it
    await register(h.app, email);
  });

  it('works for the mobile deep link too', async () => {
    const r = await signIn(
      'google',
      { subject: 'g-app-1', email: uniqueEmail('app'), emailVerified: true },
      APP,
    );
    expect(r.back.protocol).toBe('farmplus:');
    expect((await exchange(r.ticket!, r.verifier)).body.status).toBe('authenticated');
  });
});

describe('social sign-in: existing accounts (link policy)', () => {
  it('links a Google-verified address to an account whose email is verified', async () => {
    const { id, email } = await register(h.app);
    await User.updateOne({ _id: id }, { $set: { emailVerifiedAt: new Date() } });
    const r = await signIn('google', { subject: 'g-link-1', email, emailVerified: true });
    const res = await exchange(r.ticket!, r.verifier);
    expect(res.body.user.id).toBe(id);
    expect(await AuditLog.countDocuments({ action: 'auth.oauth_linked', targetId: id })).toBe(1);
  });

  it('never links to an account whose email was never verified (pre-registered address)', async () => {
    const { id, email } = await register(h.app); // someone registered this address but never proved it
    const r = await signIn('google', { subject: 'g-squat-1', email, emailVerified: true });
    expect(r.error).toBe('account_exists');
    expect(r.ticket).toBeNull();
    expect(await OAuthIdentity.countDocuments({ subject: 'g-squat-1' })).toBe(0);
    expect(await User.countDocuments({ email })).toBe(1);
    expect(String((await User.findOne({ email }))!._id)).toBe(id);
  });

  it('never links Facebook, nor a Google address Google did not verify', async () => {
    const { id, email } = await register(h.app);
    await User.updateOne({ _id: id }, { $set: { emailVerifiedAt: new Date() } });
    expect((await signIn('facebook', { subject: 'fb-link-1', email })).error).toBe(
      'account_exists',
    );
    expect(
      (await signIn('google', { subject: 'g-unv-1', email, emailVerified: false })).error,
    ).toBe('account_exists');
    expect(await OAuthIdentity.countDocuments({ userId: id })).toBe(0);
  });

  it('a suspended account cannot sign in through a linked provider', async () => {
    const email = uniqueEmail('susp');
    const first = await signIn('google', { subject: 'g-susp-1', email, emailVerified: true });
    const res = await exchange(first.ticket!, first.verifier);
    await User.updateOne({ _id: res.body.user.id }, { $set: { status: 'suspended' } });
    expect(
      (await signIn('google', { subject: 'g-susp-1', email, emailVerified: true })).error,
    ).toBe('account_suspended');
  });

  it('an account with MFA still has to give its code', async () => {
    const staff = await createStaff(h.app, ['moderator']);
    await User.updateOne({ _id: staff.id }, { $set: { emailVerifiedAt: new Date() } });
    const r = await signIn('google', {
      subject: 'g-mfa-1',
      email: staff.email,
      emailVerified: true,
    });
    const res = await exchange(r.ticket!, r.verifier);
    expect(res.body.status).toBe('mfa_required');
    expect(res.body.tokens).toBeUndefined();
  });
});

describe('social sign-in: the flow cannot be replayed or redirected', () => {
  it('only allow-listed return URLs are accepted', async () => {
    const { challenge } = pkce();
    for (const returnTo of [
      'https://evil.test/cb',
      `${WEB}?x=1`,
      'http://web.test/farms/oauth-callbackx',
    ])
      expect(
        (await request(h.app).get(`${API}/google/start`).query({ returnTo, challenge })).body.error
          .code,
      ).toBe('RETURN_URL_NOT_ALLOWED');
    expect(
      (await request(h.app).get(`${API}/google/start`).query({ returnTo: WEB, challenge: 'short' }))
        .status,
    ).toBe(400);
  });

  it('a state works once and expires', async () => {
    const r = await signIn('google', {
      subject: 'g-replay-1',
      email: uniqueEmail('r'),
      emailVerified: true,
    });
    const replay = await request(h.app)
      .get(`${API}/google/callback`)
      .query({ state: r.state, code: mockCode({ subject: 'attacker' }) });
    expect(replay.status).toBe(400);
    expect(replay.body.error.code).toBe('INVALID_STATE');
    // expired
    const { challenge } = pkce();
    const start = await request(h.app)
      .get(`${API}/google/start`)
      .query({ returnTo: WEB, challenge });
    const state = new URL(start.headers['location']!).searchParams.get('state')!;
    await OAuthFlow.updateMany(
      { status: 'started' },
      { $set: { expiresAt: new Date(Date.now() - 1000) } },
    );
    expect(
      (await request(h.app).get(`${API}/google/callback`).query({ state, code: 'mock' })).status,
    ).toBe(400);
    // a state from one provider is not accepted by another
    const other = pkce();
    const s2 = await request(h.app)
      .get(`${API}/google/start`)
      .query({ returnTo: WEB, challenge: other.challenge });
    const st2 = new URL(s2.headers['location']!).searchParams.get('state')!;
    expect(
      (await request(h.app).get(`${API}/facebook/callback`).query({ state: st2, code: 'mock' }))
        .status,
    ).toBe(400);
  });

  it('a ticket works once and only with the verifier of the device that started', async () => {
    const r = await signIn('google', {
      subject: 'g-ticket-1',
      email: uniqueEmail('t'),
      emailVerified: true,
    });
    const stranger = pkce();
    const stolen = await exchange(r.ticket!, stranger.verifier);
    expect(stolen.status).toBe(401);
    expect(stolen.body.error.code).toBe('INVALID_TICKET');
    // the failed attempt burned it: even the right verifier is refused now
    expect((await exchange(r.ticket!, r.verifier)).status).toBe(401);

    const ok = await signIn('google', {
      subject: 'g-ticket-1',
      email: uniqueEmail('t'),
      emailVerified: true,
    });
    expect((await exchange(ok.ticket!, ok.verifier)).status).toBe(200);
    expect((await exchange(ok.ticket!, ok.verifier)).status).toBe(401);
  });

  it('cancel and provider failure come back as error codes, nothing created', async () => {
    const before = await User.countDocuments();
    expect((await signIn('google', 'cancel')).error).toBe('cancelled');
    expect((await signIn('facebook', 'fail')).error).toBe('provider_error');
    expect(await User.countDocuments()).toBe(before);
  });

  it('parallel callbacks for one new Google account create a single user', async () => {
    const email = uniqueEmail('par');
    const runs = await Promise.all(
      Array.from({ length: 4 }, () =>
        signIn('google', { subject: 'g-par-1', email, emailVerified: true }),
      ),
    );
    expect(runs.every((r) => r.ticket)).toBe(true);
    expect(await User.countDocuments({ email })).toBe(1);
    expect(await OAuthIdentity.countDocuments({ subject: 'g-par-1' })).toBe(1);
  });
});
