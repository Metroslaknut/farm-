import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

const request = vi.hoisted(() => vi.fn());
vi.mock('../src/api', () => ({ api: { request } }));

import { AdminHeader } from '../src/components/admin/AdminHeader';
import { AdminSidebar } from '../src/components/admin/AdminSidebar';
import { ConfirmActionDialog } from '../src/components/admin/ConfirmActionDialog';
import { StatusBadge } from '../src/components/admin/StatusBadge';
import { AdminHome } from '../src/pages/admin/RouteGuards';
import UsersPage from '../src/pages/admin/users';
import { getLocale, setLocale } from '../src/i18n';
import { renderAs } from './helpers';

describe('admin in Thai', () => {
  it('renders the navigation in Thai and switches to English without a reload', () => {
    setLocale('th');
    renderAs(<AdminSidebar />, { permissions: ['users.read', 'audit_logs.read', 'payments.read'] });
    expect(screen.getByRole('link', { name: 'ผู้ใช้' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'บันทึกการตรวจสอบ' })).toBeTruthy();
    expect(screen.getByText('การเงิน')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Users' })).toBeNull();

    act(() => setLocale('en'));
    expect(screen.getByRole('link', { name: 'Users' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Audit logs' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'ผู้ใช้' })).toBeNull();
  });

  it('the header has a TH/EN switch that changes the admin language', async () => {
    setLocale('th');
    renderAs(<AdminHeader menuOpen={false} onToggleMenu={() => undefined} />);
    expect(screen.getByRole('button', { name: 'ออกจากระบบ' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'ความปลอดภัย' })).toBeTruthy();

    await userEvent.click(screen.getByRole('radio', { name: 'English' }));
    expect(getLocale()).toBe('en');
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Security' })).toBeTruthy();
  });

  it('translates statuses from the API through the key map', () => {
    setLocale('th');
    render(
      <>
        <StatusBadge status="PENDING_REVIEW" />
        <StatusBadge status="pending_verification" />
      </>,
    );
    expect(screen.getByText('รอตรวจสอบ')).toBeTruthy();
    expect(screen.getByText('รอยืนยันตัวตน')).toBeTruthy();
    act(() => setLocale('en'));
    expect(screen.getByText('pending review')).toBeTruthy();
    expect(screen.getByText('pending verification')).toBeTruthy();
  });

  it('confirm dialogs and guard messages are Thai', () => {
    setLocale('th');
    render(
      <ConfirmActionDialog
        open
        title="t"
        confirmLabel="ok"
        requireReason
        confirmText="RF-1"
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByLabelText('เหตุผล (บันทึกไว้ในบันทึกการตรวจสอบ)')).toBeTruthy();
    expect(screen.getByLabelText('พิมพ์ RF-1 เพื่อยืนยัน')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'ยกเลิก' })).toBeTruthy();
  });

  it('renders the users page (filters, table, statuses, roles) in Thai, then in English', async () => {
    request.mockResolvedValue({
      items: [
        {
          id: 'u2',
          displayName: 'สมชาย ใจดี',
          email: 'somchai@example.com',
          status: 'suspended',
          identityVerification: 'verified',
          sellerVerification: 'none',
          roles: ['seller'],
          createdAt: '2026-01-02T03:00:00.000Z',
        },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
    });
    setLocale('th');
    renderAs(<UsersPage />, { permissions: ['users.read'], route: '/admin/users' });
    expect(await screen.findByText('สมชาย ใจดี')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'ผู้ใช้' })).toBeTruthy();
    expect(screen.getByText('สถานะบัญชี')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'ค้นหา' })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'เข้าร่วมเมื่อ' })).toBeTruthy();
    expect(screen.getAllByText('ถูกระงับ').length).toBeGreaterThan(0);
    expect(screen.getAllByText('ผู้ขาย').length).toBeGreaterThan(0);
    expect(screen.getByText('1–1 จาก 1')).toBeTruthy();

    act(() => setLocale('en'));
    expect(screen.getByRole('heading', { name: 'Users' })).toBeTruthy();
    expect(screen.getByText('Account status')).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Joined' })).toBeTruthy();
    expect(screen.getAllByText('suspended').length).toBeGreaterThan(0);
    expect(screen.getByText('1–1 of 1')).toBeTruthy();
  });

  it('explains pending MFA in Thai', () => {
    setLocale('th');
    renderAs(<AdminHome />, { permissions: [], mfaRequired: true });
    expect(screen.getByText(/ยินดีต้อนรับ Tester/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'ตั้งค่าหรือยืนยัน MFA' })).toBeTruthy();
  });
});
