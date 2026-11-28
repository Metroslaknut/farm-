import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PERMISSION_KEYS } from '@farmplus/shared-types';
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

const ID = '0123456789abcdef01234567';
const reason = { reason: 'because of testing' };

/** Every admin endpoint, with the ONE permission it must require. */
const ENDPOINTS: {
  method: 'get' | 'post' | 'patch';
  path: string;
  permission: string;
  body?: object;
}[] = [
  { method: 'get', path: '/admin/dashboard', permission: 'reports.read' },
  { method: 'get', path: '/admin/users', permission: 'users.read' },
  { method: 'get', path: `/admin/users/${ID}`, permission: 'users.read' },
  {
    method: 'patch',
    path: `/admin/users/${ID}/status`,
    permission: 'users.suspend',
    body: { status: 'suspended', ...reason },
  },
  { method: 'get', path: '/admin/registrations', permission: 'registrations.review' },
  { method: 'get', path: `/admin/registrations/${ID}`, permission: 'registrations.review' },
  {
    method: 'post',
    path: `/admin/registrations/${ID}/review`,
    permission: 'registrations.review',
    body: {},
  },
  {
    method: 'post',
    path: `/admin/registrations/${ID}/approve`,
    permission: 'registrations.approve',
    body: reason,
  },
  {
    method: 'post',
    path: `/admin/registrations/${ID}/reject`,
    permission: 'registrations.approve',
    body: reason,
  },
  {
    method: 'post',
    path: `/admin/registrations/${ID}/suspend`,
    permission: 'registrations.approve',
    body: reason,
  },
  {
    method: 'post',
    path: `/admin/registrations/${ID}/reinstate`,
    permission: 'registrations.approve',
    body: reason,
  },
  { method: 'get', path: '/admin/roles', permission: 'roles.read' },
  { method: 'get', path: `/admin/roles/${ID}`, permission: 'roles.read' },
  {
    method: 'post',
    path: '/admin/roles',
    permission: 'roles.manage',
    body: { key: 'zz_probe', name: 'Probe' },
  },
  { method: 'patch', path: `/admin/roles/${ID}`, permission: 'roles.manage', body: { name: 'x' } },
  { method: 'get', path: '/admin/orders', permission: 'payments.read' },
  { method: 'get', path: `/admin/orders/${ID}`, permission: 'payments.read' },
  { method: 'post', path: `/admin/orders/${ID}/contact`, permission: 'payments.read' },
  { method: 'get', path: '/admin/permissions', permission: 'roles.read' },
  { method: 'get', path: '/admin/audit-logs', permission: 'audit_logs.read' },
  { method: 'get', path: '/admin/settings', permission: 'settings.read' },
  {
    method: 'patch',
    path: '/admin/settings',
    permission: 'settings.manage',
    body: { values: {}, ...reason },
  },
];

const call = (e: (typeof ENDPOINTS)[number], headers?: Record<string, string>) => {
  const req = request(h.app)[e.method](`/api/v1${e.path}`);
  if (headers) req.set(headers);
  return e.body ? req.send(e.body) : req;
};

describe('every admin endpoint is protected server-side', () => {
  it.each(ENDPOINTS.map((e) => [`${e.method.toUpperCase()} ${e.path}`, e] as const))(
    '%s → 401 without a token',
    async (_n, e) => {
      expect((await call(e)).status).toBe(401);
    },
  );

  it('→ 403 for an ordinary authenticated user, on every endpoint', async () => {
    const buyer = await createUser(h.app);
    for (const e of ENDPOINTS)
      expect((await call(e, buyer.auth)).status, `${e.method} ${e.path}`).toBe(403);
  });

  it('→ 403 for an un-MFA’d admin (permissions withheld), with a machine-readable code', async () => {
    const weak = await createStaff(h.app, ['admin'], { enrollMfa: false });
    const res = await call(ENDPOINTS[1]!, weak.auth);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('MFA_REQUIRED');
  });

  it('is bound to its OWN permission: a holder of only that permission passes, a holder of all the others is refused', async () => {
    const others = (p: string) => PERMISSION_KEYS.filter((k) => k !== p);
    for (const permission of [...new Set(ENDPOINTS.map((e) => e.permission))]) {
      const only = await createStaffWithPermissions(h.app, root, [permission]);
      const allButOne = await createStaffWithPermissions(h.app, root, others(permission));
      for (const e of ENDPOINTS.filter((x) => x.permission === permission)) {
        const allowed = await call(e, only.auth);
        expect([401, 403], `${e.method} ${e.path} with only ${permission}`).not.toContain(
          allowed.status,
        );
        const denied = await call(e, allButOne.auth);
        expect(denied.status, `${e.method} ${e.path} without ${permission}`).toBe(403);
      }
    }
  }, 120_000);

  it('does not expose financial or other not-yet-built modules as admin endpoints (orders: read-only, see admin-orders.test.ts)', async () => {
    for (const path of [
      'payments',
      'refunds',
      'withdrawals',
      'wallet-transactions',
      'commissions',
      'farms',
      'listings',
      'products',
    ]) {
      expect((await request(h.app).get(`/api/v1/admin/${path}`).set(root.auth)).status, path).toBe(
        404,
      );
    }
  });

  it('audit logs are read-only through the API', async () => {
    for (const method of ['post', 'put', 'patch', 'delete'] as const) {
      const res = await request(h.app)[method]('/api/v1/admin/audit-logs').set(root.auth).send({});
      expect(res.status).toBe(404);
    }
  });
});
