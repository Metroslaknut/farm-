import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Role, User, VerificationToken } from '../../src/models';
import {
  createStaff,
  createStaffWithPermissions,
  PASSWORD,
  register,
  startHarness,
  type Staff,
  type TestHarness,
} from '../helpers';

/**
 * Regression tests for authentication and authorization defects found in the full-system audit.
 * Each test reproduces the reported behaviour first; the fix makes it pass.
 */
let h: TestHarness;
let root: Staff;
beforeAll(async () => {
  h = await startHarness();
  root = await createStaff(h.app, ['super_admin']);
});
afterAll(() => h.stop());

const api = () => request(h.app);

describe('AUDIT-A1: the legacy PUT /roles/:key/permissions applies the same rules as the admin role editor', () => {
  it('refuses to rewrite a role that carries permissions the actor does not hold', async () => {
    const delegate = await createStaffWithPermissions(h.app, root, [
      'roles.manage',
      'permissions.manage',
      'users.read',
    ]);
    // support holds farms.read (among others), which the delegate does not
    const res = await api()
      .put('/api/v1/roles/support/permissions')
      .set(delegate.auth)
      .send({ permissions: ['users.read'] });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('PRIVILEGE_ESCALATION');
  });

  it('marks a role privileged (MFA) once it carries permissions, and ends its holders’ non-MFA sessions', async () => {
    const created = await api()
      .post('/api/v1/admin/roles')
      .set(root.auth)
      .send({ key: 'legacy_helper', name: 'Legacy helper' });
    expect(created.status).toBe(201);
    expect(created.body.role.requiresMfa).toBe(false);
    const holder = await createStaff(h.app, ['legacy_helper'], { enrollMfa: false });
    expect((await api().get('/api/v1/auth/me').set(holder.auth)).status).toBe(200);

    const res = await api()
      .put('/api/v1/roles/legacy_helper/permissions')
      .set(root.auth)
      .send({ permissions: ['users.read'] });
    expect(res.status).toBe(200);
    expect(res.body.role.requiresMfa).toBe(true);
    expect((await Role.findOne({ key: 'legacy_helper' }))?.requiresMfa).toBe(true);
    expect((await api().get('/api/v1/auth/me').set(holder.auth)).status).toBe(401);
  });
});

describe('AUDIT-A2: the failed-login lockout cannot be outrun by parallel attempts', () => {
  it('locks the account once ten failures are counted, however many arrive at the same moment', async () => {
    const { email, id } = await register(h.app);
    const attempts = await Promise.all(
      Array.from({ length: 15 }, () =>
        api()
          .post('/api/v1/auth/login')
          .send({ identifier: email, password: 'wrong password 123' }),
      ),
    );
    for (const res of attempts) expect([401, 429]).toContain(res.status);
    const user = await User.findById(id);
    expect(user?.lockedUntil?.getTime() ?? 0).toBeGreaterThan(Date.now());
    // the right password is refused while locked
    expect(
      (await api().post('/api/v1/auth/login').send({ identifier: email, password: PASSWORD }))
        .status,
    ).toBe(401);
  });
});

describe('AUDIT-A3: a phone OTP is checked at most five times, even when guesses arrive in parallel', () => {
  it('never evaluates more than five guesses for one code', async () => {
    const strict = await startHarness({ AUTH_REQUIRE_VERIFICATION: 'true' });
    try {
      const phone = '+66899990123';
      await request(strict.app)
        .post('/api/v1/auth/register')
        .send({ phone, password: PASSWORD, displayName: 'Ph' })
        .expect(201);
      const otp = strict.notifier.last('verify_phone')!.secret;
      const wrong = otp === '111111' ? '222222' : '111111';
      const guesses = await Promise.all(
        Array.from({ length: 20 }, () =>
          request(strict.app).post('/api/v1/auth/verify/phone').send({ phone, code: wrong }),
        ),
      );
      for (const res of guesses) expect([400, 429]).toContain(res.status);
      const user = await User.findOne({ phone });
      const token = await VerificationToken.findOne({ userId: user!._id, purpose: 'phone_verify' });
      expect(token!.attempts).toBeLessThanOrEqual(5);
      // the budget is spent: the right code is refused too
      await request(strict.app)
        .post('/api/v1/auth/verify/phone')
        .send({ phone, code: otp })
        .expect(400);
    } finally {
      await strict.stop();
    }
  });
});
