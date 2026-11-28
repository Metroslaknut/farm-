import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminOrderDetail, AdminOrderSummary, Page } from '@farmplus/shared-types';

const request = vi.hoisted(() => vi.fn());
vi.mock('../src/api', () => ({ api: { request } }));

import OrdersPage from '../src/pages/admin/orders';
import OrderDetail from '../src/pages/admin/orders/OrderDetail';
import { setLocale } from '../src/i18n';
import { renderAs } from './helpers';

const summary: AdminOrderSummary = {
  id: 'o1',
  orderNo: 'FP-261128-1A2B3C4D',
  kind: 'animal',
  status: 'PAID',
  currency: 'THB',
  buyer: { id: 'b1', displayName: 'สมชาย ใจดี' },
  farm: { id: 'f1', name: 'ฟาร์มสุขใจ' },
  grandTotalMinor: 4_250_000,
  paymentStatus: 'succeeded',
  paidAt: '2026-11-28T03:00:00.000Z',
  createdAt: '2026-11-28T02:00:00.000Z',
};

const detail: AdminOrderDetail = {
  ...summary,
  status: 'PENDING_PAYMENT',
  paymentStatus: null,
  paidAt: null,
  seller: { id: 's1', displayName: 'Seller One' },
  items: [
    {
      type: 'animal',
      listingId: 'l1',
      animalId: 'a1',
      title: 'Swamp buffalo cow',
      animal: {} as never,
      quantity: 1,
      unitPriceMinor: 4_000_000,
      totalMinor: 4_000_000,
    },
  ],
  totals: {
    itemsMinor: 4_000_000,
    shippingMinor: 250_000,
    platformFeeMinor: 200_000,
    grandTotalMinor: 4_250_000,
    sellerPayoutMinor: 3_800_000,
  },
  feeSnapshot: null,
  fulfillment: 'delivery',
  contact: { hasAddress: true, province: 'Bangkok', district: 'Bang Na', phoneLast4: '5678' },
  paymentDueAt: '2026-11-29T02:00:00.000Z',
  deliveredAt: null,
  cancelReason: null,
  history: [{ at: '2026-11-28T02:00:00.000Z', from: null, to: 'PENDING_PAYMENT', by: 'buyer' }],
  shipments: [],
  payments: [],
  refunds: [],
  updatedAt: '2026-11-28T02:00:00.000Z',
};

const page = (items: AdminOrderSummary[]): Page<AdminOrderSummary> => ({
  items,
  page: 1,
  pageSize: 20,
  total: items.length,
});

beforeEach(() => {
  request.mockReset();
});

describe('admin orders list', () => {
  it('shows the orders in Thai with money and statuses, and filters through the API', async () => {
    request.mockResolvedValue(page([summary]));
    setLocale('th');
    renderAs(<OrdersPage />, { permissions: ['payments.read'], route: '/admin/orders' });
    expect(await screen.findByRole('link', { name: summary.orderNo })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'คำสั่งซื้อ' })).toBeTruthy();
    expect(screen.getByText('สมชาย ใจดี')).toBeTruthy();
    expect(screen.getByText('ฟาร์มสุขใจ')).toBeTruthy();
    expect(screen.getByText('฿42,500.00')).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'สถานะคำสั่งซื้อ' })).toBeTruthy();
    expect(screen.getAllByText('จ่ายแล้ว').length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: summary.orderNo }).getAttribute('href')).toBe(
      '/admin/orders/o1',
    );
    expect(request).toHaveBeenLastCalledWith(
      'GET',
      '/admin/orders',
      expect.objectContaining({ query: expect.objectContaining({ page: '1', pageSize: 20 }) }),
    );

    await userEvent.type(screen.getByLabelText('เลขที่คำสั่งซื้อ'), summary.orderNo);
    await userEvent.click(screen.getByRole('button', { name: 'ค้นหา' }));
    expect(request).toHaveBeenLastCalledWith(
      'GET',
      '/admin/orders',
      expect.objectContaining({ query: expect.objectContaining({ orderNo: summary.orderNo }) }),
    );

    act(() => setLocale('en'));
    expect(screen.getByRole('heading', { name: 'Orders' })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Order status' })).toBeTruthy();
  });

  it('shows the empty state', async () => {
    request.mockResolvedValue(page([]));
    setLocale('en');
    renderAs(<OrdersPage />, { permissions: ['payments.read'], route: '/admin/orders' });
    expect(await screen.findByText('No orders match your filters.')).toBeTruthy();
  });
});

describe('admin order detail', () => {
  const renderDetail = () =>
    renderAs(
      <Routes>
        <Route path="/admin/orders/:id" element={<OrderDetail />} />
      </Routes>,
      { permissions: ['payments.read'], route: '/admin/orders/o1' },
    );

  it('masks the contact until "Show contact" is pressed, then shows what the API returned', async () => {
    request.mockImplementation(async (method: string, path: string) => {
      if (method === 'GET' && path === '/admin/orders/o1') return detail;
      if (method === 'POST' && path === '/admin/orders/o1/contact')
        return {
          address: {
            recipientName: 'Somsak Jaidee',
            phone: '+66 81 234 5678',
            line1: '99/9 Moo 3',
            district: 'Bang Na',
            province: 'Bangkok',
          },
        };
      throw new Error(`unexpected ${method} ${path}`);
    });
    setLocale('en');
    renderDetail();
    expect(await screen.findByRole('heading', { name: summary.orderNo })).toBeTruthy();
    expect(screen.getByText('Swamp buffalo cow')).toBeTruthy();
    expect(screen.getByText('฿2,500.00')).toBeTruthy(); // shipping, separate from the items
    const contact = screen.getByRole('region', { name: 'Delivery contact' });
    expect(within(contact).getByText('ending in 5678')).toBeTruthy();
    expect(within(contact).queryByText('Somsak Jaidee')).toBeNull();
    expect(
      within(contact).getByText('Showing the contact is recorded in the audit log.'),
    ).toBeTruthy();

    await userEvent.click(within(contact).getByRole('button', { name: 'Show contact' }));
    expect(await within(contact).findByText('Somsak Jaidee')).toBeTruthy();
    expect(within(contact).getByText('+66 81 234 5678')).toBeTruthy();
    expect(request).toHaveBeenCalledWith('POST', '/admin/orders/o1/contact');
  });

  it('a pickup order says there is no address and offers no reveal; Thai labels', async () => {
    request.mockResolvedValue({
      ...detail,
      fulfillment: 'pickup',
      contact: { hasAddress: false, province: null, district: null, phoneLast4: null },
    });
    setLocale('th');
    renderDetail();
    expect(await screen.findByText('ไม่มีที่อยู่จัดส่ง (รับสินค้าเอง)')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'แสดงข้อมูลติดต่อ' })).toBeNull();
    expect(screen.getByText('ยังไม่มีการชำระเงิน')).toBeTruthy();
    expect(screen.getAllByText('รอชำระเงิน').length).toBeGreaterThan(0);
  });

  it('shows the error state with a retry', async () => {
    request.mockRejectedValue(new Error('Order not found'));
    setLocale('en');
    renderDetail();
    expect(await screen.findByText('Order not found')).toBeTruthy();
  });
});
