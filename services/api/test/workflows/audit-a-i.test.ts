/* eslint-disable @typescript-eslint/no-explicit-any -- response bodies are inspected loosely in tests */
import type { OrderStatus } from '@farmplus/shared-types';
import { Types } from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  Animal,
  FarmExpense,
  FarmMember,
  Order,
  Payment,
  RefreshToken,
  Refund,
  Registration,
  Role,
  RolePermission,
  Permission,
  Session as SessionModel,
  User,
  UserRole,
  VerificationToken,
} from '../../src/models';
import { verifyPassword } from '../../src/lib/password';
import { currentStep, totpAt } from '../../src/lib/totp';
import { createWorld, type World } from '../commerce-fixtures';
import { payOrder, providerEvent, send } from '../finance-helpers';
import {
  PASSWORD,
  addFarmMember,
  createStaff,
  createStaffWithPermissions,
  createUser,
  daysAgo,
  daysAhead,
  login,
  makeFarm,
  mkAnimal,
  startHarness,
  typeIdOf,
  uniqueEmail,
  type Session,
  type Staff,
  type TestHarness,
} from '../helpers';

/**
 * QA audit — scenarios A (users, registration, roles) and I (dashboard & reporting).
 * Every case drives the real API and then checks the database through the Mongoose models.
 */
const API = '/api/v1';
let h: TestHarness;
let hv: TestHarness; // AUTH_REQUIRE_VERIFICATION=true
let root: Staff;
let regAdmin: Staff;
let w: World;
let fin: Staff;

beforeAll(async () => {
  h = await startHarness();
  hv = await startHarness({ AUTH_REQUIRE_VERIFICATION: 'true' });
  root = await createStaff(h.app, ['super_admin']);
  regAdmin = await createStaff(h.app, ['registration_admin']);
  w = await createWorld(h);
  fin = await createStaff(h.app, ['finance_admin']);
}, 120_000);
afterAll(async () => {
  await hv.stop();
  await h.stop();
});

const api = (app = h.app) => request(app);
const reg = (body: object, app = h.app) => api(app).post(`${API}/auth/register`).send(body);
const me = (s: Session, app = h.app) => api(app).get(`${API}/auth/me`).set(s.auth);
const refresh = (token: string, app = h.app) =>
  api(app).post(`${API}/auth/refresh`).send({ refreshToken: token });
const setStatus = (actor: Session, userId: string, status: string, reason = 'QA audit action') =>
  api().patch(`${API}/admin/users/${userId}/status`).set(actor.auth).send({ status, reason });
const secretFor = (hh: TestHarness, to: string, template: string) =>
  [...hh.notifier.sent].reverse().find((n) => n.to === to && n.template === template)?.secret;

