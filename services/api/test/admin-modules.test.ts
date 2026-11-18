import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { REGISTRATION_STATUSES } from '@farmplus/shared-types';
import {
  AuditLog,
  Registration,
  Role,
  RolePermission,
  Session,
  User,
  UserRole,
} from '../src/models';
import {
  createStaff,
  createStaffWithPermissions,
  createUser,
  startHarness,
  type Staff,
  type TestHarness,
} from './helpers';

let h: TestHarness;
let root: Staff;
beforeAll(async () => {
  h = await startHarness();
  root = await createStaff(h.app, ['super_admin']);
});
afterAll(() => h.stop());

const api = () => request(h.app);
const A = (path: string) => `/api/v1/admin${path}`;
const reason = 'Documents checked against the official registry';

describe('dashboard', () => {
  it('only includes the sections the caller may see', async () => {
    const full = (await api().get(A('/dashboard')).set(root.auth)).body;
    expect(full.users.total).toBeGreaterThan(0);
    expect(Object.keys(full.registrations.byStatus).sort()).toEqual(
      [...REGISTRATION_STATUSES].sort(),
    );
    expect(full.signupsByDay).toHaveLength(14);
    expect(full.audit.eventsLast24h).toBeGreaterThan(0);

    const onlyReports = await createStaffWithPermissions(h.app, root, ['reports.read']);
    const limited = (await api().get(A('/dashboard')).set(onlyReports.auth)).body;
    expect(limited.users).toBeUndefined();
    expect(limited.registrations).toBeUndefined();
    expect(limited.audit).toBeUndefined();

    const withUsers = await createStaffWithPermissions(h.app, root, ['reports.read', 'users.read']);
    const mid = (await api().get(A('/dashboard')).set(withUsers.auth)).body;
    expect(mid.users).toBeDefined();
    expect(mid.audit).toBeUndefined();
  });
});

describe('user search, detail and suspension', () => {
  it('searches, filters, sorts and paginates', async () => {
    const tag = `srch${Date.now()}`;
    for (const n of ['b', 'a', 'c']) {
      await request(h.app)
        .post('/api/v1/auth/register')
        .send({
          email: `${tag}${n}@example.test`,
          password: 'a long passphrase 1',
          displayName: `Zed ${tag} ${n}`,
        });
    }
    const page1 = await api()
      .get(A(`/users?q=${tag}&sortBy=displayName&order=asc&pageSize=2&page=1`))
      .set(root.auth);
    expect(page1.body.total).toBe(3);
    expect(page1.body.items.map((u: { displayName: string }) => u.displayName)).toEqual([
      `Zed ${tag} a`,
      `Zed ${tag} b`,
    ]);
    const page2 = await api()
      .get(A(`/users?q=${tag}&sortBy=displayName&order=asc&pageSize=2&page=2`))
      .set(root.auth);
    expect(page2.body.items).toHaveLength(1);

    const byRole = await api().get(A('/users?role=super_admin')).set(root.auth);
    expect(
      byRole.body.items.every((u: { roles: string[] }) => u.roles.includes('super_admin')),
    ).toBe(true);
    const bad = await api().get(A('/users?status=bogus&pageSize=1000')).set(root.auth);
    expect(bad.status).toBe(400);
    expect(JSON.stringify(page1.body)).not.toMatch(/passwordHash|secretEnc|recoveryCode/);
  });

  it('detail keeps the four status dimensions separate, and audit history needs audit_logs.read', async () => {
    const target = await createUser(h.app);
    const detail = (
      await api()
        .get(A(`/users/${target.id}`))
        .set(root.auth)
    ).body;
    expect(detail.user).toMatchObject({
      status: 'active',
      identityVerification: 'unverified',
      sellerVerification: 'none',
      subscriptionStatus: 'none',
    });
    expect(detail.activeSessions).toBe(1);
    expect(Array.isArray(detail.recentAudit)).toBe(true);

    const noAudit = await createStaffWithPermissions(h.app, root, ['users.read']);
    const limited = (
      await api()
        .get(A(`/users/${target.id}`))
        .set(noAudit.auth)
    ).body;
    expect(limited.recentAudit).toBeUndefined();
    expect((await api().get(A('/users/not-an-id')).set(root.auth)).status).toBe(404);
  });

  it('suspension is audited with a reason, ends sessions, and keeps the Part 03 safeguards', async () => {
    const target = await createUser(h.app);
    const res = await api()
      .patch(A(`/users/${target.id}/status`))
      .set(root.auth)
      .send({ status: 'suspended', reason: 'Fraud report #7' });
    expect(res.status).toBe(200);
    expect(res.body.user.status).toBe('suspended');
    expect((await api().get('/api/v1/auth/me').set(target.auth)).status).toBe(401);
    const log = await AuditLog.findOne({ action: 'user.status_changed', targetId: target.id });
    expect(log?.metadata).toMatchObject({ to: 'suspended', reason: 'Fraud report #7' });
    expect(String(log?.actorId)).toBe(root.id);

    const missingReason = await api()
      .patch(A(`/users/${target.id}/status`))
      .set(root.auth)
      .send({ status: 'active' });
    expect(missingReason.status).toBe(400);
    const self = await api()
      .patch(A(`/users/${root.id}/status`))
      .set(root.auth)
      .send({ status: 'suspended', reason: 'oops oops' });
    expect(self.status).toBe(403);

    const mod = await createStaff(h.app, ['moderator']);
    const support = await createStaffWithPermissions(h.app, root, ['users.suspend', 'users.read']);
    const superior = await api()
      .patch(A(`/users/${mod.id}/status`))
      .set(support.auth)
      .send({ status: 'suspended', reason: 'no way' });
    expect(superior.status).toBe(403); // moderator holds permissions the actor lacks
  });
});

