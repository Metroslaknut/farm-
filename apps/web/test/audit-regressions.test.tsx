import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { thaiToday } from '@farmplus/validation';

const request = vi.hoisted(() => vi.fn());
vi.mock('../src/api', () => ({ api: { request } }));

import { toDateTimeLocal } from '../src/lib/format';
import CheckoutPage from '../src/pages/market/CheckoutPage';
import { PayPanel } from '../src/pages/market/PayPanel';
import { ProductFormPage } from '../src/pages/shop/SellPages';

/**
 * Regression tests for Web defects found in the full-system audit.
 * Each test reproduces the reported behaviour first; the fix makes it pass.
 */
const ID = (n: number) => String(n).padStart(24, '0');
const calls = (method: string, path: RegExp | string) =>
  request.mock.calls.filter(
    (c) => c[0] === method && (typeof path === 'string' ? c[1] === path : path.test(String(c[1]))),
  );

const tz = process.env['TZ'];
beforeAll(() => {
  process.env['TZ'] = 'Asia/Bangkok'; // FARM+ users are in Thailand (UTC+7); CI machines may run in UTC
});
afterAll(() => {
  process.env['TZ'] = tz;
});
beforeEach(() => {
  request.mockReset();
  sessionStorage.clear();
});

describe('AUDIT-W1: a finished payment attempt is not replayed forever', () => {
  it('starts a new attempt when the remembered key belongs to an attempt that already failed', async () => {
    sessionStorage.setItem(`farmplus.pay.${ID(9)}`, 'web-old-attempt');
    const payment = (over: object) => ({
      id: ID(30),
      orderId: ID(9),
      amountMinor: 4_250_000,
      currency: 'THB',
      status: 'pending',
      checkoutUrl: null,
      mock: true,
      ...over,
    });
    request
      .mockResolvedValueOnce({ payment: payment({ status: 'failed' }) }) // the old attempt, replayed
      .mockResolvedValueOnce({ payment: payment({ id: ID(31) }) });
    const order = { id: ID(9), totals: { grandTotalMinor: 4_250_000 } } as never;
    render(<PayPanel order={order} onChanged={() => undefined} />);
    await userEvent.click(screen.getByRole('button', { name: /^Pay / }));
    await screen.findByRole('group', { name: 'Test payment' });
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[0]![2].headers['Idempotency-Key']).toBe('web-old-attempt');
    expect(request.mock.calls[1]![2].headers['Idempotency-Key']).not.toBe('web-old-attempt');
  });
});

describe('AUDIT-W2: date-time inputs show and save local (Thai) time', () => {
  it('shows a stored instant as Bangkok wall-clock time, and saving it back keeps the instant', () => {
    const stored = '2026-11-01T03:00:00.000Z'; // 10:00 in Bangkok
    expect(toDateTimeLocal(stored)).toBe('2026-11-01T10:00');
    expect(new Date(toDateTimeLocal(stored)).toISOString()).toBe(stored);
  });
});

describe('AUDIT-W3: record forms default to the Thai calendar date', () => {
  it('is already tomorrow (UTC) between 00:00 and 07:00 in Bangkok', () => {
    expect(thaiToday(Date.parse('2026-10-13T23:30:00Z'))).toBe('2026-10-14');
    expect(thaiToday(Date.parse('2026-10-13T16:59:00Z'))).toBe('2026-10-13');
  });
});

describe('AUDIT-W4: free delivery (฿0) can be offered, as the API allows', () => {
  it('sends a 0 delivery price instead of refusing it', async () => {
    request.mockImplementation(async (m: string, path: string) => {
      if (path === '/shop/categories')
        return {
          categories: [
            {
              key: 'feed',
              name: 'Animal feed',
              regulation: 'none',
              salesEnabled: true,
              complianceReference: null,
              complianceReviewedAt: null,
            },
          ],
        };
      if (m === 'POST') return { product: { id: ID(77), status: 'DRAFT' } };
      return {};
    });
    render(
      <MemoryRouter initialEntries={[`/shop/sell/${ID(10)}/new`]}>
        <Routes>
          <Route path="/shop/sell/:farmId/new" element={<ProductFormPage />} />
          <Route path="*" element={<p>elsewhere</p>} />
        </Routes>
      </MemoryRouter>,
    );
    await screen.findByRole('option', { name: 'Animal feed' });
    await userEvent.selectOptions(screen.getByLabelText('Category'), 'feed');
    await userEvent.type(screen.getByLabelText('Title'), 'Dairy feed');
    await userEvent.type(screen.getByLabelText('Price per unit (฿)'), '1200');
    await userEvent.clear(screen.getByLabelText('Units in stock'));
    await userEvent.type(screen.getByLabelText('Units in stock'), '5');
    await userEvent.type(
      screen.getByLabelText('Photo 1 link (https)'),
      'https://cdn.example.test/p.jpg',
    );
    await userEvent.click(screen.getByLabelText('I deliver'));
    await userEvent.type(screen.getByLabelText('Province 1'), 'Bangkok');
    await userEvent.type(screen.getByLabelText('Price 1 (฿)'), '0');
    await userEvent.click(screen.getByRole('button', { name: 'Create product' }));
    await waitFor(() => expect(calls('POST', `/farms/${ID(10)}/products`)).toHaveLength(1));
    expect(calls('POST', /products/)[0]![2].body.shipping.provinces).toEqual([
      { province: 'Bangkok', priceMinor: 0 },
    ]);
  });
});

describe('AUDIT-W5: checkout', () => {
  const negotiation = {
    id: ID(5),
    listingId: ID(1),
    listingTitle: 'Swamp buffalo',
    status: 'accepted',
    order: {
      status: 'awaiting_payment',
      amountMinor: 4_000_000,
      currency: 'THB',
      reservedUntil: '2030-01-03T00:00:00Z',
    },
  };
  const at = () =>
    render(
      <MemoryRouter initialEntries={[`/market/checkout/${ID(5)}`]}>
        <Routes>
          <Route path="/market/checkout/:negotiationId" element={<CheckoutPage />} />
        </Routes>
      </MemoryRouter>,
    );

  it('shows an error instead of loading forever when the listing cannot be fetched', async () => {
    request.mockImplementation(async (m: string, path: string) => {
      if (m === 'GET' && path.startsWith('/marketplace/negotiations/')) return { negotiation };
      throw new Error('The listing could not be loaded');
    });
    at();
    expect(await screen.findByText('The listing could not be loaded')).toBeTruthy();
  });

  it('a delivery-only listing starts on delivery (there is no pickup to choose)', async () => {
    request.mockImplementation(async (m: string, path: string) => {
      if (m === 'GET' && path.startsWith('/marketplace/negotiations/')) return { negotiation };
      if (m === 'GET' && path.startsWith('/marketplace/listings/'))
        return {
          listing: {
            id: ID(1),
            title: 'Swamp buffalo',
            farmName: 'Happy Farm',
            deliveryOptions: ['delivery'],
          },
        };
      throw new Error(`unexpected ${m} ${path}`);
    });
    at();
    await screen.findByRole('heading', { name: 'Checkout' });
    expect((screen.getByLabelText('Deliver to me') as HTMLInputElement).checked).toBe(true);
    expect(screen.getByLabelText('Province')).toBeTruthy();
  });
});