// ===========================================================================
describe('A1 registration validation and normalisation', () => {
  it('A1-1 invalid payloads are refused with 400 and leave no account row behind', async () => {
    const before = await User.countDocuments();
    const bad: object[] = [
      { email: 'a1-short@example.test', password: 'short', displayName: 'X' },
      { email: 'a1-long@example.test', password: 'x'.repeat(129), displayName: 'X' },
      { email: 'a1-blank@example.test', password: PASSWORD, displayName: '   ' },
      { email: 'not-an-email', password: PASSWORD, displayName: 'X' },
      { phone: '0812345678', password: PASSWORD, displayName: 'Local format' },
      { phone: '+66 81 234 5678', password: PASSWORD, displayName: 'Spaced' },
      { password: PASSWORD, displayName: 'No identifier' },
      { email: 'a1-mixed@example.test', phone: 'bogus', password: PASSWORD, displayName: 'X' },
      { email: 'a1-extra@example.test', password: PASSWORD, displayName: 'X', emailVerified: true },
    ];
    for (const body of bad) {
      const res = await reg(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
    expect(await User.countDocuments()).toBe(before);
    expect(
      await User.countDocuments({
        email: {
          $in: [
            'a1-short@example.test',
            'a1-long@example.test',
            'a1-blank@example.test',
            'a1-mixed@example.test',
            'a1-extra@example.test',
          ],
        },
      }),
    ).toBe(0);
  });

  it('A1-2 email is stored trimmed and lower-cased; display name trimmed; only the buyer role; status active', async () => {
    const res = await reg({
      email: '  A1.Norm@Example.TEST ',
      password: PASSWORD,
      displayName: '  Somchai  ',
    });
    expect(res.status).toBe(201);
    const u = await User.findById(res.body.user.id);
    expect(u?.email).toBe('a1.norm@example.test');
    expect(u?.displayName).toBe('Somchai');
    expect(u?.status).toBe('active');
    expect(u?.identityVerification).toBe('unverified');
    expect(u?.sellerVerification).toBe('none');
    expect(u?.subscriptionStatus).toBe('none');
    expect(u?.passwordHash).not.toContain(PASSWORD);
    const roles = await Role.find({
      _id: { $in: (await UserRole.find({ userId: u!._id })).map((l) => l.roleId) },
    });
    expect(roles.map((r) => r.key)).toEqual(['buyer']);
    // the normalised address logs in with any casing
    expect(
      (
        await api()
          .post(`${API}/auth/login`)
          .send({ identifier: ' A1.NORM@example.test ', password: PASSWORD })
      ).status,
    ).toBe(200);
  });
});

// ===========================================================================
describe('A2 duplicate identifiers', () => {
  it('A2-1 case/whitespace variants of an existing email are refused 409 and the original is untouched', async () => {
    const first = await reg({
      email: 'dup.case@example.test',
      password: PASSWORD,
      displayName: 'One',
    });
    expect(first.status).toBe(201);
    const original = (await User.findById(first.body.user.id))!;
    for (const email of ['DUP.CASE@example.test', ' dup.case@EXAMPLE.test ']) {
      const res = await reg({ email, password: 'another password 123', displayName: 'Two' });
      expect(res.status, email).toBe(409);
      expect(res.body.error.code).toBe('ACCOUNT_EXISTS');
    }
    expect(await User.countDocuments({ email: 'dup.case@example.test' })).toBe(1);
    const after = (await User.findById(first.body.user.id))!;
    expect(after.passwordHash).toBe(original.passwordHash);
    expect(after.displayName).toBe('One');
  });

  it('A2-2 concurrent sign-ups with differently-cased forms of one email create exactly one account', async () => {
    const variants = [
      'Race@Example.test',
      ' race@example.test ',
      'RACE@EXAMPLE.TEST',
      'race@example.test',
    ];
    const rs = await Promise.all(
      variants.map((email) => reg({ email, password: PASSWORD, displayName: 'Racer' })),
    );
    expect(rs.filter((r) => r.status === 201)).toHaveLength(1);
    expect(rs.filter((r) => r.status === 409)).toHaveLength(3);
    expect(await User.countDocuments({ email: 'race@example.test' })).toBe(1);
    expect(await User.countDocuments({ email: /race@example\.test/i })).toBe(1);
  });

  it('A2-3 a phone already used (also with surrounding whitespace, or alongside a new email) is refused and no row is created', async () => {
    const phone = '+66812220001';
    expect((await reg({ phone, password: PASSWORD, displayName: 'P1' })).status).toBe(201);
    const before = await User.countDocuments();
    expect((await reg({ phone: ` ${phone} `, password: PASSWORD, displayName: 'P2' })).status).toBe(
      409,
    );
    expect(
      (await reg({ email: 'a2-phone@example.test', phone, password: PASSWORD, displayName: 'P3' }))
        .status,
    ).toBe(409);
    expect(await User.countDocuments()).toBe(before);
    expect(await User.exists({ email: 'a2-phone@example.test' })).toBeNull();
  });
});

// ===========================================================================
describe('A3 verification and password reset', () => {
  it('A3-1 an expired email-verification token is refused; the account stays pending and cannot sign in', async () => {
    const email = uniqueEmail('a3exp');
    const res = await reg({ email, password: PASSWORD, displayName: 'Pending' }, hv.app);
    expect(res.status).toBe(201);
    expect((await User.findById(res.body.user.id))?.status).toBe('pending_verification');
    const secret = secretFor(hv, email, 'verify_email')!;
    await VerificationToken.updateMany(
      { userId: res.body.user.id, purpose: 'email_verify' },
      { $set: { expiresAt: new Date(Date.now() - 1000) } },
    );
    const v = await api(hv.app).post(`${API}/auth/verify/email`).send({ token: secret });
    expect(v.status).toBe(400);
    expect(v.body.error.code).toBe('INVALID_VERIFICATION');
    const u = await User.findById(res.body.user.id);
    expect(u?.status).toBe('pending_verification');
    expect(u?.emailVerifiedAt).toBeNull();
    const l = await api(hv.app)
      .post(`${API}/auth/login`)
      .send({ identifier: email, password: PASSWORD });
    expect(l.status).toBe(403);
    expect(l.body.error.code).toBe('ACCOUNT_NOT_VERIFIED');
  });

  it('A3-2 tokens are purpose-bound: a reset token cannot verify an email and a verify token cannot reset a password; the right one is single-use', async () => {
    const email = uniqueEmail('a3purpose');
    const res = await reg({ email, password: PASSWORD, displayName: 'Purpose' }, hv.app);
    const userId = res.body.user.id;
    const verifySecret = secretFor(hv, email, 'verify_email')!;
    await api(hv.app).post(`${API}/auth/password/forgot`).send({ identifier: email }).expect(202);
    const resetSecret = secretFor(hv, email, 'password_reset')!;
    const hashBefore = (await User.findById(userId))!.passwordHash;

    const wrong1 = await api(hv.app).post(`${API}/auth/verify/email`).send({ token: resetSecret });
    expect(wrong1.status).toBe(400);
    expect((await User.findById(userId))?.status).toBe('pending_verification');
    const wrong2 = await api(hv.app)
      .post(`${API}/auth/password/reset`)
      .send({ token: verifySecret, newPassword: 'hijacked password 1' });
    expect(wrong2.status).toBe(401);
    expect((await User.findById(userId))!.passwordHash).toBe(hashBefore);
    // both tokens are still unused (a wrong-purpose attempt must not burn them)
    expect(await VerificationToken.countDocuments({ userId, usedAt: null })).toBe(2);

    expect(
      (await api(hv.app).post(`${API}/auth/verify/email`).send({ token: verifySecret })).status,
    ).toBe(204);
    const u = await User.findById(userId);
    expect(u?.status).toBe('active');
    expect(u?.emailVerifiedAt).toBeInstanceOf(Date);
    expect(
      (await api(hv.app).post(`${API}/auth/verify/email`).send({ token: verifySecret })).status,
    ).toBe(400);
  });

  it('A3-3 reset: old access token, old refresh token and old password are refused; the token is single-use; an expired reset token is refused', async () => {
    const s = await createUser(h.app);
    const s2 = await login(h.app, s.email);
    await api().post(`${API}/auth/password/forgot`).send({ identifier: s.email }).expect(202);
    const first = secretFor(h, s.email, 'password_reset')!;
    // a newer request supersedes the older link
    await api().post(`${API}/auth/password/forgot`).send({ identifier: s.email }).expect(202);
    const secret = secretFor(h, s.email, 'password_reset')!;
    expect(secret).not.toBe(first);
    expect(
      (
        await api()
          .post(`${API}/auth/password/reset`)
          .send({ token: first, newPassword: 'superseded pass 1' })
      ).status,
    ).toBe(401);

    const newPassword = 'a3 brand new passphrase';
    await api().post(`${API}/auth/password/reset`).send({ token: secret, newPassword }).expect(204);
    expect((await me(s)).status).toBe(401);
    expect((await me(s2)).status).toBe(401);
    expect((await refresh(s.refreshToken)).status).toBe(401);
    expect((await refresh(s2.refreshToken)).status).toBe(401);
    const sessions = await SessionModel.find({ userId: s.id });
    expect(sessions.length).toBeGreaterThanOrEqual(2);
    expect(sessions.every((x) => x.revokedAt && x.revokedReason === 'password_reset')).toBe(true);
    expect(await RefreshToken.countDocuments({ userId: s.id })).toBe(0);
    expect(
      (await api().post(`${API}/auth/login`).send({ identifier: s.email, password: PASSWORD }))
        .status,
    ).toBe(401);
    const u = (await User.findById(s.id))!;
    expect(await verifyPassword(newPassword, u.passwordHash)).toBe(true);
    expect(
      (
        await api()
          .post(`${API}/auth/password/reset`)
          .send({ token: secret, newPassword: 'replayed pass 12' })
      ).status,
    ).toBe(401);
    expect(await verifyPassword(newPassword, (await User.findById(s.id))!.passwordHash)).toBe(true);

    // expiry
    await api().post(`${API}/auth/password/forgot`).send({ identifier: s.email }).expect(202);
    const late = secretFor(h, s.email, 'password_reset')!;
    await VerificationToken.updateMany(
      { userId: s.id, purpose: 'password_reset', usedAt: null },
      { $set: { expiresAt: new Date(Date.now() - 1000) } },
    );
    expect(
      (
        await api()
          .post(`${API}/auth/password/reset`)
          .send({ token: late, newPassword: 'expired pass 123' })
      ).status,
    ).toBe(401);
    expect(await verifyPassword(newPassword, (await User.findById(s.id))!.passwordHash)).toBe(true);
  });

  it('A3-4 an outstanding reset link stops working once the user changes their password', async () => {
    const s = await createUser(h.app);
    await api().post(`${API}/auth/password/forgot`).send({ identifier: s.email }).expect(202);
    const stale = secretFor(h, s.email, 'password_reset')!;
    const changed = 'changed by the owner 1';
    await api()
      .post(`${API}/auth/password/change`)
      .set(s.auth)
      .send({ currentPassword: PASSWORD, newPassword: changed })
      .expect(204);
    const res = await api()
      .post(`${API}/auth/password/reset`)
      .send({ token: stale, newPassword: 'attacker chosen pass' });
    expect(res.status, 'stale reset link must be dead after a password change').toBe(401);
    expect(await verifyPassword(changed, (await User.findById(s.id))!.passwordHash)).toBe(true);
  });
});

// ===========================================================================
describe('A4 farm-owner registration lifecycle', () => {
  const submit = (s: Session, body: object) =>
    api().post(`${API}/registrations`).set(s.auth).send(body);
  const decide = (
    s: Session,
    id: string,
    action: string,
    body: object = { reason: 'QA decision' },
  ) => api().post(`${API}/admin/registrations/${id}/${action}`).set(s.auth).send(body);
  const createFarm = (s: Session) =>
    api().post(`${API}/farms`).set(s.auth).send({ name: 'Reg Farm' });

  it('A4-1 approval grants farm_owner (usable on the next request), records the decision, touches no other dimension; re-applying is blocked', async () => {
    const u = await createUser(h.app);
    expect((await createFarm(u)).status).toBe(403);
    const sub = await submit(u, { type: 'farm_owner', businessName: 'Ban Suan' });
    expect(sub.status).toBe(201);
    const id = sub.body.registration.id;
    expect((await Registration.findById(id))?.status).toBe('PENDING');

    // the decision needs a reason and the approve permission
    expect((await decide(regAdmin, id, 'approve', {})).status).toBe(400);
    const reviewerOnly = await createStaffWithPermissions(h.app, root, ['registrations.review']);
    expect((await decide(reviewerOnly, id, 'approve')).status).toBe(403);
    expect((await Registration.findById(id))?.status).toBe('PENDING');

    expect((await decide(regAdmin, id, 'approve', { reason: 'Documents ok' })).status).toBe(200);
    const row = (await Registration.findById(id))!;
    expect(row.status).toBe('APPROVED');
    expect(row.decision).toMatchObject({ outcome: 'APPROVED', reason: 'Documents ok' });
    expect(String(row.decision!.by)).toBe(regAdmin.id);
    const ownerRole = (await Role.findOne({ key: 'farm_owner' }))!;
    expect(await UserRole.exists({ userId: u.id, roleId: ownerRole._id })).not.toBeNull();
    const user = (await User.findById(u.id))!;
    expect(user.status).toBe('active');
    expect(user.sellerVerification).toBe('none');
    expect(user.identityVerification).toBe('unverified');

    expect((await createFarm(u)).status).toBe(201); // same access token, next request
    const again = await submit(u, { type: 'farm_owner' });
    expect(again.status).toBe(409);
    expect(await Registration.countDocuments({ userId: u.id, type: 'farm_owner' })).toBe(1);
    // decided once: cannot be rejected afterwards
    expect((await decide(regAdmin, id, 'reject')).status).toBe(409);
    expect((await Registration.findById(id))?.status).toBe('APPROVED');
  });

  it('A4-2 rejection grants nothing, keeps history, and allows a fresh application', async () => {
    const u = await createUser(h.app);
    const id = (await submit(u, { type: 'farm_owner' })).body.registration.id;
    expect((await decide(regAdmin, id, 'reject', { reason: 'Missing title deed' })).status).toBe(
      200,
    );
    expect((await Registration.findById(id))?.status).toBe('REJECTED');
    const ownerRole = (await Role.findOne({ key: 'farm_owner' }))!;
    expect(await UserRole.exists({ userId: u.id, roleId: ownerRole._id })).toBeNull();
    expect((await createFarm(u)).status).toBe(403);
    expect((await decide(regAdmin, id, 'approve')).status).toBe(409);
    const re = await submit(u, { type: 'farm_owner', note: 'Now with deed' });
    expect(re.status).toBe(201);
    const rows = await Registration.find({ userId: u.id, type: 'farm_owner' }).sort({
      submittedAt: 1,
    });
    expect(rows.map((r) => r.status)).toEqual(['REJECTED', 'PENDING']);
  });

  it('A4-3 a reviewer cannot decide their own application; suspension of an approved application removes farm_owner at once', async () => {
    const id = (await submit(regAdmin, { type: 'farm_owner' })).body.registration.id;
    const self = await decide(regAdmin, id, 'approve');
    expect(self.status).toBe(403);
    expect(self.body.error.code).toBe('SELF_DECISION');
    expect((await Registration.findById(id))?.status).toBe('PENDING');
    const ownerRole = (await Role.findOne({ key: 'farm_owner' }))!;
    expect(await UserRole.exists({ userId: regAdmin.id, roleId: ownerRole._id })).toBeNull();

    const u = await createUser(h.app);
    const rid = (await submit(u, { type: 'farm_owner' })).body.registration.id;
    await decide(regAdmin, rid, 'approve').expect(200);
    expect((await createFarm(u)).status).toBe(201);
    await decide(regAdmin, rid, 'suspend', { reason: 'Fraud report' }).expect(200);
    expect(await UserRole.exists({ userId: u.id, roleId: ownerRole._id })).toBeNull();
    expect((await createFarm(u)).status).toBe(403);
    expect((await User.findById(u.id))?.status).toBe('active'); // account status untouched
  });
});

// ===========================================================================
describe('A5 suspension', () => {
  it('A5-1 suspension kills every access token, refresh token and REST call at once; unsuspending does not resurrect them', async () => {
    const s = await createUser(h.app);
    const s2 = await login(h.app, s.email);
    expect((await setStatus(root, s.id, 'suspended')).status).toBe(200);

    expect((await me(s)).status).toBe(401);
    expect((await me(s2)).status).toBe(401);
    const patch = await api().patch(`${API}/users/me`).set(s.auth).send({ displayName: 'Evil' });
    expect(patch.status).toBe(401);
    expect((await User.findById(s.id))?.displayName).not.toBe('Evil');
    expect((await refresh(s.refreshToken)).status).toBe(401);
    const sessions = await SessionModel.find({ userId: s.id });
    expect(sessions.every((x) => x.revokedAt && x.revokedReason === 'status_suspended')).toBe(true);
    expect(await RefreshToken.countDocuments({ userId: s.id })).toBe(0);
    const l = await api()
      .post(`${API}/auth/login`)
      .send({ identifier: s.email, password: PASSWORD });
    expect(l.status).toBe(403);
    expect(l.body.error.code).toBe('ACCOUNT_SUSPENDED');

    // a password reset is not a way out of a suspension
    await api().post(`${API}/auth/password/forgot`).send({ identifier: s.email }).expect(202);
    const secret = secretFor(h, s.email, 'password_reset');
    if (secret)
      await api()
        .post(`${API}/auth/password/reset`)
        .send({ token: secret, newPassword: 'escape attempt 12' });
    expect((await User.findById(s.id))?.status).toBe('suspended');
    expect(
      (
        await api()
          .post(`${API}/auth/login`)
          .send({ identifier: s.email, password: 'escape attempt 12' })
      ).status,
    ).toBe(403);

    expect((await setStatus(root, s.id, 'active')).status).toBe(200);
    expect((await me(s)).status).toBe(401);
    expect((await me(s2)).status).toBe(401);
    expect((await refresh(s.refreshToken)).status).toBe(401);
    expect((await refresh(s2.refreshToken)).status).toBe(401);
    expect((await SessionModel.find({ userId: s.id })).every((x) => x.revokedAt)).toBe(true);
    const pw = secret ? 'escape attempt 12' : PASSWORD;
    expect(
      (await api().post(`${API}/auth/login`).send({ identifier: s.email, password: pw })).status,
    ).toBe(200);
  });

  it('A5-2 a staff member suspended between password and TOTP step cannot finish the MFA login', async () => {
    const staff = await createStaff(h.app, ['moderator']);
    const step1 = await api()
      .post(`${API}/auth/login`)
      .send({ identifier: staff.email, password: PASSWORD });
    expect(step1.body.status).toBe('mfa_required');
    expect((await setStatus(root, staff.id, 'suspended')).status).toBe(200);
    const before = await SessionModel.countDocuments({ userId: staff.id });
    const step2 = await api()
      .post(`${API}/auth/mfa/verify`)
      .send({ mfaToken: step1.body.mfaToken, code: totpAt(staff.totpSecret, currentStep() + 1) });
    expect(step2.status).toBe(403);
    expect(step2.body.error.code).toBe('ACCOUNT_SUSPENDED');
    expect(await SessionModel.countDocuments({ userId: staff.id })).toBe(before);
    expect((await me(staff)).status).toBe(401);
  });
});

// ===========================================================================
describe('A6 role and permission changes reach live sessions on the next request', () => {
  it('A6-1 granting and revoking farm_owner changes what the SAME access token may do', async () => {
    const u = await createUser(h.app);
    const createFarm = () => api().post(`${API}/farms`).set(u.auth).send({ name: 'A6 Farm' });
    expect((await createFarm()).status).toBe(403);
    await api()
      .post(`${API}/users/${u.id}/roles`)
      .set(root.auth)
      .send({ roleKey: 'farm_owner' })
      .expect(201);
    expect((await createFarm()).status).toBe(201);
    await api().delete(`${API}/users/${u.id}/roles/farm_owner`).set(root.auth).expect(200);
    const after = await createFarm();
    expect(after.status).toBe(403);
    expect(after.body.error.code).toBe('FARM_OWNER_REQUIRED');
    const role = (await Role.findOne({ key: 'farm_owner' }))!;
    expect(await UserRole.exists({ userId: u.id, roleId: role._id })).toBeNull();
  });

  it('A6-2 editing a role’s permissions applies to holders’ existing MFA sessions immediately', async () => {
    const staff = await createStaffWithPermissions(h.app, root, ['users.read']);
    const link = (await UserRole.find({ userId: staff.id }))!;
    const role = (
      await Role.find({ _id: { $in: link.map((l) => l.roleId) }, isSystem: false })
    )[0]!;
    expect((await api().get(`${API}/admin/users`).set(staff.auth)).status).toBe(200);
    expect((await api().get(`${API}/admin/audit-logs`).set(staff.auth)).status).toBe(403);
    await api()
      .patch(`${API}/admin/roles/${role._id}`)
      .set(root.auth)
      .send({ permissions: ['audit_logs.read'] })
      .expect(200);
    const perms = await Permission.find({
      _id: { $in: (await RolePermission.find({ roleId: role._id })).map((x) => x.permissionId) },
    });
    expect(perms.map((p) => p.key)).toEqual(['audit_logs.read']);
    expect((await api().get(`${API}/admin/users`).set(staff.auth)).status).toBe(403);
    expect((await api().get(`${API}/admin/audit-logs`).set(staff.auth)).status).toBe(200);
  });

  it('A6-3 revoking an MFA-protected role ends the holder’s sessions (access + refresh)', async () => {
    const staff = await createStaff(h.app, ['support']);
    expect((await api().get(`${API}/admin/users`).set(staff.auth)).status).toBe(200);
    await api().delete(`${API}/users/${staff.id}/roles/support`).set(root.auth).expect(200);
    expect((await me(staff)).status).toBe(401);
    expect((await refresh(staff.refreshToken)).status).toBe(401);
    expect(
      (await SessionModel.find({ userId: staff.id })).every(
        (x) => x.revokedReason === 'role_revoked',
      ),
    ).toBe(true);
  });
});

// ===========================================================================
describe('A7 unauthorised admin access and privilege escalation', () => {
  it('A7-1 anonymous 401, buyer 403, staff without MFA 403 MFA_REQUIRED, staff lacking the permission 403 — and no state changes', async () => {
    const victim = await createUser(h.app);
    const buyer = await createUser(h.app);
    const noMfa = await createStaff(h.app, ['admin'], { enrollMfa: false });
    const wrongPerm = await createStaffWithPermissions(h.app, root, ['users.read']);
    const body = { status: 'suspended', reason: 'unauthorised attempt' };
    const path = `${API}/admin/users/${victim.id}/status`;
    expect((await api().patch(path).send(body)).status).toBe(401);
    expect((await api().patch(path).set(buyer.auth).send(body)).status).toBe(403);
    const r = await api().patch(path).set(noMfa.auth).send(body);
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('MFA_REQUIRED');
    expect((await api().patch(path).set(wrongPerm.auth).send(body)).status).toBe(403);
    expect((await User.findById(victim.id))?.status).toBe('active');
    expect((await me(victim)).status).toBe(200);
  });

  it('A7-2 self-grant, granting a protected role, and granting a role with permissions the actor lacks are refused; nothing is written', async () => {
    const admin = await createStaff(h.app, ['admin']);
    const target = await createUser(h.app);
    const self = await api()
      .post(`${API}/users/${admin.id}/roles`)
      .set(admin.auth)
      .send({ roleKey: 'moderator' });
    expect(self.status).toBe(403);
    expect(self.body.error.code).toBe('SELF_ROLE_CHANGE');
    for (const roleKey of ['admin', 'super_admin', 'finance_admin']) {
      const res = await api()
        .post(`${API}/users/${target.id}/roles`)
        .set(admin.auth)
        .send({ roleKey });
      expect(res.status, roleKey).toBe(403);
      expect(res.body.error.code).toBe('PRIVILEGE_ESCALATION');
    }
    const keys = (
      await Role.find({
        _id: {
          $in: [
            ...(await UserRole.find({ userId: target.id })).map((l) => l.roleId),
            ...(await UserRole.find({ userId: admin.id })).map((l) => l.roleId),
          ],
        },
      })
    ).map((r) => r.key);
    expect(keys).not.toContain('super_admin');
    expect(keys).not.toContain('finance_admin');
    expect(keys).not.toContain('moderator');
    expect(await UserRole.countDocuments({ userId: target.id })).toBe(1);
    // an admin (no permissions.manage) cannot create a role carrying permissions
    const mint = await api()
      .post(`${API}/admin/roles`)
      .set(admin.auth)
      .send({ key: 'a7_minted', name: 'Minted', permissions: ['users.read'] });
    expect(mint.status).toBe(403);
    expect(await Role.exists({ key: 'a7_minted' })).toBeNull();
  });

  it('A7-3 mass-assignment of status, roles and verification/subscription fields through profile, admin and registration bodies is rejected', async () => {
    const u = await createUser(h.app);
    const before = (await User.findById(u.id))!.toObject();
    for (const extra of [
      { status: 'active' },
      { roles: ['super_admin'] },
      { emailVerified: true },
      { emailVerifiedAt: new Date().toISOString() },
      { identityVerification: 'verified' },
      { sellerVerification: 'verified' },
      { subscriptionStatus: 'active' },
      { mfa: { enabled: false } },
      { email: 'takeover@example.test' },
    ]) {
      const res = await api()
        .patch(`${API}/users/me`)
        .set(u.auth)
        .send({ displayName: 'Mass', ...extra });
      expect(res.status, JSON.stringify(extra)).toBe(400);
    }
    const adminEdit = await api()
      .patch(`${API}/users/${u.id}`)
      .set(root.auth)
      .send({ displayName: 'x', sellerVerification: 'verified' });
    expect(adminEdit.status).toBe(400);
    const st = await api()
      .patch(`${API}/admin/users/${u.id}/status`)
      .set(root.auth)
      .send({ status: 'active', reason: 'mass assign', identityVerification: 'verified' });
    expect(st.status).toBe(400);
    const pend = await setStatus(root, u.id, 'pending_verification');
    expect(pend.status).toBe(400);
    const sub = await api()
      .post(`${API}/registrations`)
      .set(u.auth)
      .send({ type: 'seller', status: 'APPROVED', userId: root.id });
    expect(sub.status).toBe(400);
    const after = (await User.findById(u.id))!.toObject();
    for (const k of [
      'status',
      'email',
      'displayName',
      'identityVerification',
      'sellerVerification',
      'subscriptionStatus',
      'emailVerifiedAt',
    ] as const)
      expect(after[k], k).toEqual(before[k]);
    expect(await Registration.countDocuments({ userId: { $in: [u.id, root.id] } })).toBe(0);
  });
});

// ===========================================================================
describe('A8 status dimensions are separate', () => {
  it('A8-1 the model has four independent fields', () => {
    const paths = ['status', 'identityVerification', 'sellerVerification', 'subscriptionStatus'];
    for (const p of paths) expect(User.schema.path(p), p).toBeDefined();
    expect(User.schema.path('emailVerifiedAt')).toBeDefined();
    expect(User.schema.path('phoneVerifiedAt')).toBeDefined();
    const enums = paths.map((p) => (User.schema.path(p) as any).enumValues as string[]);
    expect(enums[0]).toContain('suspended');
    expect(enums[1]).toContain('verified');
    expect(enums[2]).toContain('verified');
    expect(enums[3]).toContain('past_due');
  });

  it('A8-2 changing one dimension through the API never moves another', async () => {
    const u = await createUser(h.app);
    const snap = async () => {
      const x = (await User.findById(u.id))!;
      return {
        status: x.status,
        identity: x.identityVerification,
        seller: x.sellerVerification,
        sub: x.subscriptionStatus,
        email: Boolean(x.emailVerifiedAt),
      };
    };
    const submit = (type: string) => api().post(`${API}/registrations`).set(u.auth).send({ type });
    const decide = (id: string, a: string) =>
      api()
        .post(`${API}/admin/registrations/${id}/${a}`)
        .set(regAdmin.auth)
        .send({ reason: 'QA decision' });

    // identity approval → only identity
    const idReg = (await submit('identity')).body.registration.id;
    expect(await snap()).toEqual({
      status: 'active',
      identity: 'pending',
      seller: 'none',
      sub: 'none',
      email: false,
    });
    await decide(idReg, 'approve').expect(200);
    expect(await snap()).toEqual({
      status: 'active',
      identity: 'verified',
      seller: 'none',
      sub: 'none',
      email: false,
    });

    // email verification → only emailVerifiedAt
    await api().post(`${API}/auth/verify/resend`).send({ identifier: u.email }).expect(202);
    await api()
      .post(`${API}/auth/verify/email`)
      .send({ token: secretFor(h, u.email, 'verify_email') })
      .expect(204);
    expect(await snap()).toEqual({
      status: 'active',
      identity: 'verified',
      seller: 'none',
      sub: 'none',
      email: true,
    });

    // seller approval and suspension → only seller (+ role)
    const sReg = (await submit('seller')).body.registration.id;
    await decide(sReg, 'approve').expect(200);
    expect(await snap()).toEqual({
      status: 'active',
      identity: 'verified',
      seller: 'verified',
      sub: 'none',
      email: true,
    });
    await decide(sReg, 'suspend').expect(200);
    expect(await snap()).toEqual({
      status: 'active',
      identity: 'verified',
      seller: 'suspended',
      sub: 'none',
      email: true,
    });
    expect((await me(u)).status).toBe(200); // a seller suspension is not an account suspension

    // account suspension / reactivation → only status
    await setStatus(root, u.id, 'suspended').expect(200);
    expect(await snap()).toEqual({
      status: 'suspended',
      identity: 'verified',
      seller: 'suspended',
      sub: 'none',
      email: true,
    });
    await setStatus(root, u.id, 'active').expect(200);
    expect(await snap()).toEqual({
      status: 'active',
      identity: 'verified',
      seller: 'suspended',
      sub: 'none',
      email: true,
    });
    expect((await Registration.findById(idReg))?.status).toBe('APPROVED');
    expect((await Registration.findById(sReg))?.status).toBe('SUSPENDED');

    // the admin view reports them separately
    const detail = await api().get(`${API}/admin/users/${u.id}`).set(root.auth);
    expect(detail.body.user).toMatchObject({
      status: 'active',
      identityVerification: 'verified',
      sellerVerification: 'suspended',
      subscriptionStatus: 'none',
      emailVerified: true,
    });
  });

  it('A8-3 paying for an order changes order/payment status only, never the buyer’s account or subscription fields', async () => {
    const d = await w.deal({ delivery: false });
    const before = (await User.findById(d.buyer.id))!.toObject();
    const o = await w.pickup(d);
    expect((await payOrder(h, d.buyer, o)).result).toBe('succeeded');
    expect((await Order.findById(o.id))?.status).toBe('PAID');
    expect(await Payment.countDocuments({ orderId: o.id, status: 'succeeded' })).toBe(1);
    const after = (await User.findById(d.buyer.id))!.toObject();
    for (const k of [
      'status',
      'identityVerification',
      'sellerVerification',
      'subscriptionStatus',
    ] as const)
      expect(after[k], k).toBe(before[k]);
  });
});

// ===========================================================================
// I. Dashboard and reporting — a farm with real API-made data
// ===========================================================================
const SALE: OrderStatus[] = ['PAID', 'PROCESSING', 'SHIPPED', 'DELIVERED'];
interface Fx {
  seller: Session;
  farmId: string;
  F: Types.ObjectId;
  orders: Record<string, string>;
}
let fx: Fx;
const RANGE = () => `from=${daysAgo(5)}&to=${daysAhead(1)}`;
const dash = (s: Session, qs = '') =>
  api().get(`${API}/farms/${fx.farmId}/dashboard?${RANGE()}&fresh=true${qs}`).set(s.auth);
const csv = (s: Session, section: string, qs = '') =>
  api()
    .get(`${API}/farms/${fx.farmId}/dashboard/export?section=${section}&${RANGE()}${qs}`)
    .set(s.auth);
const BOM = String.fromCharCode(0xfeff);
const rowsOf = (text: string) =>
  text
    .replace(BOM, '')
    .trim()
    .split('\r\n')
    .map((l) => l.split(','));
const minor = (v: string | undefined) => Math.round(Number(v) * 100);

async function refundPaidOrder(buyer: Session, orderId: string) {
  await w.call('post', buyer, `/orders/${orderId}/cancel`, { reason: 'Changed my mind' });
  const refund = (await Refund.findOne({ orderId }))!;
  await api()
    .post(`${API}/admin/finance/refunds/${refund._id}/approve`)
    .set(fin.auth)
    .send({ confirmation: refund.refundNo })
    .expect(200);
  const stored = (await Refund.findById(refund._id))!;
  h.payments!.settleRefund(stored.providerRef!, 'succeeded');
  await send(h.app, providerEvent('refund.succeeded', stored.providerRef!, stored.amountMinor));
}

describe('I1–I2 farm dashboard reconciles with the source collections', () => {
  beforeAll(async () => {
    // a 5 % platform commission so commission, gross and net are distinct numbers
    const rule = await api().post(`${API}/admin/finance/commission-rules`).set(fin.auth).send({
      name: 'Audit 5%',
      feeBps: 500,
      categories: [],
      startsAt: '2020-01-01T00:00:00.000Z',
      priority: 10,
      reason: 'Audit dashboard pricing',
    });
    expect(rule.status, JSON.stringify(rule.body)).toBe(201);
    const seller = await w.sellerUser();
    const farmId = await makeFarm(h.app, seller, 'Audit Dashboard Farm');
    const orders: Record<string, string> = {};
    // delivery order, paid (shipping charged)
    const d1 = await w.deal({ seller, farmId, delivery: true, price: 4_000_000 });
    const o1 = await w.checkout(d1);
    await payOrder(h, d1.buyer, o1);
    orders['paid'] = o1.id;
    // pickup, paid and delivered
    const d2 = await w.deal({ seller, farmId, delivery: false, price: 3_000_000 });
    const o2 = await w.pickup(d2);
    await payOrder(h, d2.buyer, o2);
    await w.complete(d2, o2);
    orders['delivered'] = o2.id;
    // pickup, paid then cancelled → refunded
    const d3 = await w.deal({ seller, farmId, delivery: false, price: 2_000_000 });
    const o3 = await w.pickup(d3);
    await payOrder(h, d3.buyer, o3);
    await refundPaidOrder(d3.buyer, o3.id);
    orders['refunded'] = o3.id;
    // pickup, cancelled before payment
    const d4 = await w.deal({ seller, farmId, delivery: false, price: 1_000_000 });
    const o4 = await w.pickup(d4);
    await w.call('post', d4.buyer, `/orders/${o4.id}/cancel`, { reason: 'No longer needed' });
    orders['cancelled'] = o4.id;
    // pickup, awaiting payment
    const d5 = await w.deal({ seller, farmId, delivery: false, price: 900_000 });
    orders['pending'] = (await w.pickup(d5)).id;
    // expenses through the API: one assigned to a buffalo, one farm-wide
    await w
      .call('post', seller, `/farms/${farmId}/expenses`, {
        category: 'feed',
        expenseDate: daysAgo(2),
        amount: 1234.5,
        description: 'Hay bales',
        animalId: d1.animalId,
      })
      .expect(201);
    await w
      .call('post', seller, `/farms/${farmId}/expenses`, {
        category: 'labor',
        expenseDate: daysAgo(1),
        amount: 800,
        description: 'Farm hand',
      })
      .expect(201);
    // an extra cattle animal
    await mkAnimal(h.app, seller, farmId, {
      animalTypeId: await typeIdOf(h.app, seller, 'cattle'),
      sex: 'male',
    });
    fx = { seller, farmId, F: new Types.ObjectId(farmId), orders };
  }, 180_000);

  it('I1-1 the order statuses produced by the real flows are as expected', async () => {
    const st = async (k: string) => (await Order.findById(fx.orders[k]))?.status;
    expect(await st('paid')).toBe('PAID');
    expect(await st('delivered')).toBe('DELIVERED');
    expect(await st('refunded')).toBe('REFUNDED');
    expect(await st('cancelled')).toBe('CANCELLED');
    expect(await st('pending')).toBe('PENDING_PAYMENT');
  });

  it('I1-2 sales, costs and animal totals equal sums computed directly from orders, payments, expenses and animals', async () => {
    const res = await dash(fx.seller);
    expect(res.status).toBe(200);
    const s = res.body.sections.sales.metrics;
    const c = res.body.sections.costs.metrics;
    const a = res.body.sections.animals.metrics;

    const all = await Order.find({ farmId: fx.F });
    const standing = all.filter((o) => SALE.includes(o.status) && o.paidAt);
    const sum = (
      rows: typeof all,
      k: 'itemsMinor' | 'shippingMinor' | 'platformFeeMinor' | 'sellerPayoutMinor',
    ) => rows.reduce((t, o) => t + o[k], 0);
    expect(s.ordersCreated).toBe(all.length);
    expect(s.ordersPaid).toBe(standing.length);
    expect(s.grossSalesMinor).toBe(sum(standing, 'itemsMinor'));
    expect(s.shippingCollectedMinor).toBe(sum(standing, 'shippingMinor'));
    expect(s.platformCommissionMinor).toBe(sum(standing, 'platformFeeMinor'));
    expect(s.estimatedNetProceedsMinor).toBe(sum(standing, 'sellerPayoutMinor'));
    expect(s.shippingCollectedMinor).toBeGreaterThan(0);
    expect(s.platformCommissionMinor).toBeGreaterThan(0);

    // captured money for standing orders = what buyers paid = gross + shipping
    const pays = await Payment.find({
      orderId: { $in: standing.map((o) => o._id) },
      status: 'succeeded',
    });
    expect(pays.reduce((t, p) => t + p.amountMinor, 0)).toBe(
      s.grossSalesMinor + s.shippingCollectedMinor,
    );
    expect(sum(standing, 'itemsMinor') + sum(standing, 'shippingMinor')).toBe(
      standing.reduce((t, o) => t + o.grandTotalMinor, 0),
    );

    const ex = await FarmExpense.find({ farmId: fx.F, voided: false });
    expect(c.recordedCostMinor).toBe(ex.reduce((t, e) => t + e.amountMinor, 0));
    expect(c.recordedCostMinor).toBe(123_450 + 80_000);
    expect(c.costAssignedToAnimalsMinor + c.farmWideCostMinor).toBe(c.recordedCostMinor);
    expect(c.farmWideCostMinor).toBe(80_000);

    expect(a.totalRecorded).toBe(await Animal.countDocuments({ farmId: fx.F, archivedAt: null }));
    expect(a.animalsOnFarm).toBe(
      await Animal.countDocuments({
        farmId: fx.F,
        archivedAt: null,
        currentStatus: { $in: ['active', 'for_sale'] },
      }),
    );
  });

  it('I2-1 cancelled and refunded orders are excluded from gross and shown apart; gross − commission = net; released + pending = net', async () => {
    const s = (await dash(fx.seller)).body.sections.sales.metrics;
    const refunded = (await Order.findById(fx.orders['refunded']))!;
    const cancelled = (await Order.findById(fx.orders['cancelled']))!;
    const delivered = (await Order.findById(fx.orders['delivered']))!;
    expect(s.refundedGrossMinor).toBe(refunded.itemsMinor);
    expect(s.cancelledOrders).toBe(1);
    expect(s.grossSalesMinor - s.platformCommissionMinor).toBe(s.estimatedNetProceedsMinor);
    expect(s.netProceedsReleasedMinor).toBe(delivered.sellerPayoutMinor);
    expect(s.netProceedsReleasedMinor + s.netProceedsPendingMinor).toBe(
      s.estimatedNetProceedsMinor,
    );
    expect(s.netProceedsOverRecordedCostMinor).toBe(s.estimatedNetProceedsMinor - 203_450);
    // shipping is not inside gross and not inside net
    const paid = (await Order.findById(fx.orders['paid']))!;
    expect(paid.itemsMinor - paid.platformFeeMinor).toBe(paid.sellerPayoutMinor);
    expect(s.grossSalesMinor).not.toBe(s.grossSalesMinor + s.shippingCollectedMinor);

    const rows = rowsOf((await csv(fx.seller, 'orders')).text);
    const by = new Map(rows.slice(1).map((r) => [r[0], r]));
    expect(by.get(refunded.orderNo)?.[11]).toBe('no');
    expect(by.get(cancelled.orderNo)?.[11]).toBe('no');
    expect(by.get(delivered.orderNo)?.[11]).toBe('yes');
    expect(by.get(paid.orderNo)?.[11]).toBe('yes');
  });

  it('I2-2 an animal-type filter that cannot apply to sales is disclosed in the sales section', async () => {
    const res = await dash(fx.seller, '&animalType=cattle&sections=sales,costs');
    const all = await dash(fx.seller, '&sections=sales,costs');
    const sales = res.body.sections.sales;
    // costs are narrowed to cattle (none), sales stay farm-wide, and net-over-cost mixes the two scopes
    expect(res.body.sections.costs.metrics.recordedCostMinor).toBe(0);
    expect(sales.metrics.grossSalesMinor).toBe(all.body.sections.sales.metrics.grossSalesMinor);
    const disclosed = (sales.notes ?? []).some((n: string) => /animal[- ]type/i.test(n));
    expect(disclosed, 'sales notes must say the animal-type filter does not apply to sales').toBe(
      true,
    );
  });

  it('I2-3 the orders CSV does not silently ignore an animal-type filter it accepts', async () => {
    const exp = await csv(fx.seller, 'orders', '&animalType=cattle');
    if (exp.status === 200) {
      // no order on this farm is for a cattle animal
      expect(
        rowsOf(exp.text).slice(1),
        'cattle-filtered orders export must not list buffalo orders',
      ).toHaveLength(0);
    } else {
      expect(exp.status).toBe(400);
    }
  });
});

// ===========================================================================
describe('I3 date ranges and Bangkok day boundaries', () => {
  let farmId: string;
  let seller: Session;
  let late: any; // paid 23:30 Bangkok on D
  let early: any; // paid 00:30 Bangkok on D+1
  const D = daysAgo(20);
  const D1 = new Date(new Date(`${D}T00:00:00Z`).getTime() + 86_400_000).toISOString().slice(0, 10);
  const D0 = new Date(new Date(`${D}T00:00:00Z`).getTime() - 86_400_000).toISOString().slice(0, 10);
  const q = (from: string, to: string, extra = '') =>
    api()
      .get(
        `${API}/farms/${farmId}/dashboard?from=${from}&to=${to}&fresh=true&sections=sales,costs${extra}`,
      )
      .set(seller.auth);

  beforeAll(async () => {
    seller = await w.sellerUser();
    farmId = await makeFarm(h.app, seller, 'Boundary Farm');
    const mk = async (price: number, at: string) => {
      const d = await w.deal({ seller, farmId, delivery: false, price });
      const o = await w.pickup(d);
      await payOrder(h, d.buyer, o);
      await Order.collection.updateOne(
        { _id: new Types.ObjectId(o.id) },
        { $set: { paidAt: new Date(at), createdAt: new Date(new Date(at).getTime() - 600_000) } },
      );
      return (await Order.findById(o.id))!;
    };
    late = await mk(1_100_000, `${D}T23:30:00+07:00`);
    early = await mk(2_200_000, `${D1}T00:30:00+07:00`);
    await w
      .call('post', seller, `/farms/${farmId}/expenses`, {
        category: 'feed',
        expenseDate: D,
        amount: 500,
        description: 'Boundary feed',
      })
      .expect(201);
  }, 120_000);

  it('I3-1 an order paid at 23:30 Bangkok counts on that day and one paid at 00:30 counts on the next, in totals, series and CSV', async () => {
    expect(late.paidAt.toISOString()).toBe(`${D}T16:30:00.000Z`);
    const dayD = (await q(D, D)).body.sections.sales.metrics;
    expect(dayD.grossSalesMinor).toBe(late.itemsMinor);
    expect(dayD.ordersPaid).toBe(1);
    const dayD1 = (await q(D1, D1)).body.sections.sales.metrics;
    expect(dayD1.grossSalesMinor).toBe(early.itemsMinor);
    const both = (await q(D, D1, '&granularity=day')).body.sections.sales;
    expect(both.series.grossSales).toEqual([
      { period: D, value: late.itemsMinor },
      { period: D1, value: early.itemsMinor },
    ]);
    const rows = rowsOf(
      (
        await api()
          .get(`${API}/farms/${farmId}/dashboard/export?section=orders&from=${D}&to=${D}`)
          .set(seller.auth)
      ).text,
    );
    expect(rows.slice(1).map((r) => r[0])).toEqual([late.orderNo]);
    expect(rows[1]![2]).toBe(D); // "Paid" is the Bangkok calendar day, not the UTC one
  });

  it('I3-2 a date-only expense belongs to its own Bangkok day', async () => {
    expect((await q(D, D)).body.sections.costs.metrics.recordedCostMinor).toBe(50_000);
    expect((await q(D0, D0)).body.sections.costs.metrics.recordedCostMinor).toBe(0);
    expect((await q(D1, D1)).body.sections.costs.metrics.recordedCostMinor).toBe(0);
  });

  it('I3-3 invalid ranges are rejected on both the dashboard and the export', async () => {
    const bad = [
      `from=${D1}&to=${D}`,
      'from=2026-02-30&to=2026-03-02',
      'from=2024-01-01&to=2026-01-01',
      'from=2026-01-01&to=2026-06-30&granularity=day',
      'from=26-01-01&to=2026-01-02',
      `from=${D}&to=${D}&tz=UTC`,
    ];
    for (const qs of bad) {
      const d = await api().get(`${API}/farms/${farmId}/dashboard?${qs}`).set(seller.auth);
      expect(d.status, `dashboard ${qs}`).toBe(400);
      const e = await api()
        .get(`${API}/farms/${farmId}/dashboard/export?section=orders&${qs}`)
        .set(seller.auth);
      expect(e.status, `export ${qs}`).toBe(400);
    }
  });
});

// ===========================================================================
describe('I4 cross-farm and role-limited access to dashboard and export', () => {
  it('I4-1 an unrelated farm owner gets 404 on dashboard and every export, and sees none of this farm’s figures', async () => {
    const other = await w.sellerUser();
    await makeFarm(h.app, other, 'Neighbour');
    expect((await dash(other)).status).toBe(404);
    for (const section of ['orders', 'costs', 'animals'])
      expect((await csv(other, section)).status, section).toBe(404);
  });

  it('I4-2 a removed manager loses dashboard and export on the next request, even with a warm cache', async () => {
    const mgr = await createUser(h.app);
    const memberId = await addFarmMember(h.app, fx.seller, fx.farmId, mgr, 'manager');
    const warm = await api().get(`${API}/farms/${fx.farmId}/dashboard?${RANGE()}`).set(mgr.auth);
    expect(warm.body.sections.sales.available).toBe(true);
    expect((await csv(mgr, 'orders')).status).toBe(200);
    await api()
      .delete(`${API}/farms/${fx.farmId}/members/${memberId}`)
      .set(fx.seller.auth)
      .expect(204);
    expect(await FarmMember.exists({ farmId: fx.F, userId: mgr.id })).toBeNull();
    expect(
      (await api().get(`${API}/farms/${fx.farmId}/dashboard?${RANGE()}`).set(mgr.auth)).status,
    ).toBe(404);
    expect((await csv(mgr, 'orders')).status).toBe(404);
    expect((await csv(mgr, 'costs')).status).toBe(404);
  });

  it('I4-3 a manager demoted to viewer/worker immediately loses sales and costs (no stale cached report); explicit section requests carry no data', async () => {
    const mgr = await createUser(h.app);
    const memberId = await addFarmMember(h.app, fx.seller, fx.farmId, mgr, 'manager');
    const url = `${API}/farms/${fx.farmId}/dashboard?${RANGE()}&sections=sales,costs,animals`;
    const first = await api().get(url).set(mgr.auth);
    expect(first.body.sections.sales.available).toBe(true);
    for (const role of ['viewer', 'worker']) {
      await api()
        .patch(`${API}/farms/${fx.farmId}/members/${memberId}`)
        .set(fx.seller.auth)
        .send({ role })
        .expect(200);
      expect((await FarmMember.findById(memberId))?.role).toBe(role);
      const res = await api().get(url).set(mgr.auth);
      expect(res.status).toBe(200);
      expect(res.body.sections.sales).toMatchObject({ available: false, metrics: {} });
      expect(res.body.sections.costs).toMatchObject({ available: false, metrics: {} });
      expect(res.body.sections.animals.available).toBe(true);
      expect(JSON.stringify(res.body)).not.toContain(
        String(first.body.sections.sales.metrics.grossSalesMinor),
      );
      expect((await csv(mgr, 'orders')).status).toBe(403);
      expect((await csv(mgr, 'costs')).status).toBe(403);
      expect((await csv(mgr, 'animals')).status).toBe(200);
    }
  });

  it('I4-4 platform staff with farms.read but no MFA are told MFA is required and get no data', async () => {
    const staff = await createStaff(h.app, ['support'], { enrollMfa: false });
    const res = await dash(staff);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('MFA_REQUIRED');
    expect((await csv(staff, 'animals')).status).toBe(403);
  });
});

// ===========================================================================
describe('I5 CSV equals the dashboard; admin dashboard needs permission + MFA', () => {
  it('I5-1 for the same filters the orders and costs CSV add up to the dashboard figures (gross, shipping, fee, net, costs)', async () => {
    for (const qs of ['', '&orderKind=animal', '&orderKind=product']) {
      const s = (await dash(fx.seller, qs)).body.sections;
      const rows = rowsOf((await csv(fx.seller, 'orders', qs)).text).slice(1);
      const counted = rows.filter((r) => r[11] === 'yes');
      const tot = (i: number) => counted.reduce((t, r) => t + minor(r[i]), 0);
      expect(tot(7), `gross ${qs}`).toBe(s.sales.metrics.grossSalesMinor);
      expect(tot(8), `shipping ${qs}`).toBe(s.sales.metrics.shippingCollectedMinor);
      expect(tot(9), `fee ${qs}`).toBe(s.sales.metrics.platformCommissionMinor);
      expect(tot(10), `net ${qs}`).toBe(s.sales.metrics.estimatedNetProceedsMinor);
      expect(counted.length).toBe(s.sales.metrics.ordersPaid);
      const costRows = rowsOf((await csv(fx.seller, 'costs', qs)).text).slice(1);
      expect(costRows.reduce((t, r) => t + minor(r[2]), 0)).toBe(s.costs.metrics.recordedCostMinor);
    }
  });

  it('I5-2 admin dashboard and export: anonymous 401, buyer 403, staff without MFA 403 MFA_REQUIRED, staff without a reporting permission 403', async () => {
    const buyer = await createUser(h.app);
    const noMfa = await createStaff(h.app, ['finance_admin'], { enrollMfa: false });
    const noPerm = await createStaffWithPermissions(h.app, root, ['audit_logs.read']);
    expect((await api().get(`${API}/admin/analytics`)).status).toBe(401);
    expect((await api().get(`${API}/admin/analytics`).set(buyer.auth)).status).toBe(403);
    expect((await api().get(`${API}/admin/analytics`).set(noPerm.auth)).status).toBe(403);
    expect(
      (await api().get(`${API}/admin/analytics/export?section=orders`).set(noPerm.auth)).status,
    ).toBe(403);
    const exp = await api().get(`${API}/admin/analytics/export?section=orders`).set(noMfa.auth);
    expect(exp.status).toBe(403);
    expect(exp.text).not.toContain('Gross');
    const r = await api().get(`${API}/admin/analytics`).set(noMfa.auth);
    expect(r.status).toBe(403);
    expect(r.body.sections).toBeUndefined();
    expect(
      r.body.error.code,
      'un-MFA’d admin should get the machine-readable MFA_REQUIRED code',
    ).toBe('MFA_REQUIRED');
  });

  it('I5-3 admin GMV / shipping / buyer-paid figures equal the order collection; the orders CSV matches', async () => {
    const range = `from=${daysAgo(30)}&to=${daysAhead(1)}`;
    const res = await api().get(`${API}/admin/analytics?${range}&fresh=true`).set(fin.auth);
    expect(res.status).toBe(200);
    const m = res.body.sections.orders.metrics;
    const start = new Date(`${daysAgo(30)}T00:00:00+07:00`);
    const standing = await Order.find({ status: { $in: SALE }, paidAt: { $gte: start } });
    expect(m.gmvMinor).toBe(standing.reduce((t, o) => t + o.itemsMinor, 0));
    expect(m.shippingMinor).toBe(standing.reduce((t, o) => t + o.shippingMinor, 0));
    expect(m.buyerPaidTotalMinor).toBe(standing.reduce((t, o) => t + o.grandTotalMinor, 0));
    expect(m.buyerPaidTotalMinor).toBe(m.gmvMinor + m.shippingMinor);
    expect(m.refundedOrders).toBe(
      await Order.countDocuments({
        status: { $in: ['REFUND_PENDING', 'REFUNDED'] },
        paidAt: { $gte: start },
      }),
    );
    const c = res.body.sections.commissions.metrics;
    expect(c.commissionMinor).toBe(standing.reduce((t, o) => t + o.platformFeeMinor, 0));
    expect(c.commissionMinor).not.toBe(m.gmvMinor);
  });
});
