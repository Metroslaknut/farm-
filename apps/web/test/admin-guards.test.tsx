import { screen } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { AdminSidebar } from '../src/components/admin/AdminSidebar';
import { PermissionGuard } from '../src/components/admin/PermissionGuard';
import { ALL_NAV_ITEMS, visibleNav } from '../src/components/admin/nav';
import { AdminHome, Protected, RequireAdminAuth } from '../src/pages/admin/RouteGuards';
import { renderAs } from './helpers';

describe('PermissionGuard', () => {
  it('renders children only when the permission is held', () => {
    renderAs(<PermissionGuard permission="users.read">secret</PermissionGuard>, {
      permissions: ['users.read'],
    });
    expect(screen.getByText('secret')).toBeTruthy();
  });

  it('renders the fallback (not the children) otherwise', () => {
    renderAs(
      <PermissionGuard permission="users.suspend" fallback="denied">
        secret
      </PermissionGuard>,
      { permissions: ['users.read'] },
    );
    expect(screen.queryByText('secret')).toBeNull();
    expect(screen.getByText('denied')).toBeTruthy();
  });

  it('supports all-of (array) and any-of', () => {
    renderAs(
      <>
        <PermissionGuard permission={['a', 'b']}>
          <span>all-yes</span>
        </PermissionGuard>
        <PermissionGuard permission={['a', 'z']}>
          <span>all-no</span>
        </PermissionGuard>
        <PermissionGuard anyOf={['z', 'b']}>
          <span>any-yes</span>
        </PermissionGuard>
      </>,
      { permissions: ['a', 'b'] },
    );
    expect(screen.queryByText('all-yes')).toBeTruthy();
    expect(screen.queryByText('all-no')).toBeNull();
    expect(screen.queryByText('any-yes')).toBeTruthy();
  });
});

describe('role-aware navigation', () => {
  it('shows only the sections the user can open', () => {
    renderAs(<AdminSidebar />, { permissions: ['users.read', 'audit_logs.read'] });
    expect(screen.getByRole('link', { name: 'Users' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Audit logs' })).toBeTruthy();
    for (const hidden of ['Payments', 'Settings', 'Roles', 'Registrations', 'Dashboard']) {
      expect(screen.queryByRole('link', { name: hidden })).toBeNull();
    }
  });

  it('shows content moderation only to holders of content.moderate', () => {
    const { unmount } = renderAs(<AdminSidebar />, { permissions: ['users.read'] });
    expect(screen.queryByRole('link', { name: 'Content moderation' })).toBeNull();
    unmount();
    renderAs(<AdminSidebar />, { permissions: ['content.moderate'] });
    expect(screen.getByRole('link', { name: 'Content moderation' })).toBeTruthy();
  });

  it('shows nothing (and says so) for a user without admin permissions', () => {
    renderAs(<AdminSidebar />, { permissions: [] });
    expect(screen.queryAllByRole('link')).toHaveLength(0);
    expect(screen.getByText(/No sections available/)).toBeTruthy();
  });

  it('a super-admin-like user sees every section; every nav item names a real permission', () => {
    const everything = visibleNav(() => true).flatMap((g) => g.items);
    expect(everything).toHaveLength(ALL_NAV_ITEMS.length);
    expect(ALL_NAV_ITEMS.every((i) => i.anyOf.length > 0)).toBe(true);
  });

  it('covers all of the required admin sections', () => {
    expect(ALL_NAV_ITEMS.map((i) => i.path).sort()).toEqual(
      [
        'ai',
        'analytics',
        'animal-types',
        'growth-standards',
        'audit-logs',
        'commissions',
        'dashboard',
        'farms',
        'listings',
        'message-reports',
        'moderation',
        'orders',
        'payments',
        'permissions',
        'products',
        'refunds',
        'registrations',
        'reports',
        'roles',
        'settings',
        'users',
        'wallet-transactions',
        'withdrawals',
      ].sort(),
    );
  });
});

describe('route protection', () => {
  const tree = (
    <Routes>
      <Route path="/admin/login" element={<p>login page</p>} />
      <Route element={<RequireAdminAuth />}>
        <Route path="/admin" element={<AdminHome />} />
        <Route
          path="/admin/users"
          element={<Protected anyOf={['users.read']}>users page</Protected>}
        />
      </Route>
    </Routes>
  );

  it('redirects anonymous visitors to the login page', () => {
    renderAs(tree, { status: 'anonymous', route: '/admin/users' });
    expect(screen.getByText('login page')).toBeTruthy();
    expect(screen.queryByText('users page')).toBeNull();
  });

  it('waits for the session check instead of flashing protected content', () => {
    renderAs(tree, { status: 'loading', route: '/admin/users' });
    expect(screen.getByText(/Checking your session/)).toBeTruthy();
    expect(screen.queryByText('users page')).toBeNull();
  });

  it('shows 403 to a signed-in user lacking the permission', () => {
    renderAs(tree, { permissions: ['reports.read'], route: '/admin/users' });
    expect(screen.getByText(/403/)).toBeTruthy();
    expect(screen.queryByText('users page')).toBeNull();
  });

  it('lets a permitted user in', () => {
    renderAs(tree, { permissions: ['users.read'], route: '/admin/users' });
    expect(screen.getByText('users page')).toBeTruthy();
  });

  it('explains pending MFA when admin permissions are withheld', () => {
    renderAs(tree, { permissions: [], mfaRequired: true, route: '/admin' });
    expect(screen.getByText(/on hold until you finish two-factor/)).toBeTruthy();
  });
});