describe('registrations', () => {
  const submit = (u: { auth: Record<string, string> }, body: object) =>
    api().post('/api/v1/registrations').set(u.auth).send(body);

  it('applicants submit their own registration; only live duplicates are blocked', async () => {
    const u = await createUser(h.app);
    const res = await submit(u, {
      type: 'identity',
      documents: [{ kind: 'national_id', url: 'https://files.example.test/id.png' }],
    });
    expect(res.status).toBe(201);
    expect(res.body.registration).toMatchObject({
      type: 'identity',
      status: 'PENDING',
      applicant: { id: u.id },
    });
    expect((await submit(u, { type: 'identity' })).status).toBe(409);
    expect(
      (
        await submit(u, {
          type: 'seller',
          documents: [{ kind: 'x', url: 'http://insecure.test/a' }],
        })
      ).status,
    ).toBe(400);
    expect((await submit(u, { type: 'seller', status: 'APPROVED' })).status).toBe(400); // cannot set own status
    const mine = await api().get('/api/v1/registrations/mine').set(u.auth);
    expect(mine.body.registrations).toHaveLength(1);
    expect((await api().post('/api/v1/registrations').send({ type: 'identity' })).status).toBe(401);
    // Submitting moved only the identity dimension.
    const user = await User.findById(u.id);
    expect([user?.identityVerification, user?.sellerVerification, user?.status]).toEqual([
      'pending',
      'none',
      'active',
    ]);
  });

  it('review → approve records actor, timestamp and reason; effects touch only the matching dimension', async () => {
    const reviewer = await createStaff(h.app, ['registration_admin']);
    const u = await createUser(h.app);
    const created = (await submit(u, { type: 'identity' })).body.registration;

    const reviewed = await api()
      .post(A(`/registrations/${created.id}/review`))
      .set(reviewer.auth);
    expect(reviewed.status).toBe(200);
    expect(reviewed.body.registration).toMatchObject({
      status: 'UNDER_REVIEW',
      review: { byId: reviewer.id },
    });

    const noReason = await api()
      .post(A(`/registrations/${created.id}/approve`))
      .set(reviewer.auth)
      .send({});
    expect(noReason.status).toBe(400);

    const approved = await api()
      .post(A(`/registrations/${created.id}/approve`))
      .set(reviewer.auth)
      .send({ reason });
    expect(approved.status).toBe(200);
    expect(approved.body.registration.status).toBe('APPROVED');
    expect(approved.body.registration.decision).toMatchObject({
      outcome: 'APPROVED',
      byId: reviewer.id,
      reason,
    });
    expect(new Date(approved.body.registration.decision.at).getTime()).toBeGreaterThan(
      Date.now() - 60_000,
    );

    const user = await User.findById(u.id);
    expect([user?.identityVerification, user?.sellerVerification, user?.status]).toEqual([
      'verified',
      'none',
      'active',
    ]);

    const log = await AuditLog.findOne({ action: 'registration.approved', targetId: created.id });
    expect(String(log?.actorId)).toBe(reviewer.id);
    expect(log?.metadata).toMatchObject({
      reason,
      from: 'UNDER_REVIEW',
      to: 'APPROVED',
      applicantId: u.id,
    });
    expect(
      await AuditLog.countDocuments({
        action: 'registration.review_started',
        targetId: created.id,
      }),
    ).toBe(1);
  });

  it('cannot decide twice, skip the state machine, or decide your own registration', async () => {
    const reviewer = await createStaff(h.app, ['registration_admin']);
    const u = await createUser(h.app);
    const reg = (await submit(u, { type: 'farm_owner', businessName: 'Happy Farm' })).body
      .registration;

    expect(
      (
        await api()
          .post(A(`/registrations/${reg.id}/suspend`))
          .set(reviewer.auth)
          .send({ reason })
      ).status,
    ).toBe(409);
    expect(
      (
        await api()
          .post(A(`/registrations/${reg.id}/reinstate`))
          .set(reviewer.auth)
          .send({ reason })
      ).status,
    ).toBe(409);
    await api()
      .post(A(`/registrations/${reg.id}/reject`))
      .set(reviewer.auth)
      .send({ reason })
      .expect(200);
    const again = await api()
      .post(A(`/registrations/${reg.id}/approve`))
      .set(reviewer.auth)
      .send({ reason });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('INVALID_TRANSITION');
    expect(
      (
        await api()
          .post(A(`/registrations/${reg.id}/review`))
          .set(reviewer.auth)
      ).status,
    ).toBe(409);
    // A rejected application can be resubmitted.
    expect((await submit(u, { type: 'farm_owner' })).status).toBe(201);

    // Self-decision: give an applicant reviewer powers and let them try their own application.
    const both = await createStaff(h.app, ['registration_admin']);
    const own = (await submit(both, { type: 'farm_owner' })).body.registration;
    const res = await api()
      .post(A(`/registrations/${own.id}/approve`))
      .set(both.auth)
      .send({ reason });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('SELF_DECISION');
  });

  it('concurrent decisions: exactly one wins', async () => {
    const reviewer = await createStaff(h.app, ['registration_admin']);
    const other = await createStaff(h.app, ['registration_admin']);
    const u = await createUser(h.app);
    const reg = (await submit(u, { type: 'farm_owner' })).body.registration;
    const [a, b] = await Promise.all([
      api()
        .post(A(`/registrations/${reg.id}/approve`))
        .set(reviewer.auth)
        .send({ reason }),
      api()
        .post(A(`/registrations/${reg.id}/reject`))
        .set(other.auth)
        .send({ reason }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(
      await AuditLog.countDocuments({
        targetId: reg.id,
        action: { $in: ['registration.approved', 'registration.rejected'] },
      }),
    ).toBe(1);
  });

  it('seller approval needs verified identity (setting-controlled), grants the role, and suspension revokes it', async () => {
    const reviewer = await createStaff(h.app, ['registration_admin']);
    const u = await createUser(h.app);
    const sellerReg = (await submit(u, { type: 'seller', businessName: 'Somchai Livestock' })).body
      .registration;

    const blocked = await api()
      .post(A(`/registrations/${sellerReg.id}/approve`))
      .set(reviewer.auth)
      .send({ reason });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('IDENTITY_NOT_VERIFIED');
    expect((await Registration.findById(sellerReg.id))?.status).toBe('PENDING');

    const idReg = (await submit(u, { type: 'identity' })).body.registration;
    await api()
      .post(A(`/registrations/${idReg.id}/approve`))
      .set(reviewer.auth)
      .send({ reason })
      .expect(200);
    await api()
      .post(A(`/registrations/${sellerReg.id}/approve`))
      .set(reviewer.auth)
      .send({ reason })
      .expect(200);

    let user = await User.findById(u.id);
    expect([user?.identityVerification, user?.sellerVerification, user?.status]).toEqual([
      'verified',
      'verified',
      'active',
    ]);
    const roleOf = async () =>
      (
        await api()
          .get(A(`/users/${u.id}`))
          .set(root.auth)
      ).body.user.roles as string[];
    expect(await roleOf()).toContain('seller');

    await api()
      .post(A(`/registrations/${sellerReg.id}/suspend`))
      .set(reviewer.auth)
      .send({ reason: 'Complaints received' })
      .expect(200);
    user = await User.findById(u.id);
    // Seller verification is suspended; identity and account status are untouched.
    expect([user?.identityVerification, user?.sellerVerification, user?.status]).toEqual([
      'verified',
      'suspended',
      'active',
    ]);
    expect(await roleOf()).not.toContain('seller');

    await api()
      .post(A(`/registrations/${sellerReg.id}/reinstate`))
      .set(reviewer.auth)
      .send({ reason: 'Appeal accepted' })
      .expect(200);
    expect(await roleOf()).toContain('seller');
    expect((await User.findById(u.id))?.sellerVerification).toBe('verified');
    expect(
      await AuditLog.countDocuments({ targetId: sellerReg.id, action: /^registration\./ }),
    ).toBe(4); // submitted, approved, suspended, reinstated
  });

  it('turning the identity requirement off in settings lets a seller be approved directly', async () => {
    await api()
      .patch(A('/settings'))
      .set(root.auth)
      .send({
        values: { 'registrations.requireIdentityForSeller': false },
        reason: 'Pilot programme',
      })
      .expect(200);
    try {
      const reviewer = await createStaff(h.app, ['registration_admin']);
      const u = await createUser(h.app);
      const reg = (await submit(u, { type: 'seller' })).body.registration;
      await api()
        .post(A(`/registrations/${reg.id}/approve`))
        .set(reviewer.auth)
        .send({ reason })
        .expect(200);
    } finally {
      await api()
        .patch(A('/settings'))
        .set(root.auth)
        .send({ values: { 'registrations.requireIdentityForSeller': true }, reason: 'Pilot ended' })
        .expect(200);
    }
  });

  it('review and approve are separate permissions; list supports status/type/search/sort filters', async () => {
    const reviewOnly = await createStaffWithPermissions(h.app, root, ['registrations.review']);
    const u = await createUser(h.app);
    const reg = (await submit(u, { type: 'farm_owner', businessName: 'Zebra Acres' })).body
      .registration;
    await api()
      .post(A(`/registrations/${reg.id}/review`))
      .set(reviewOnly.auth)
      .expect(200);
    expect(
      (
        await api()
          .post(A(`/registrations/${reg.id}/approve`))
          .set(reviewOnly.auth)
          .send({ reason })
      ).status,
    ).toBe(403);

    const filtered = await api()
      .get(A('/registrations?status=UNDER_REVIEW&type=farm_owner&q=Zebra'))
      .set(reviewOnly.auth);
    expect(filtered.body.items.map((r: { id: string }) => r.id)).toContain(reg.id);
    const none = await api().get(A('/registrations?status=APPROVED&q=Zebra')).set(reviewOnly.auth);
    expect(none.body.items).toHaveLength(0);
    expect((await api().get(A('/registrations?status=NOPE')).set(reviewOnly.auth)).status).toBe(
      400,
    );
  });
});

describe('role administration', () => {
  it('creates custom roles; any role with permissions is MFA-protected; requires permissions.manage to grant', async () => {
    const admin = await createStaff(h.app, ['admin']); // roles.manage but NOT permissions.manage
    const plain = await api()
      .post(A('/roles'))
      .set(admin.auth)
      .send({ key: 'volunteer', name: 'Volunteer' });
    expect(plain.status).toBe(201);
    expect(plain.body.role).toMatchObject({
      key: 'volunteer',
      isSystem: false,
      requiresMfa: false,
      permissions: [],
      userCount: 0,
    });

    const withPerms = await api()
      .post(A('/roles'))
      .set(admin.auth)
      .send({ key: 'sneaky', name: 'Sneaky', permissions: ['users.read'] });
    expect(withPerms.status).toBe(403);
    expect(await Role.exists({ key: 'sneaky' })).toBeNull();

    const created = await api()
      .post(A('/roles'))
      .set(root.auth)
      .send({ key: 'auditor', name: 'Auditor', permissions: ['audit_logs.read', 'reports.read'] });
    expect(created.status).toBe(201);
    expect(created.body.role).toMatchObject({
      requiresMfa: true,
      permissions: ['audit_logs.read', 'reports.read'],
    });
    expect(
      (await api().post(A('/roles')).set(root.auth).send({ key: 'auditor', name: 'Dup' })).status,
    ).toBe(409);
    expect(
      (await api().post(A('/roles')).set(root.auth).send({ key: 'Bad Key', name: 'x' })).status,
    ).toBe(400);
    expect(
      (
        await api()
          .post(A('/roles'))
          .set(root.auth)
          .send({ key: 'extra', name: 'x', isSystem: true })
      ).status,
    ).toBe(400);
    expect(
      (
        await api()
          .post(A('/roles'))
          .set(root.auth)
          .send({ key: 'ghost', name: 'x', permissions: ['not.real'] })
      ).status,
    ).toBe(400);
    const log = await AuditLog.findOne({ action: 'role.created', targetId: 'auditor' });
    expect(log?.metadata).toMatchObject({ permissions: ['audit_logs.read', 'reports.read'] });
  });

  it('updates with a diff audit; cannot touch super_admin; cannot grant what you lack; privileged roles force MFA', async () => {
    const created = (
      await api().post(A('/roles')).set(root.auth).send({ key: 'helper', name: 'Helper' })
    ).body.role;
    const user = await createStaff(h.app, ['helper'], { enrollMfa: false });
    expect(created.requiresMfa).toBe(false);

    const upd = await api()
      .patch(A(`/roles/${created.id}`))
      .set(root.auth)
      .send({ name: 'Helper+', permissions: ['users.read'] });
    expect(upd.status).toBe(200);
    expect(upd.body.role).toMatchObject({
      name: 'Helper+',
      requiresMfa: true,
      permissions: ['users.read'],
    });
    const log = await AuditLog.findOne({ action: 'role.updated', targetId: 'helper' });
    expect(log?.metadata).toMatchObject({
      permissions: { added: ['users.read'], removed: [] },
      name: { from: 'Helper', to: 'Helper+' },
    });
    // Existing holders lost their (non-MFA) sessions the moment the role became privileged.
    expect((await api().get('/api/v1/auth/me').set(user.auth)).status).toBe(401);
    expect(
      (
        await api()
          .patch(A(`/roles/${created.id}`))
          .set(root.auth)
          .send({ name: 'Helper+' })
      ).status,
    ).toBe(409);

    const superRole = await Role.findOne({ key: 'super_admin' });
    const immutable = await api()
      .patch(A(`/roles/${superRole?._id}`))
      .set(root.auth)
      .send({ permissions: [] });
    expect(immutable.status).toBe(403);
    expect(await RolePermission.countDocuments({ roleId: superRole?._id })).toBe(PERMISSION_COUNT);

    const delegate = await createStaffWithPermissions(h.app, root, [
      'roles.manage',
      'permissions.manage',
      'users.read',
    ]);
    const escalate = await api()
      .patch(A(`/roles/${created.id}`))
      .set(delegate.auth)
      .send({ permissions: ['users.read', 'payments.refund'] });
    expect(escalate.status).toBe(403);
    expect(escalate.body.error.code).toBe('PRIVILEGE_ESCALATION');
  });

  it('lists roles with user counts and a permission → roles matrix', async () => {
    const roles = (await api().get(A('/roles')).set(root.auth)).body.roles as {
      key: string;
      id: string;
      userCount: number;
    }[];
    expect(roles.find((r) => r.key === 'super_admin')?.userCount).toBeGreaterThan(0);
    const one = await api()
      .get(A(`/roles/${roles[0]?.id}`))
      .set(root.auth);
    expect(one.body.role.key).toBe(roles[0]?.key);
    const matrix = (await api().get(A('/permissions')).set(root.auth)).body.permissions as {
      key: string;
      roles: string[];
    }[];
    expect(matrix.find((p) => p.key === 'payments.refund')?.roles).toContain('finance_admin');
    expect(matrix.find((p) => p.key === 'payments.refund')?.roles).not.toContain('admin');
    expect((await api().get(A('/roles/not-an-id')).set(root.auth)).status).toBe(404);
  });

  it('a custom role really grants its permissions (end to end)', async () => {
    const holder = await createStaffWithPermissions(h.app, root, ['audit_logs.read']);
    expect((await api().get(A('/audit-logs')).set(holder.auth)).status).toBe(200);
    expect((await api().get(A('/users')).set(holder.auth)).status).toBe(403);
    expect(await UserRole.countDocuments({ userId: holder.id })).toBe(2); // custom + buyer
  });
});

const PERMISSION_COUNT = 22;

describe('settings', () => {
  it('lists defaults, validates against the registry, audits changes with a reason', async () => {
    const list = (await api().get(A('/settings')).set(root.auth)).body.settings as {
      key: string;
      value: unknown;
      default: unknown;
    }[];
    expect(list.map((s) => s.key)).toEqual(
      expect.arrayContaining([
        'registrations.requireIdentityForSeller',
        'platform.maintenanceMode',
      ]),
    );

    expect(
      (
        await api()
          .patch(A('/settings'))
          .set(root.auth)
          .send({ values: { 'unknown.key': true }, reason: 'testing' })
      ).status,
    ).toBe(400);
    expect(
      (
        await api()
          .patch(A('/settings'))
          .set(root.auth)
          .send({ values: { 'platform.maintenanceMode': 'yes' }, reason: 'testing' })
      ).status,
    ).toBe(400);
    expect(
      (
        await api()
          .patch(A('/settings'))
          .set(root.auth)
          .send({ values: { 'platform.maintenanceMode': true } })
      ).status,
    ).toBe(400); // reason required

    const ok = await api()
      .patch(A('/settings'))
      .set(root.auth)
      .send({ values: { 'platform.maintenanceMode': true }, reason: 'Planned upgrade' });
    expect(ok.status).toBe(200);
    expect(
      ok.body.settings.find((s: { key: string }) => s.key === 'platform.maintenanceMode').value,
    ).toBe(true);
    const log = await AuditLog.findOne({ action: 'settings.updated' }).sort({ createdAt: -1 });
    expect(log?.metadata).toMatchObject({
      reason: 'Planned upgrade',
      changes: { 'platform.maintenanceMode': { from: false, to: true } },
    });
    await api()
      .patch(A('/settings'))
      .set(root.auth)
      .send({ values: { 'platform.maintenanceMode': false }, reason: 'Done' })
      .expect(200);
  });

  it('read and manage are separate permissions', async () => {
    const reader = await createStaffWithPermissions(h.app, root, ['settings.read']);
    expect((await api().get(A('/settings')).set(reader.auth)).status).toBe(200);
    expect(
      (await api().patch(A('/settings')).set(reader.auth).send({ values: {}, reason: 'nothing' }))
        .status,
    ).toBe(403);
  });
});

describe('audit log viewer', () => {
  it('filters by action (exact and prefix), actor, target and date; shows actor names', async () => {
    const reviewer = await createStaff(h.app, ['registration_admin']);
    const u = await createUser(h.app);
    const reg = (
      await request(h.app).post('/api/v1/registrations').set(u.auth).send({ type: 'farm_owner' })
    ).body.registration;
    await api()
      .post(A(`/registrations/${reg.id}/approve`))
      .set(reviewer.auth)
      .send({ reason })
      .expect(200);

    const byTarget = (
      await api()
        .get(A(`/audit-logs?targetType=registration&targetId=${reg.id}`))
        .set(root.auth)
    ).body;
    expect(byTarget.items.map((i: { action: string }) => i.action).sort()).toEqual([
      'registration.approved',
      'registration.submitted',
    ]);
    const approved = byTarget.items.find(
      (i: { action: string }) => i.action === 'registration.approved',
    );
    expect(approved.actor.displayName).toContain('registration_admin');

    const prefix = (
      await api()
        .get(A(`/audit-logs?action=registration.*&actorId=${reviewer.id}`))
        .set(root.auth)
    ).body;
    expect(
      prefix.items.every(
        (i: { action: string; actorId: string }) =>
          i.action.startsWith('registration.') && i.actorId === reviewer.id,
      ),
    ).toBe(true);
    expect(prefix.total).toBeGreaterThan(0);

    const future = new Date(Date.now() + 3_600_000).toISOString();
    expect(
      (
        await api()
          .get(A(`/audit-logs?from=${encodeURIComponent(future)}`))
          .set(root.auth)
      ).body.total,
    ).toBe(0);
    const past = new Date(Date.now() - 3_600_000).toISOString();
    expect(
      (
        await api()
          .get(A(`/audit-logs?from=${encodeURIComponent(past)}&targetId=${reg.id}`))
          .set(root.auth)
      ).body.total,
    ).toBe(2);
    expect((await api().get(A('/audit-logs?from=yesterday')).set(root.auth)).status).toBe(400);
    expect((await api().get(A('/audit-logs?pageSize=500')).set(root.auth)).status).toBe(400);
  });

  it('records the critical actions of this Part and never their secrets', async () => {
    const actions = new Set((await AuditLog.find().distinct('action')) as string[]);
    for (const a of [
      'role.created',
      'role.updated',
      'settings.updated',
      'user.status_changed',
      'registration.approved',
      'registration.rejected',
      'registration.suspended',
      'registration.reinstated',
      'registration.review_started',
    ]) {
      expect(actions.has(a), a).toBe(true);
    }
    expect(JSON.stringify(await AuditLog.find().lean())).not.toMatch(
      /passwordHash|refreshToken|accessToken|secretEnc/,
    );
    expect(await Session.countDocuments()).toBeGreaterThan(0);
  });
});
