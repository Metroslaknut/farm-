import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminFarmDetail, AdminFarmRow, Page } from '@farmplus/shared-types';

const request = vi.hoisted(() => vi.fn());
vi.mock('../src/api', () => ({ api: { request } }));

import FarmsPage from '../src/pages/admin/farms';
import FarmDetail from '../src/pages/admin/farms/FarmDetail';
import { setLocale } from '../src/i18n';
import { renderAs } from './helpers';

const row: AdminFarmRow = {
  id: 'f1',
  name: 'Green Valley',
  status: 'archived',
  province: 'เชียงใหม่',
  owner: { id: 'u9', displayName: 'Somchai' },
  memberCount: 3,
  animalCount: 12,
  createdAt: '2026-05-01T03:00:00.000Z',
  archivedAt: '2026-06-01T03:00:00.000Z',
};
const page = (items: AdminFarmRow[]): Page<AdminFarmRow> => ({
  items,
  total: items.length,
  page: 1,
  pageSize: 20,
});

const detail: AdminFarmDetail = {
  farm: {
    id: 'f1',
    name: 'Green Valley',
    description: 'Buffalo and goats',
    status: 'active',
    location: { province: 'เชียงใหม่', district: 'แม่ริม' },
    contact: { phone: '0812345678' },
    animalTypeIds: ['t1'],
    myRole: null,
    createdAt: '2026-05-01T03:00:00.000Z',
    owner: { id: 'u9', displayName: 'Somchai' },
    access: { via: 'platform', permissions: ['farm.read'] },
    stats: { animalsTotal: 5, animalsActive: 4, byStatus: { active: 4, sold: 1 } },
  },
  owner: { id: 'u9', displayName: 'Somchai', email: 'somchai@example.test' },
  members: [
    {
      id: 'm1',
      userId: 'u9',
      displayName: 'Somchai',
      role: 'owner',
      joinedAt: '2026-05-01T03:00:00.000Z',
      permissions: [],
      customPermissions: false,
    },
    {
      id: 'm2',
      userId: 'u10',
      displayName: 'Malee',
      role: 'worker',
      joinedAt: '2026-05-02T03:00:00.000Z',
      permissions: [],
      customPermissions: false,
    },
  ],
  animalsByType: [
    {
      animalTypeId: 't1',
      key: 'buffalo',
      name: 'Buffalo',
      nameTh: 'กระบือ',
      total: 5,
      onFarm: 4,
      forSale: 0,
      sold: 1,
      needsGrowthCheck: 0,
      outsideStandard: 0,
    },
  ],
  lastActivityAt: '2026-06-10T03:00:00.000Z',
  recentAudit: [
    {
      id: 'a1',
      actorId: 'u9',
      actor: { displayName: 'Somchai' },
      action: 'farm.archived',
      targetType: 'farm',
      targetId: 'f1',
      createdAt: '2026-06-01T03:00:00.000Z',
    },
  ],
};

beforeEach(() => {
  request.mockReset();
});

