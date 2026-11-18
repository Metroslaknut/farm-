import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PERMISSION_KEYS } from '@farmplus/shared-types';
import { currentStep, totpAt } from '../src/lib/totp';
import { errorHandler } from '../src/middleware/error-handler';
import { authenticate } from '../src/middleware/authenticate';
import { requireOwnerOrPermission, requirePermission } from '../src/middleware/authorize';
import { AuditLog, Role, User } from '../src/models';
import { ROLE_DEFINITIONS } from '../src/rbac/definitions';
import { ROLE_KEYS } from '@farmplus/shared-types';
import { PASSWORD, createStaff, createUser, startHarness, type TestHarness } from './helpers';

let h: TestHarness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(() => h.stop());

const api = () => request(h.app);

describe('401 vs 403', () => {
  it('unauthenticated requests get 401 on every protected route', async () => {
    const id = '0123456789abcdef01234567';
    const calls = [
      api().get('/api/v1/users'),
      api().get(`/api/v1/users/${id}`),
      api().put(`/api/v1/users/${id}/status`).send({}),
      api().post(`/api/v1/users/${id}/roles`).send({}),
      api().get('/api/v1/roles'),
      api().get('/api/v1/permissions'),
      api().put('/api/v1/roles/buyer/permissions').send({}),
      api().get('/api/v1/audit-logs'),
    ];
    for (const res of await Promise.all(calls)) expect(res.status).toBe(401);
  });

  it('authenticated users without the permission get 403', async () => {
    const buyer = await createUser(h.app);
    const id = buyer.id;
    expect((await api().get('/api/v1/users').set(buyer.auth)).status).toBe(403);
    expect((await api().get('/api/v1/roles').set(buyer.auth)).status).toBe(403);
    expect((await api().get('/api/v1/audit-logs').set(buyer.auth)).status).toBe(403);
    expect(
      (
        await api()
          .put(`/api/v1/users/${id}/status`)
          .set(buyer.auth)
          .send({ status: 'suspended', reason: 'because' })
      ).status,
    ).toBe(403);
    expect(
      (await api().post(`/api/v1/users/${id}/roles`).set(buyer.auth).send({ roleKey: 'seller' }))
        .status,
    ).toBe(403);
  });

  it('a permission from one role does not leak into others', async () => {
    const mod = await createStaff(h.app, ['moderator']);
    expect((await api().get('/api/v1/users').set(mod.auth)).status).toBe(200); // users.read
    expect((await api().get('/api/v1/audit-logs').set(mod.auth)).status).toBe(403); // not held
    expect((await api().get('/api/v1/roles').set(mod.auth)).status).toBe(403);
  });

  it('multiple roles combine their permissions', async () => {
    const both = await createStaff(h.app, ['moderator', 'finance_admin']);
    const me = await api().get('/api/v1/auth/me').set(both.auth);
    expect(me.body.permissions).toEqual(
      expect.arrayContaining(['listings.moderate', 'payments.refund']),
    );
    expect(me.body.user.roles).toEqual(
      expect.arrayContaining(['moderator', 'finance_admin', 'buyer']),
    );
  });
});

describe('default role read/write authorization matrix', () => {
  it('each defined role gets only the representative user read and suspension permissions it is granted', async () => {
    for (const roleKey of ROLE_KEYS) {
      const actor = await createStaff(h.app, [roleKey]);
      const hasRead = ROLE_DEFINITIONS[roleKey].permissions.includes('users.read');
      const hasWrite = ROLE_DEFINITIONS[roleKey].permissions.includes('users.suspend');
      expect(
        (await api().get('/api/v1/admin/users').set(actor.auth)).status,
        `${roleKey} read`,
      ).toBe(hasRead ? 200 : 403);
      const target = await createUser(h.app);
      expect(
        (
          await api()
            .patch(`/api/v1/admin/users/${target.id}/status`)
            .set(actor.auth)
            .send({ status: 'suspended', reason: 'isolated RBAC matrix' })
        ).status,
        `${roleKey} write`,
      ).toBe(hasWrite ? 200 : 403);
    }
  });
});

