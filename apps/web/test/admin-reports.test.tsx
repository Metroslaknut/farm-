import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const request = vi.hoisted(() => vi.fn());
const download = vi.hoisted(() => vi.fn());
vi.mock('../src/api', () => ({ api: { request, download } }));

import ReportsPage from '../src/pages/admin/reports';
import { setLocale } from '../src/i18n';
import { renderAs } from './helpers';

beforeEach(() => {
  request.mockReset();
  download.mockReset();
  Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() });
});

const headings = () => screen.queryAllByRole('heading', { level: 2 }).map((h) => h.textContent);

describe('admin reports catalogue', () => {
  it('lists only the reports the viewer may download, with links to analytics and AI usage', () => {
    renderAs(<ReportsPage />, {
      permissions: ['reports.read', 'users.read'],
      route: '/admin/reports',
    });
    expect(headings()).toEqual(['Sign-ups']);
    expect(screen.getByText(/staff with “View user accounts”/)).toBeTruthy();
    expect(
      screen.getByRole('link', { name: 'Open the analytics dashboard' }).getAttribute('href'),
    ).toBe('/admin/analytics');
    expect(screen.getByRole('link', { name: 'AI usage report' }).getAttribute('href')).toBe(
      '/admin/ai',
    );
    expect(request).not.toHaveBeenCalled(); // no data is fetched to build the catalogue
  });

  it('shows the financial reports to payments staff and an empty state to staff with no export permission', () => {
    const { unmount } = renderAs(<ReportsPage />, { permissions: ['payments.read'] });
    expect(headings()).toEqual(['Orders', 'Payments', 'Commissions', 'Refunds', 'Payouts']);
    unmount();
    renderAs(<ReportsPage />, { permissions: ['reports.read'] });
    expect(headings()).toEqual([]);
    expect(screen.getByRole('status').textContent).toContain('do not have permission');
  });

  it('downloads the chosen report through the analytics export with the chosen date range', async () => {
    download.mockResolvedValue({
      text: 'a,b',
      filename: 'refunds_2026-06-01_2026-06-10.csv',
      contentType: 'text/csv',
      truncated: false,
    });
    renderAs(<ReportsPage />, { permissions: ['payments.read'] });
    const card = screen.getByRole('region', { name: 'Refunds' });
    const [from, to] = Array.from(card.querySelectorAll('input[type="date"]'));
    fireEvent.change(from!, { target: { value: '2026-06-01' } });
    fireEvent.change(to!, { target: { value: '2026-06-10' } });
    expect(card.textContent).toContain('Date range: 1 Jun 2026 – 10 Jun 2026');
    await userEvent.click(screen.getByRole('button', { name: 'Download “Refunds”' }));
    await waitFor(() => expect(download).toHaveBeenCalledTimes(1));
    expect(download.mock.calls[0]![0]).toBe('/admin/analytics/export');
    expect(download.mock.calls[0]![1].query).toEqual({
      section: 'refunds',
      from: '2026-06-01',
      to: '2026-06-10',
    });
    expect(await screen.findByText('refunds_2026-06-01_2026-06-10.csv saved.')).toBeTruthy();
  });

  it('uses the API default range when no dates are chosen and shows a refused download', async () => {
    download.mockRejectedValue(new Error('You do not have permission to export this'));
    renderAs(<ReportsPage />, { permissions: ['users.read'] });
    expect(screen.getByText(/the last 30 days/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Download “Sign-ups”' }));
    await waitFor(() => expect(download).toHaveBeenCalledTimes(1));
    expect(download.mock.calls[0]![1].query).toEqual({ section: 'signups' });
    expect((await screen.findByRole('alert')).textContent).toContain('permission to export');
  });

  it('renders in Thai with Buddhist-era dates', () => {
    setLocale('th');
    renderAs(<ReportsPage />, { permissions: ['payments.read'] });
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('รายงาน');
    expect(screen.getByRole('link', { name: 'เปิดแดชบอร์ดการวิเคราะห์' })).toBeTruthy();
    const card = screen.getByRole('region', { name: 'การจ่ายเงินให้ผู้ขาย' });
    expect(card.textContent).toContain('ดูการชำระเงิน');
    fireEvent.change(card.querySelector('input[type="date"]')!, {
      target: { value: '2026-06-01' },
    });
    expect(card.textContent).toContain('1 มิ.ย. 2569');
    expect(screen.getByRole('button', { name: 'ดาวน์โหลด “การจ่ายเงินให้ผู้ขาย”' })).toBeTruthy();
  });
});
