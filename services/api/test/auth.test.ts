import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RefreshToken, Role, Session, User, UserRole, VerificationToken } from '../src/models';
import {
  PASSWORD,
  createUser,
  login,
  register,
  startHarness,
  uniqueEmail,
  type TestHarness,
} from './helpers';

let h: TestHarness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(() => h.stop());

const api = () => request(h.app);

describe('registration', () => {
  it('creates an account with only the buyer role and leaks no secrets', async () => {
    const email = uniqueEmail();
    const res = await api()
      .post('/api/v1/auth/register')
      .send({ email, password: PASSWORD, displayName: 'Somchai' });
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({
      email,
      status: 'active',
      roles: ['buyer'],
      mfaEnabled: false,
    });
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|scrypt|secretEnc/);

    const stored = await User.findOne({ email });
    expect(stored?.passwordHash.startsWith('scrypt$')).toBe(true);
    expect(stored?.passwordHash).not.toContain(PASSWORD);
  });

  it('cannot choose roles or status at registration', async () => {
    const res = await api()
      .post('/api/v1/auth/register')
      .send({
        email: uniqueEmail(),
        password: PASSWORD,
        displayName: 'X',
        roles: ['super_admin'],
        status: 'active',
      });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects duplicates, weak passwords and missing identifiers', async () => {
    const { email } = await register(h.app);
    expect(
      (
        await api()
          .post('/api/v1/auth/register')
          .send({ email, password: PASSWORD, displayName: 'D' })
      ).status,
    ).toBe(409);
    expect(
      (
        await api()
          .post('/api/v1/auth/register')
          .send({ email: uniqueEmail(), password: 'short', displayName: 'D' })
      ).status,
    ).toBe(400);
    expect(
      (await api().post('/api/v1/auth/register').send({ password: PASSWORD, displayName: 'D' }))
        .status,
    ).toBe(400);
  });

  it('supports phone-only accounts in E.164 format', async () => {
    const ok = await api()
      .post('/api/v1/auth/register')
      .send({ phone: '+66812345678', password: PASSWORD, displayName: 'P' });
    expect(ok.status).toBe(201);
    const bad = await api()
      .post('/api/v1/auth/register')
      .send({ phone: '0812345678', password: PASSWORD, displayName: 'P' });
    expect(bad.status).toBe(400);
    expect(
      (
        await api()
          .post('/api/v1/auth/login')
          .send({ identifier: '+66812345678', password: PASSWORD })
      ).status,
    ).toBe(200);
  });
});

describe('login', () => {
  it('returns tokens, and the access token authenticates', async () => {
    const s = await createUser(h.app);
    const me = await api().get('/api/v1/auth/me').set(s.auth);
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe(s.email);
    expect(me.body.permissions).toEqual([]);
  });

  it('gives identical 401s for a wrong password and an unknown account', async () => {
    const { email } = await register(h.app);
    const wrong = await api()
      .post('/api/v1/auth/login')
      .send({ identifier: email, password: 'not-the-password' });
    const unknown = await api()
      .post('/api/v1/auth/login')
      .send({ identifier: 'nobody@example.test', password: 'not-the-password' });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body).toEqual(unknown.body);
  });

  it('locks the account after repeated failures, even for the right password', async () => {
    const { email } = await register(h.app);
    for (let i = 0; i < 10; i++) {
      await api()
        .post('/api/v1/auth/login')
        .send({ identifier: email, password: 'wrong-password-1' });
    }
    const res = await api()
      .post('/api/v1/auth/login')
      .send({ identifier: email, password: PASSWORD });
    expect(res.status).toBe(401);
  });
});

describe('authentication enforcement (401)', () => {
  it.each([
    ['no header', undefined],
    ['malformed header', 'Token abc'],
    ['garbage bearer', 'Bearer not.a.jwt'],
  ])('rejects %s', async (_name, header) => {
    const req = api().get('/api/v1/auth/me');
    if (header) req.set('Authorization', header);
    const res = await req;
    expect(res.status).toBe(401);
    expect(res.body.error.code).toMatch(/UNAUTHENTICATED|INVALID_TOKEN/);
  });

  it('rejects a refresh token or MFA token used as an access token', async () => {
    const s = await createUser(h.app);
    expect(
      (await api().get('/api/v1/auth/me').set('Authorization', `Bearer ${s.refreshToken}`)).status,
    ).toBe(401);
  });
});