describe('MFA protection for administrators', () => {
  it('withholds admin permissions until the session is MFA-verified', async () => {
    const admin = await createStaff(h.app, ['admin'], { enrollMfa: false });
    const res = await api().get('/api/v1/users').set(admin.auth);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('MFA_REQUIRED');
    const me = await api().get('/api/v1/auth/me').set(admin.auth);
    expect(me.body.mfaRequired).toBe(true);
    expect(me.body.permissions).toEqual([]);
  });

  it('enrolling TOTP unlocks the permissions; later logins need a fresh code', async () => {
    const admin = await createStaff(h.app, ['admin']);
    expect((await api().get('/api/v1/users').set(admin.auth)).status).toBe(200);

    const login = await api()
      .post('/api/v1/auth/login')
      .send({ identifier: admin.email, password: PASSWORD });
    expect(login.body.status).toBe('mfa_required');
    // The code used at enrolment (this step) is a replay and must be refused…
    const replay = await api()
      .post('/api/v1/auth/mfa/verify')
      .send({ mfaToken: login.body.mfaToken, code: totpAt(admin.totpSecret, currentStep()) });
    expect(replay.status).toBe(401);
    // …while the next time-step is accepted (within the ±1 window).
    const next = await api()
      .post('/api/v1/auth/mfa/verify')
      .send({ mfaToken: login.body.mfaToken, code: totpAt(admin.totpSecret, currentStep() + 1) });
    expect(next.status).toBe(200);
    const token = next.body.tokens.accessToken;
    expect((await api().get('/api/v1/users').set('Authorization', `Bearer ${token}`)).status).toBe(
      200,
    );
  });

  it('an administrator cannot switch MFA off', async () => {
    const admin = await createStaff(h.app, ['support']);
    const res = await api()
      .post('/api/v1/auth/mfa/disable')
      .set(admin.auth)
      .send({ password: PASSWORD, code: admin.recoveryCodes[0] });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('MFA_REQUIRED_BY_ROLE');
  });

  it('an MFA token is not an access token', async () => {
    const admin = await createStaff(h.app, ['admin']);
    const login = await api()
      .post('/api/v1/auth/login')
      .send({ identifier: admin.email, password: PASSWORD });
    expect(
      (await api().get('/api/v1/auth/me').set('Authorization', `Bearer ${login.body.mfaToken}`))
        .status,
    ).toBe(401);
  });
});