describe('admin farms list', () => {
  it('shows the farms with owner, province, counts and status, and sends the filters to the API', async () => {
    request.mockResolvedValue(page([row]));
    renderAs(<FarmsPage />, { permissions: ['farms.read'], route: '/admin/farms' });
    expect(await screen.findByRole('link', { name: 'Green Valley' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Green Valley' }).getAttribute('href')).toBe(
      '/admin/farms/f1',
    );
    expect(screen.getByText('Somchai')).toBeTruthy();
    expect(screen.getByText('เชียงใหม่')).toBeTruthy();
    expect(screen.getByText('12')).toBeTruthy();
    expect(screen.getAllByText('archived').length).toBeGreaterThan(0);
    expect(request).toHaveBeenLastCalledWith(
      'GET',
      '/admin/farms',
      expect.objectContaining({
        query: expect.objectContaining({ sortBy: 'createdAt', order: 'desc', pageSize: 20 }),
      }),
    );

    await userEvent.type(screen.getByLabelText('Owner'), 'somchai@example.test');
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(request).toHaveBeenLastCalledWith(
      'GET',
      '/admin/farms',
      expect.objectContaining({
        query: expect.objectContaining({ owner: 'somchai@example.test', page: '1' }),
      }),
    );
  });

  it('has an empty state and no action buttons', async () => {
    request.mockResolvedValue(page([]));
    renderAs(<FarmsPage />, { permissions: ['farms.read'], route: '/admin/farms' });
    expect(await screen.findByText('No farms match your filters.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /archive|restore|delete/i })).toBeNull();
  });

  it('shows the API error with a retry', async () => {
    request.mockRejectedValue(new Error('Server unavailable'));
    renderAs(<FarmsPage />, { permissions: ['farms.read'], route: '/admin/farms' });
    expect(await screen.findByText(/Server unavailable/)).toBeTruthy();
  });

  it('is in Thai when the admin language is Thai', async () => {
    request.mockResolvedValue(page([row]));
    setLocale('th');
    renderAs(<FarmsPage />, { permissions: ['farms.read'], route: '/admin/farms' });
    expect(await screen.findByRole('link', { name: 'Green Valley' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'ฟาร์ม' })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'จังหวัด' })).toBeTruthy();
    expect(screen.getAllByText('เก็บถาวร').length).toBeGreaterThan(0);
  });
});

const renderDetail = (permissions: string[]) =>
  renderAs(
    <Routes>
      <Route path="/admin/farms/:id" element={<FarmDetail />} />
    </Routes>,
    { permissions, route: '/admin/farms/f1' },
  );

describe('admin farm detail', () => {
  it('shows profile, owner, members, animal counts and history, read-only', async () => {
    request.mockResolvedValue(detail);
    renderDetail(['farms.read', 'users.read', 'audit_logs.read']);
    expect(await screen.findByRole('heading', { name: 'Green Valley' })).toBeTruthy();
    expect(request).toHaveBeenCalledWith('GET', '/admin/farms/f1', expect.anything());
    expect(screen.getByText('Buffalo and goats')).toBeTruthy();
    expect(screen.getByText('แม่ริม, เชียงใหม่')).toBeTruthy();
    expect(screen.getByText('(somchai@example.test)')).toBeTruthy();
    expect(screen.getAllByRole('link', { name: 'Somchai' })[0]!.getAttribute('href')).toBe(
      '/admin/users/u9',
    );
    expect(screen.getByText('worker')).toBeTruthy();
    expect(screen.getByText('Buffalo')).toBeTruthy();
    expect(screen.getByText('farm.archived')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /archive|restore|delete|edit/i })).toBeNull();
  });

  it('shows names without links to users for staff who cannot read users', async () => {
    request.mockResolvedValue({ ...detail, owner: { id: 'u9', displayName: 'Somchai' } });
    renderDetail(['farms.read']);
    expect(await screen.findByRole('heading', { name: 'Green Valley' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Somchai' })).toBeNull();
  });

  it('uses Thai labels and the Thai animal type name', async () => {
    request.mockResolvedValue(detail);
    setLocale('th');
    renderDetail(['farms.read']);
    expect(await screen.findByRole('heading', { name: 'Green Valley' })).toBeTruthy();
    expect(screen.getByText('กระบือ')).toBeTruthy();
    expect(screen.getByText('คนงาน')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'เจ้าของและสมาชิก' })).toBeTruthy();
    act(() => setLocale('en'));
    expect(screen.getByRole('heading', { name: 'Owner and members' })).toBeTruthy();
  });

  it('shows an error for an unknown farm', async () => {
    request.mockRejectedValue(new Error('Farm not found'));
    renderDetail(['farms.read']);
    expect(await screen.findByText(/Farm not found/)).toBeTruthy();
  });
});