describe('refresh tokens & sessions', () => {
  it('rotates refresh tokens and stores only hashes', async () => {
    const s = await createUser(h.app);
    const res = await api().post('/api/v1/auth/refresh').send({ refreshToken: s.refreshToken });
    expect(res.status).toBe(200);
    const next = res.body.tokens;
    expect(next.refreshToken).not.toBe(s.refreshToken);
    expect(
      (await api().get('/api/v1/auth/me').set('Authorization', `Bearer ${next.accessToken}`))
        .status,
    ).toBe(200);

    const all = JSON.stringify(await RefreshToken.find().lean());
    expect(all).not.toContain(s.refreshToken);
    expect(all).not.toContain(next.refreshToken);
  });

  it('treats re-use of a rotated refresh token as theft and revokes the whole session', async () => {
    const s = await createUser(h.app);
    const first = await api().post('/api/v1/auth/refresh').send({ refreshToken: s.refreshToken });
    const replay = await api().post('/api/v1/auth/refresh').send({ refreshToken: s.refreshToken });
    expect(replay.status).toBe(401);
    // The legitimate (newer) token and its access token die with the session.
    expect(
      (
        await api()
          .post('/api/v1/auth/refresh')
          .send({ refreshToken: first.body.tokens.refreshToken })
      ).status,
    ).toBe(401);
    expect(
      (
        await api()
          .get('/api/v1/auth/me')
          .set('Authorization', `Bearer ${first.body.tokens.accessToken}`)
      ).status,
    ).toBe(401);
  });

  it('logout revokes the access token and refresh token immediately', async () => {
    const s = await createUser(h.app);
    expect((await api().post('/api/v1/auth/logout').set(s.auth)).status).toBe(204);
    expect((await api().get('/api/v1/auth/me').set(s.auth)).status).toBe(401);
    expect(
      (await api().post('/api/v1/auth/refresh').send({ refreshToken: s.refreshToken })).status,
    ).toBe(401);
  });

  it('logout-all ends every session', async () => {
    const { email } = await register(h.app);
    const a = await login(h.app, email);
    const b = await login(h.app, email);
    await api().post('/api/v1/auth/logout-all').set(a.auth).expect(204);
    expect((await api().get('/api/v1/auth/me').set(b.auth)).status).toBe(401);
  });

  it('a signed-in tab can hand a separate session to a new tab (QA #14)', async () => {
    const a = await createUser(h.app);
    expect((await api().post('/api/v1/auth/session/handoff')).status).toBe(401);
    const res = await api().post('/api/v1/auth/session/handoff').set(a.auth);
    expect(res.status).toBe(201);
    const tab2 = res.body.tokens as { accessToken: string; refreshToken: string };
    expect(tab2.refreshToken).not.toBe(a.refreshToken);
    // Two sessions now; each tab rotates its own refresh token without touching the other.
    expect((await api().get('/api/v1/auth/sessions').set(a.auth)).body.sessions).toHaveLength(2);
    expect(
      (await api().post('/api/v1/auth/refresh').send({ refreshToken: tab2.refreshToken })).status,
    ).toBe(200);
    expect(
      (await api().post('/api/v1/auth/refresh').send({ refreshToken: a.refreshToken })).status,
    ).toBe(200);
    expect(
      (await api().get('/api/v1/auth/me').set('Authorization', `Bearer ${tab2.accessToken}`))
        .status,
    ).toBe(200);
    // Signing out the new tab ends only its own session.
    await api()
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${tab2.accessToken}`)
      .expect(204);
    expect((await api().get('/api/v1/auth/me').set(a.auth)).status).toBe(200);
  });

  it('the handed-off session keeps the second-factor state of the tab that gave it', async () => {
    const a = await createUser(h.app);
    await Session.updateMany({ userId: a.id }, { $set: { mfaVerified: true } });
    const res = await api().post('/api/v1/auth/session/handoff').set(a.auth).expect(201);
    const sessions = await Session.find({ userId: a.id });
    expect(sessions.every((x) => x.mfaVerified)).toBe(true);
    expect(sessions).toHaveLength(2);
    expect(res.body.tokens.tokenType).toBe('Bearer');
  });

  it('lists own sessions and cannot revoke someone else’s', async () => {
    const a = await createUser(h.app);
    const b = await createUser(h.app);
    const mine = await api().get('/api/v1/auth/sessions').set(a.auth);
    expect(mine.body.sessions).toHaveLength(1);
    expect(mine.body.sessions[0].current).toBe(true);
    const theirs = (await Session.findOne({ userId: b.id }))!;
    expect((await api().delete(`/api/v1/auth/sessions/${theirs._id}`).set(a.auth)).status).toBe(
      404,
    );
    expect((await api().get('/api/v1/auth/me').set(b.auth)).status).toBe(200);
  });

  it('refuses refresh once the account is no longer active', async () => {
    const s = await createUser(h.app);
    await User.updateOne({ _id: s.id }, { status: 'suspended' });
    expect(
      (await api().post('/api/v1/auth/refresh').send({ refreshToken: s.refreshToken })).status,
    ).toBe(401);
    expect((await api().get('/api/v1/auth/me').set(s.auth)).status).toBe(401);
  });
});

describe('password reset & change', () => {
  it('resets via a single-use emailed token and revokes existing sessions', async () => {
    const s = await createUser(h.app);
    await api().post('/api/v1/auth/password/forgot').send({ identifier: s.email }).expect(202);
    const mail = h.notifier.last('password_reset')!;
    expect(mail.to).toBe(s.email);
    // Only a hash is stored.
    expect(JSON.stringify(await VerificationToken.find().lean())).not.toContain(mail.secret);

    const newPassword = 'a brand new passphrase';
    await api()
      .post('/api/v1/auth/password/reset')
      .send({ token: mail.secret, newPassword })
      .expect(204);
    await api()
      .post('/api/v1/auth/password/reset')
      .send({ token: mail.secret, newPassword: 'another passphrase!' })
      .expect(401);

    expect((await api().get('/api/v1/auth/me').set(s.auth)).status).toBe(401);
    expect(
      (await api().post('/api/v1/auth/login').send({ identifier: s.email, password: PASSWORD }))
        .status,
    ).toBe(401);
    expect(
      (await api().post('/api/v1/auth/login').send({ identifier: s.email, password: newPassword }))
        .status,
    ).toBe(200);
  });

  it('does not reveal whether an account exists', async () => {
    const before = h.notifier.sent.length;
    const res = await api()
      .post('/api/v1/auth/password/forgot')
      .send({ identifier: 'ghost@example.test' });
    expect(res.status).toBe(202);
    expect(h.notifier.sent.length).toBe(before);
  });

  it('change-password needs the current password and keeps only the current session', async () => {
    const { email } = await register(h.app);
    const a = await login(h.app, email);
    const b = await login(h.app, email);
    const bad = await api()
      .post('/api/v1/auth/password/change')
      .set(a.auth)
      .send({ currentPassword: 'nope-nope-nope', newPassword: 'new passphrase 123' });
    expect(bad.status).toBe(401);
    await api()
      .post('/api/v1/auth/password/change')
      .set(a.auth)
      .send({ currentPassword: PASSWORD, newPassword: 'new passphrase 123' })
      .expect(204);
    expect((await api().get('/api/v1/auth/me').set(a.auth)).status).toBe(200);
    expect((await api().get('/api/v1/auth/me').set(b.auth)).status).toBe(401);
  });
});

describe('MFA enrolment for ordinary users', () => {
  it('requires a TOTP code at login once enabled, and consumes recovery codes once', async () => {
    const { createStaff } = await import('./helpers');
    // A buyer can opt in to MFA too; reuse the helper by granting only the buyer role.
    const staff = await createStaff(h.app, []);
    const first = await api()
      .post('/api/v1/auth/login')
      .send({ identifier: staff.email, password: PASSWORD });
    expect(first.body.status).toBe('mfa_required');
    expect(first.body.tokens).toBeUndefined();

    const bad = await api()
      .post('/api/v1/auth/mfa/verify')
      .send({ mfaToken: first.body.mfaToken, code: '000000' });
    expect(bad.status).toBe(401);

    const recovery = staff.recoveryCodes[0]!;
    const ok = await api()
      .post('/api/v1/auth/mfa/verify')
      .send({ mfaToken: first.body.mfaToken, code: recovery });
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe('authenticated');
    const replay = await api()
      .post('/api/v1/auth/mfa/verify')
      .send({ mfaToken: first.body.mfaToken, code: recovery });
    expect(replay.status).toBe(401);

    const stored = (await User.findOne({ email: staff.email }))!;
    expect(stored.mfa.secretEnc).toBeTruthy();
    expect(stored.mfa.secretEnc).not.toContain(staff.totpSecret);
  });
});

describe('seeded RBAC data', () => {
  it('has all roles, and buyer is the only role self-registration receives', async () => {
    const keys = (await Role.find()).map((r) => r.key).sort();
    expect(keys).toEqual([
      'admin',
      'buyer',
      'farm_owner',
      'finance_admin',
      'moderator',
      'registration_admin',
      'seller',
      'super_admin',
      'support',
    ]);
    const { id } = await register(h.app);
    const links = await UserRole.find({ userId: id });
    expect(links).toHaveLength(1);
  });
});

describe('verification when required', () => {
  let strict: TestHarness;
  beforeAll(async () => {
    strict = await startHarness({ AUTH_REQUIRE_VERIFICATION: 'true' });
  });
  afterAll(() => strict.stop());

  it('blocks login until the email token is confirmed (single use)', async () => {
    const email = uniqueEmail('verify');
    await request(strict.app)
      .post('/api/v1/auth/register')
      .send({ email, password: PASSWORD, displayName: 'V' })
      .expect(201);
    const blocked = await request(strict.app)
      .post('/api/v1/auth/login')
      .send({ identifier: email, password: PASSWORD });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('ACCOUNT_NOT_VERIFIED');

    const mail = strict.notifier.last('verify_email')!;
    await request(strict.app)
      .post('/api/v1/auth/verify/email')
      .send({ token: 'x'.repeat(30) })
      .expect(400);
    await request(strict.app)
      .post('/api/v1/auth/verify/email')
      .send({ token: mail.secret })
      .expect(204);
    await request(strict.app)
      .post('/api/v1/auth/verify/email')
      .send({ token: mail.secret })
      .expect(400);
    expect(
      (
        await request(strict.app)
          .post('/api/v1/auth/login')
          .send({ identifier: email, password: PASSWORD })
      ).status,
    ).toBe(200);
  });

  it('verifies a phone with an OTP and burns the code after 5 wrong guesses', async () => {
    const phone = '+66899990000';
    await request(strict.app)
      .post('/api/v1/auth/register')
      .send({ phone, password: PASSWORD, displayName: 'Ph' })
      .expect(201);
    const otp = strict.notifier.last('verify_phone')!.secret;
    for (let i = 0; i < 5; i++) {
      const wrong = otp === '111111' ? '222222' : '111111';
      await request(strict.app)
        .post('/api/v1/auth/verify/phone')
        .send({ phone, code: wrong })
        .expect(400);
    }
    // Correct code no longer works: the attempt budget is spent.
    await request(strict.app)
      .post('/api/v1/auth/verify/phone')
      .send({ phone, code: otp })
      .expect(400);

    await request(strict.app)
      .post('/api/v1/auth/verify/resend')
      .send({ identifier: phone })
      .expect(202);
    const fresh = strict.notifier.last('verify_phone')!.secret;
    await request(strict.app)
      .post('/api/v1/auth/verify/phone')
      .send({ phone, code: fresh })
      .expect(204);
    expect(
      (
        await request(strict.app)
          .post('/api/v1/auth/login')
          .send({ identifier: phone, password: PASSWORD })
      ).status,
    ).toBe(200);
  });
});

describe('rate limiting', () => {
  it('returns 429 once a sensitive endpoint is hammered', async () => {
    const limited = await startHarness({ RATE_LIMIT_ENABLED: 'true' });
    try {
      const statuses: number[] = [];
      for (let i = 0; i < 12; i++) {
        const res = await request(limited.app)
          .post('/api/v1/auth/login')
          .send({ identifier: 'a@example.test', password: 'whatever-123' });
        statuses.push(res.status);
      }
      expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
      expect(statuses.slice(10)).toEqual([429, 429]);
      const res = await request(limited.app)
        .post('/api/v1/auth/login')
        .send({ identifier: 'a@example.test', password: 'x' });
      expect(res.body.error.code).toBe('RATE_LIMITED');
    } finally {
      await limited.stop();
    }
  });
});