describe('privilege escalation is prevented', () => {
  it('ordinary users cannot grant themselves (or anyone) elevated roles', async () => {
    const buyer = await createUser(h.app);
    const other = await createUser(h.app);
    for (const roleKey of ['super_admin', 'admin', 'finance_admin', 'seller']) {
      const self = await api()
        .post(`/api/v1/users/${buyer.id}/roles`)
        .set(buyer.auth)
        .send({ roleKey });
      expect(self.status).toBe(403);
      const peer = await api()
        .post(`/api/v1/users/${other.id}/roles`)
        .set(buyer.auth)
        .send({ roleKey });
      expect(peer.status).toBe(403);
    }
    const me = await api().get('/api/v1/auth/me').set(buyer.auth);
    expect(me.body.user.roles).toEqual(['buyer']);
    expect(me.body.permissions).toEqual([]);
  });

  it('profile updates cannot carry roles, status or other privileged fields', async () => {
    const buyer = await createUser(h.app);
    for (const body of [
      { roles: ['admin'] },
      { status: 'active' },
      { passwordHash: 'x' },
      { email: 'a@b.test' },
    ]) {
      const res = await api()
        .patch('/api/v1/users/me')
        .set(buyer.auth)
        .send({ displayName: 'ok', ...body });
      expect(res.status).toBe(400);
    }
  });

  it('even an admin cannot change their own roles', async () => {
    const admin = await createStaff(h.app, ['admin']);
    const res = await api()
      .post(`/api/v1/users/${admin.id}/roles`)
      .set(admin.auth)
      .send({ roleKey: 'super_admin' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('SELF_ROLE_CHANGE');
  });

  it('an admin cannot mint admins or roles whose permissions they lack', async () => {
    const admin = await createStaff(h.app, ['admin']);
    const target = await createUser(h.app);
    for (const roleKey of ['super_admin', 'admin', 'finance_admin']) {
      const res = await api()
        .post(`/api/v1/users/${target.id}/roles`)
        .set(admin.auth)
        .send({ roleKey });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('PRIVILEGE_ESCALATION');
    }
    expect(
      (await api().get(`/api/v1/users/${target.id}/roles`).set(admin.auth)).body.roles,
    ).toEqual(['buyer']);
  });

  it('a finance administrator cannot grant super_admin through the direct role API', async () => {
    const finance = await createStaff(h.app, ['finance_admin']);
    const target = await createUser(h.app);
    const res = await api()
      .post(`/api/v1/users/${target.id}/roles`)
      .set(finance.auth)
      .send({ roleKey: 'super_admin' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    const { UserRole } = await import('../src/models');
    const roles = await UserRole.find({ userId: target.id }).populate('roleId', 'key');
    expect(roles.map((row) => (row.roleId as unknown as { key: string }).key)).toEqual(['buyer']);
  });

  it('an admin may delegate roles within their own permissions; it is audited and takes effect at once', async () => {
    const admin = await createStaff(h.app, ['admin']);
    const target = await createStaff(h.app, [], { enrollMfa: false });
    const granted = await api()
      .post(`/api/v1/users/${target.id}/roles`)
      .set(admin.auth)
      .send({ roleKey: 'moderator' });
    expect(granted.status).toBe(201);
    expect(granted.body.roles).toContain('moderator');
    expect(
      await AuditLog.countDocuments({
        action: 'user.role_assigned',
        targetId: target.id,
        actorId: admin.id,
      }),
    ).toBe(1);

    // moderator is MFA-protected: until the target enrols MFA the permission is withheld, not granted.
    expect((await api().get('/api/v1/users').set(target.auth)).body.error.code).toBe(
      'MFA_REQUIRED',
    );

    const revoked = await api()
      .delete(`/api/v1/users/${target.id}/roles/moderator`)
      .set(admin.auth);
    expect(revoked.status).toBe(200);
    expect(revoked.body.roles).not.toContain('moderator');
    expect(
      await AuditLog.countDocuments({ action: 'user.role_revoked', targetId: target.id }),
    ).toBe(1);
  });

  it('only a super admin can grant admin, and role grants are audited', async () => {
    const root = await createStaff(h.app, ['super_admin']);
    const target = await createUser(h.app);
    const res = await api()
      .post(`/api/v1/users/${target.id}/roles`)
      .set(root.auth)
      .send({ roleKey: 'admin' });
    expect(res.status).toBe(201);
    const log = await AuditLog.findOne({ action: 'user.role_assigned', targetId: target.id });
    expect(log?.metadata).toEqual({ role: 'admin' });
    expect(String(log?.actorId)).toBe(root.id);
  });

  it('unknown roles are 404 and duplicate grants are 409', async () => {
    const root = await createStaff(h.app, ['super_admin']);
    const target = await createUser(h.app);
    expect(
      (
        await api()
          .post(`/api/v1/users/${target.id}/roles`)
          .set(root.auth)
          .send({ roleKey: 'nope' })
      ).status,
    ).toBe(404);
    await api()
      .post(`/api/v1/users/${target.id}/roles`)
      .set(root.auth)
      .send({ roleKey: 'seller' })
      .expect(201);
    expect(
      (
        await api()
          .post(`/api/v1/users/${target.id}/roles`)
          .set(root.auth)
          .send({ roleKey: 'seller' })
      ).status,
    ).toBe(409);
  });

  it('concurrent super-admin revocations must not remove the final super_admin', async () => {
    const a = await createStaff(h.app, ['super_admin']);
    const b = await createStaff(h.app, ['super_admin']);
    const [ra, rb] = await Promise.all([
      api().delete(`/api/v1/users/${b.id}/roles/super_admin`).set(a.auth),
      api().delete(`/api/v1/users/${a.id}/roles/super_admin`).set(b.auth),
    ]);
    const remaining = await Role.findOne({ key: 'super_admin' });
    const { UserRole } = await import('../src/models');
    expect(await UserRole.countDocuments({ roleId: remaining!._id })).toBeGreaterThanOrEqual(1);
    expect([200, 409]).toContain(ra.status);
    expect([200, 409]).toContain(rb.status);
  });
});

describe('role → permission management', () => {
  it('lists every seeded permission and role', async () => {
    const root = await createStaff(h.app, ['super_admin']);
    const perms = await api().get('/api/v1/permissions').set(root.auth);
    expect(perms.body.permissions.map((p: { key: string }) => p.key).sort()).toEqual(
      [...PERMISSION_KEYS].sort(),
    );
    const roles = await api().get('/api/v1/roles').set(root.auth);
    const superAdmin = roles.body.roles.find((r: { key: string }) => r.key === 'super_admin');
    expect(superAdmin.permissions).toHaveLength(PERMISSION_KEYS.length);
    expect(superAdmin.requiresMfa).toBe(true);
  });

  it('requires permissions.manage; an admin cannot rewrite roles', async () => {
    const admin = await createStaff(h.app, ['admin']);
    const res = await api()
      .put('/api/v1/roles/seller/permissions')
      .set(admin.auth)
      .send({ permissions: ['users.read'] });
    expect(res.status).toBe(403);
  });

  it('super admin edits are validated, audited with a diff, and super_admin stays immutable', async () => {
    const root = await createStaff(h.app, ['super_admin']);
    const res = await api()
      .put('/api/v1/roles/support/permissions')
      .set(root.auth)
      .send({ permissions: ['users.read', 'reports.read'] });
    expect(res.status).toBe(200);
    expect(res.body.role.permissions).toEqual(['reports.read', 'users.read']);
    const log = await AuditLog.findOne({ action: 'role.permissions_changed', targetId: 'support' });
    expect(log?.metadata).toEqual({ added: ['reports.read'], removed: ['farms.read'] });

    expect(
      (
        await api()
          .put('/api/v1/roles/support/permissions')
          .set(root.auth)
          .send({ permissions: ['not.real'] })
      ).status,
    ).toBe(400);
    const immutable = await api()
      .put('/api/v1/roles/super_admin/permissions')
      .set(root.auth)
      .send({ permissions: [] });
    expect(immutable.status).toBe(403);
    expect(immutable.body.error.code).toBe('ROLE_IMMUTABLE');
    expect(await Role.findOne({ key: 'super_admin' })).toBeTruthy();
  });

  it('concurrent permission replacements leave one complete permission set, never a mixed set', async () => {
    const root = await createStaff(h.app, ['super_admin']);
    const a = ['users.read', 'reports.read'];
    const b = ['farms.read', 'payments.read'];
    try {
      const [ra, rb] = await Promise.all([
        api().put('/api/v1/roles/support/permissions').set(root.auth).send({ permissions: a }),
        api().put('/api/v1/roles/support/permissions').set(root.auth).send({ permissions: b }),
      ]);
      expect([ra.status, rb.status]).toEqual([200, 200]);
      const roles = await api().get('/api/v1/roles').set(root.auth);
      const support = roles.body.roles.find((role: { key: string }) => role.key === 'support');
      expect([a, b]).toContainEqual(support.permissions);
    } finally {
      await api()
        .put('/api/v1/roles/support/permissions')
        .set(root.auth)
        .send({ permissions: ['users.read', 'farms.read'] });
    }
  });

  it('a permission cannot be delegated by someone who lacks it', async () => {
    const root = await createStaff(h.app, ['super_admin']);
    const delegate = await createStaff(h.app, ['moderator']);
    // Hand permissions.manage to the moderator role, then try to use it to grant payments.refund.
    await api()
      .put('/api/v1/roles/moderator/permissions')
      .set(root.auth)
      .send({ permissions: ['users.read', 'permissions.manage'] });
    // moderator sessions re-resolve permissions per request, so this applies immediately.
    const res = await api()
      .put('/api/v1/roles/support/permissions')
      .set(delegate.auth)
      .send({ permissions: ['payments.refund'] });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('PRIVILEGE_ESCALATION');
  });
});

describe('account status management', () => {
  it('suspension kills sessions at once, blocks login, and reactivation restores access', async () => {
    const admin = await createStaff(h.app, ['admin']);
    const victim = await createUser(h.app);
    const res = await api()
      .put(`/api/v1/users/${victim.id}/status`)
      .set(admin.auth)
      .send({ status: 'suspended', reason: 'Fraud report #42' });
    expect(res.status).toBe(200);
    expect(res.body.user.status).toBe('suspended');

    expect((await api().get('/api/v1/auth/me').set(victim.auth)).status).toBe(401);
    expect(
      (await api().post('/api/v1/auth/refresh').send({ refreshToken: victim.refreshToken })).status,
    ).toBe(401);
    const login = await api()
      .post('/api/v1/auth/login')
      .send({ identifier: victim.email, password: PASSWORD });
    expect(login.status).toBe(403);
    expect(login.body.error.code).toBe('ACCOUNT_SUSPENDED');

    await api()
      .put(`/api/v1/users/${victim.id}/status`)
      .set(admin.auth)
      .send({ status: 'active', reason: 'Appeal approved' })
      .expect(200);
    expect(
      (
        await api()
          .post('/api/v1/auth/login')
          .send({ identifier: victim.email, password: PASSWORD })
      ).status,
    ).toBe(200);

    const log = await AuditLog.findOne({
      action: 'user.status_changed',
      targetId: victim.id,
      'metadata.to': 'suspended',
    });
    expect(log?.metadata).toEqual({ from: 'active', to: 'suspended', reason: 'Fraud report #42' });
  });

  it('cannot suspend yourself, a superior, or a super admin (unless you are one)', async () => {
    const admin = await createStaff(h.app, ['admin']);
    const root = await createStaff(h.app, ['super_admin']);
    const peerAdmin = await createStaff(h.app, ['admin']);
    const body = { status: 'suspended', reason: 'testing' };
    expect(
      (await api().put(`/api/v1/users/${admin.id}/status`).set(admin.auth).send(body)).status,
    ).toBe(403);
    expect(
      (await api().put(`/api/v1/users/${root.id}/status`).set(admin.auth).send(body)).status,
    ).toBe(403);
    // Admin → admin is blocked: protected roles are super-admin-only.
    expect(
      (await api().put(`/api/v1/users/${peerAdmin.id}/status`).set(admin.auth).send(body)).status,
    ).toBe(403);
    expect(
      (await api().put(`/api/v1/users/${peerAdmin.id}/status`).set(root.auth).send(body)).status,
    ).toBe(200);
    expect((await User.findById(root.id))?.status).toBe('active');
  });

  it('requires a reason and a valid status', async () => {
    const admin = await createStaff(h.app, ['admin']);
    const victim = await createUser(h.app);
    expect(
      (
        await api()
          .put(`/api/v1/users/${victim.id}/status`)
          .set(admin.auth)
          .send({ status: 'suspended' })
      ).status,
    ).toBe(400);
    expect(
      (
        await api()
          .put(`/api/v1/users/${victim.id}/status`)
          .set(admin.auth)
          .send({ status: 'pending_verification', reason: 'nope' })
      ).status,
    ).toBe(400);
  });
});

describe('ownership', () => {
  it('users can read and edit themselves but not each other', async () => {
    const a = await createUser(h.app);
    const b = await createUser(h.app);
    expect((await api().get(`/api/v1/users/${a.id}`).set(a.auth)).status).toBe(200);
    const read = await api().get(`/api/v1/users/${b.id}`).set(a.auth);
    expect(read.status).toBe(403);
    expect(read.body.error.code).toBe('NOT_OWNER');
    expect(
      (await api().patch(`/api/v1/users/${b.id}`).set(a.auth).send({ displayName: 'hacked' }))
        .status,
    ).toBe(403);
    expect((await api().get(`/api/v1/users/${b.id}/roles`).set(a.auth)).status).toBe(403);
    expect((await User.findById(b.id))?.displayName).toBe('Test User');

    const own = await api()
      .patch('/api/v1/users/me')
      .set(a.auth)
      .send({ displayName: 'Somsri', locale: 'th-TH' });
    expect(own.status).toBe(200);
    expect(own.body.user).toMatchObject({ displayName: 'Somsri', locale: 'th-TH' });
  });

  it('holders of the bypass permission may act on others, and it is audited', async () => {
    const support = await createStaff(h.app, ['support']); // users.read only
    const admin = await createStaff(h.app, ['admin']); // users.update
    const target = await createUser(h.app);
    expect((await api().get(`/api/v1/users/${target.id}`).set(support.auth)).status).toBe(200);
    expect(
      (await api().patch(`/api/v1/users/${target.id}`).set(support.auth).send({ displayName: 'x' }))
        .status,
    ).toBe(403);
    expect(
      (
        await api()
          .patch(`/api/v1/users/${target.id}`)
          .set(admin.auth)
          .send({ displayName: 'Edited by admin' })
      ).status,
    ).toBe(200);
    expect(
      await AuditLog.countDocuments({
        action: 'user.profile_updated_by_admin',
        targetId: target.id,
      }),
    ).toBe(1);
  });

  it('malformed and unknown ids are 404, and responses never expose secrets', async () => {
    const admin = await createStaff(h.app, ['admin']);
    expect((await api().get('/api/v1/users/not-an-id').set(admin.auth)).status).toBe(404);
    expect((await api().get('/api/v1/users/0123456789abcdef01234567').set(admin.auth)).status).toBe(
      404,
    );
    const list = await api().get('/api/v1/users?pageSize=5&q=staff').set(admin.auth);
    expect(list.status).toBe(200);
    expect(JSON.stringify(list.body)).not.toMatch(/passwordHash|secretEnc|recoveryCode|scrypt/);
  });

  // Farms and animals arrive in a later Part; this proves the reusable guard they will use.
  describe('requireOwnerOrPermission guard (farm-like resource)', () => {
    const farms = new Map([['farm-1', { id: 'farm-1', ownerId: '' }]]);
    const farmApp = (): express.Express => {
      const app = express();
      const guard = requireOwnerOrPermission({
        load: async (req) => farms.get(String(req.params['id'])) ?? null,
        bypassPermission: 'farms.manage',
      });
      app.get('/farms/:id', authenticate(h.ctx), guard, (_req, res) => res.json({ ok: true }));
      app.get('/perm/:id', authenticate(h.ctx), requirePermission('farms.manage'), (_req, res) =>
        res.json({ ok: true }),
      );
      app.use(errorHandler(h.env));
      return app;
    };

    it('allows the owner, blocks other users, and lets farms.manage through', async () => {
      const owner = await createStaff(h.app, ['farm_owner'], { enrollMfa: false });
      farms.get('farm-1')!.ownerId = owner.id;
      const stranger = await createUser(h.app);
      const manager = await createStaff(h.app, ['admin']);
      const app = farmApp();

      expect((await request(app).get('/farms/farm-1')).status).toBe(401);
      expect((await request(app).get('/farms/farm-1').set(owner.auth)).status).toBe(200);
      const denied = await request(app).get('/farms/farm-1').set(stranger.auth);
      expect(denied.status).toBe(403);
      expect(denied.body.error.code).toBe('NOT_OWNER');
      expect((await request(app).get('/farms/farm-1').set(manager.auth)).status).toBe(200);
      expect((await request(app).get('/farms/missing').set(owner.auth)).status).toBe(404);
      expect((await request(app).get('/perm/x').set(stranger.auth)).status).toBe(403);
    });

    it('does not let an un-MFA’d admin bypass ownership', async () => {
      const owner = await createUser(h.app);
      farms.get('farm-1')!.ownerId = owner.id;
      const weakAdmin = await createStaff(h.app, ['admin'], { enrollMfa: false });
      const res = await request(farmApp()).get('/farms/farm-1').set(weakAdmin.auth);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('MFA_REQUIRED');
    });
  });
});

describe('audit logs', () => {
  it('are readable only with audit_logs.read and never contain secrets', async () => {
    const admin = await createStaff(h.app, ['admin']);
    const buyer = await createUser(h.app);
    expect((await api().get('/api/v1/audit-logs').set(buyer.auth)).status).toBe(403);
    const res = await api().get('/api/v1/audit-logs?action=auth.login').set(admin.auth);
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeGreaterThan(0);
    expect(res.body.items.every((i: { action: string }) => i.action === 'auth.login')).toBe(true);
    const everything = JSON.stringify(await AuditLog.find().lean());
    expect(everything).not.toContain(PASSWORD);
    expect(everything).not.toMatch(/refreshToken|accessToken|passwordHash/);
  });
});
