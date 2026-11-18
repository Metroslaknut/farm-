import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const request = vi.hoisted(() => vi.fn());
vi.mock('../src/api', () => ({ api: { request } }));

import CheckoutPage from '../src/pages/market/CheckoutPage';
import OrderPage from '../src/pages/market/OrderPage';
import { TotalsTable } from '../src/pages/market/orderCommon';

const ID = (n: number) => String(n).padStart(24, '0');
const person = (n: number, name: string) => ({ id: ID(n), displayName: name });

const negotiation = (over: object = {}) => ({
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
  ...over,
});
const listing = (over: object = {}) => ({
  id: ID(1),
  title: 'Swamp buffalo',
  farmName: 'Happy Farm',
  deliveryOptions: ['pickup', 'delivery'],
  ...over,
});
const quote = (over: object = {}) => ({
  id: ID(7),
  listingId: ID(1),
  destination: { province: 'Bangkok' },
  options: [
    {
      id: 'seller',
      source: 'seller_rule',
      label: 'Delivery arranged by the seller',
      priceMinor: 250_000,
      currency: 'THB',
      estimatedDays: { min: 2, max: 4 },
      isEstimate: true,
      requirements: ['livestock_vehicle'],
    },
  ],
  expiresAt: '2030-01-01T00:00:00Z',
  ...over,
});

const order = (over: object = {}) => ({
  id: ID(9),
  orderNo: 'FP-261012-ABCD1234',
  status: 'PENDING_PAYMENT',
  currency: 'THB',
  buyer: person(20, 'Buyer Bee'),
  seller: person(10, 'Somchai'),
  farmName: 'Happy Farm',
  items: [
    {
      type: 'animal',
      listingId: ID(1),
      animalId: ID(3),
      title: 'Swamp buffalo',
      animal: {
        animalTypeName: 'Buffalo',
        breed: 'swamp',
        sex: 'female',
        birthDateEstimated: false,
      },
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
  fulfillment: 'delivery',
  destination: { province: 'Bangkok' },
  shipping: {
    label: 'Delivery arranged by the seller',
    source: 'seller_rule',
    isEstimate: true,
    estimatedDays: { min: 2, max: 4 },
    requirements: ['livestock_vehicle'],
  },
  paymentDueAt: '2030-01-02T00:00:00Z',
  history: [
    {
      at: '2026-03-01T00:00:00Z',
      from: null,
      to: 'PENDING_PAYMENT',
      by: 'buyer',
      actor: person(20, 'Buyer Bee'),
    },
  ],
  shipments: [],
  viewer: { party: 'buyer' },
  actions: {
    canCancel: true,
    canRequote: true,
    canProcess: false,
    canShip: false,
    canConfirmDelivery: false,
  },
  createdAt: '2026-03-01T00:00:00Z',
  updatedAt: '2026-03-01T00:00:00Z',
  ...over,
});

const at = (path: string, route: string, el: React.ReactNode) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={route} element={el} />
        <Route path="*" element={<p>navigated</p>} />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  request.mockReset();
});

describe('totals', () => {
  it('keeps item price, shipping and the platform fee on separate lines; the buyer never sees the fee', () => {
    const o = order();
    const { unmount } = render(<TotalsTable order={o as never} party="buyer" />);
    const t = within(screen.getByRole('table', { name: 'Order totals' }));
    expect(t.getByText('฿40,000.00')).toBeTruthy();
    expect(t.getByText('฿2,500.00')).toBeTruthy();
    expect(t.getByText('฿42,500.00')).toBeTruthy();
    expect(t.queryByText(/Platform fee/)).toBeNull();
    expect(screen.getByText(/delivery time is an estimate/)).toBeTruthy();
    unmount();
    render(<TotalsTable order={o as never} party="seller" />);
    expect(screen.getByText(/Platform fee \(deducted from your payout\)/)).toBeTruthy();
    expect(screen.getByText('−฿2,000.00')).toBeTruthy();
    expect(screen.getByText('฿38,000.00')).toBeTruthy();
  });
});

describe('checkout', () => {
  const open = (neg = negotiation(), l = listing()) => {
    request.mockImplementation(async (m: string, path: string, opts?: { body?: unknown }) => {
      if (m === 'GET' && path.startsWith('/marketplace/negotiations/')) return { negotiation: neg };
      if (m === 'GET' && path.startsWith('/marketplace/listings/')) return { listing: l };
      if (path === '/shipping/quotes') return { quote: quote() };
      if (path === '/orders') return { order: order({ id: ID(9) }), echo: opts?.body };
      throw new Error(`unexpected ${m} ${path}`);
    });
  };

  it('pickup: sends only the deal and the method — never a price', async () => {
    open();
    const user = userEvent.setup();
    at(`/market/checkout/${ID(5)}`, '/market/checkout/:negotiationId', <CheckoutPage />);
    await screen.findByRole('heading', { name: 'Checkout' });
    expect(
      within(screen.getByRole('table', { name: 'Order summary' })).getByText('Pickup — free'),
    ).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Place order' }));
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith('POST', '/orders', {
        body: { negotiationId: ID(5), fulfillment: 'pickup' },
      }),
    );
    expect(await screen.findByText('navigated')).toBeTruthy();
  });

  it('delivery: needs a quote, shows the estimate as an estimate, and requires the transport acknowledgement', async () => {
    open();
    const user = userEvent.setup();
    at(`/market/checkout/${ID(5)}`, '/market/checkout/:negotiationId', <CheckoutPage />);
    await user.click(await screen.findByLabelText('Deliver to me'));
    expect(
      (screen.getByRole('button', { name: 'Place order' }) as HTMLButtonElement).disabled,
    ).toBe(true); // no quote yet
    await user.click(screen.getByRole('button', { name: 'Get shipping quote' }));
    expect(await screen.findByText('Enter the province first')).toBeTruthy();
    await user.type(screen.getByLabelText('Province'), 'Bangkok');
    await user.click(screen.getByRole('button', { name: 'Get shipping quote' }));
    expect(await screen.findByText(/Delivery arranged by the seller/)).toBeTruthy();
    expect(screen.getByText('estimate')).toBeTruthy();
    expect(screen.getByText(/Rate set by the seller/)).toBeTruthy();
    expect(
      within(screen.getByRole('table', { name: 'Order summary' })).getByText('฿42,500.00'),
    ).toBeTruthy();
    // incomplete address → field errors from the shared schema, nothing sent
    await user.click(screen.getByRole('button', { name: 'Place order' }));
    expect(await screen.findByText('Enter the recipient name')).toBeTruthy();
    expect(request.mock.calls.some((c) => c[1] === '/orders')).toBe(false);
    await user.type(screen.getByLabelText('Recipient name'), 'Somsak Jaidee');
    await user.type(screen.getByLabelText('Phone'), '+66 81 234 5678');
    await user.type(screen.getByLabelText('Street address'), '99/9 Moo 3 Secret Street');
    await user.type(screen.getByLabelText('District'), 'Bang Na');
    await user.type(screen.getByLabelText('Postal code'), '10260');
    await user.click(screen.getByRole('button', { name: 'Place order' }));
    expect(await screen.findByText(/Confirm you can meet the transport requirements/)).toBeTruthy();
    await user.click(screen.getByLabelText(/I understand and will meet these requirements/));
    await user.click(screen.getByRole('button', { name: 'Place order' }));
    await waitFor(() => {
      const post = request.mock.calls.find((c) => c[1] === '/orders')!;
      expect(post[2].body).toMatchObject({
        negotiationId: ID(5),
        fulfillment: 'delivery',
        quoteId: ID(7),
        optionId: 'seller',
        acknowledgeTransport: true,
        address: { province: 'Bangkok', postalCode: '10260', recipientName: 'Somsak Jaidee' },
      });
      expect(post[2].body.address).not.toHaveProperty('note');
      expect(JSON.stringify(post[2].body)).not.toMatch(/priceMinor|shippingMinor|totals/);
    });
  });

  it('changing the province throws away the quote (a quote is for one destination)', async () => {
    open();
    const user = userEvent.setup();
    at(`/market/checkout/${ID(5)}`, '/market/checkout/:negotiationId', <CheckoutPage />);
    await user.click(await screen.findByLabelText('Deliver to me'));
    await user.type(screen.getByLabelText('Province'), 'Bangkok');
    await user.click(screen.getByRole('button', { name: 'Get shipping quote' }));
    await screen.findByText(/Delivery arranged by the seller/);
    await user.type(screen.getByLabelText('Province'), 'x');
    expect(screen.queryByText(/Delivery arranged by the seller/)).toBeNull();
    expect(
      (screen.getByRole('button', { name: 'Place order' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('explains when delivery is unavailable for the address', async () => {
    request.mockImplementation(async (m: string, path: string) => {
      if (m === 'GET' && path.startsWith('/marketplace/negotiations/'))
        return { negotiation: negotiation() };
      if (m === 'GET') return { listing: listing() };
      return {
        quote: quote({ options: [], unavailableReason: 'The seller does not deliver to Phuket.' }),
      };
    });
    const user = userEvent.setup();
    at(`/market/checkout/${ID(5)}`, '/market/checkout/:negotiationId', <CheckoutPage />);
    await user.click(await screen.findByLabelText('Deliver to me'));
    await user.type(screen.getByLabelText('Province'), 'Phuket');
    await user.click(screen.getByRole('button', { name: 'Get shipping quote' }));
    expect(await screen.findByText('The seller does not deliver to Phuket.')).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: 'Place order' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('a pickup-only listing offers no delivery; an unaccepted or already ordered deal cannot be checked out', async () => {
    open(negotiation(), listing({ deliveryOptions: ['pickup'] }));
    const { unmount } = at(
      `/market/checkout/${ID(5)}`,
      '/market/checkout/:negotiationId',
      <CheckoutPage />,
    );
    await screen.findByRole('heading', { name: 'Checkout' });
    expect(screen.queryByLabelText('Deliver to me')).toBeNull();
    unmount();
    open(negotiation({ status: 'open', order: undefined }));
    const second = at(
      `/market/checkout/${ID(5)}`,
      '/market/checkout/:negotiationId',
      <CheckoutPage />,
    );
    expect(await screen.findByText(/has not been accepted/)).toBeTruthy();
    second.unmount();
    open(
      negotiation({
        order: {
          status: 'awaiting_payment',
          amountMinor: 1,
          currency: 'THB',
          reservedUntil: '2030-01-03T00:00:00Z',
          orderId: ID(9),
        },
      }),
    );
    at(`/market/checkout/${ID(5)}`, '/market/checkout/:negotiationId', <CheckoutPage />);
    expect(await screen.findByText(/An order already exists/)).toBeTruthy();
  });
});

describe('order page', () => {
  const open = (o: object) => {
    request.mockImplementation(async (m: string) => (m === 'GET' ? { order: o } : { order: o }));
  };

  it('shows the status, payment deadline and the actions the server says are allowed — nothing else', async () => {
    open(order());
    at(`/market/orders/${ID(9)}`, '/market/orders/:id', <OrderPage />);
    expect(await screen.findByRole('heading', { name: /Order FP-261012-ABCD1234/ })).toBeTruthy();
    expect(screen.getByText(/Waiting for your payment/)).toBeTruthy();
    expect(screen.getByText(/Payment is confirmed automatically/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancel order' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Change address/ })).toBeTruthy();
    for (const hidden of ['Start processing', 'Mark as shipped', 'I received the animal'])
      expect(screen.queryByRole('button', { name: hidden })).toBeNull();
    expect(screen.getByText(/price fixed at checkout/)).toBeTruthy();
  });

  it('cancelling needs a reason, and says what happens next', async () => {
    open(
      order({
        status: 'PAID',
        paymentDueAt: null,
        actions: {
          canCancel: true,
          canRequote: false,
          canProcess: false,
          canShip: false,
          canConfirmDelivery: false,
        },
      }),
    );
    const user = userEvent.setup();
    at(`/market/orders/${ID(9)}`, '/market/orders/:id', <OrderPage />);
    await user.click(await screen.findByRole('button', { name: 'Cancel order' }));
    expect(screen.getByText(/will be refunded/)).toBeTruthy();
    const confirm = screen
      .getAllByRole('button', { name: 'Cancel order' })
      .at(-1) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    await user.type(screen.getByLabelText('Reason'), 'Changed my mind');
    await user.click(screen.getAllByRole('button', { name: 'Cancel order' }).at(-1)!);
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith('POST', `/orders/${ID(9)}/cancel`, {
        body: { reason: 'Changed my mind' },
      }),
    );
  });

  it('seller: process, then ship with a carrier (tracking and estimate optional)', async () => {
    const seller = {
      viewer: { party: 'seller' },
      address: {
        recipientName: 'Somsak Jaidee',
        phone: '+66',
        line1: '99/9 Secret Street',
        district: 'Bang Na',
        province: 'Bangkok',
        postalCode: '10260',
      },
    };
    open(
      order({
        ...seller,
        status: 'PAID',
        actions: {
          canCancel: true,
          canRequote: false,
          canProcess: true,
          canShip: false,
          canConfirmDelivery: false,
        },
      }),
    );
    const user = userEvent.setup();
    const first = at(`/market/orders/${ID(9)}`, '/market/orders/:id', <OrderPage />);
    expect(await screen.findByText(/Platform fee \(deducted from your payout\)/)).toBeTruthy();
    expect(screen.getByText(/99\/9 Secret Street/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Start processing' }));
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith('POST', `/orders/${ID(9)}/process`, { body: {} }),
    );
    first.unmount();
    request.mockReset();
    open(
      order({
        ...seller,
        status: 'PROCESSING',
        actions: {
          canCancel: true,
          canRequote: false,
          canProcess: false,
          canShip: true,
          canConfirmDelivery: false,
        },
      }),
    );
    at(`/market/orders/${ID(9)}`, '/market/orders/:id', <OrderPage />);
    await user.click(await screen.findByRole('button', { name: 'Mark as shipped' }));
    expect(
      (screen.getAllByRole('button', { name: 'Mark as shipped' }).at(-1) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    await user.type(screen.getByLabelText('Carrier or how it is sent'), 'Livestock Express');
    await user.type(screen.getByLabelText('Tracking number (optional)'), 'LE-12345-TH');
    await user.type(screen.getByLabelText('Expected days — from (optional)'), '2');
    await user.type(screen.getByLabelText('Expected days — to'), '3');
    await user.click(screen.getAllByRole('button', { name: 'Mark as shipped' }).at(-1)!);
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith('POST', `/orders/${ID(9)}/ship`, {
        body: {
          carrier: 'Livestock Express',
          trackingNumber: 'LE-12345-TH',
          expectedDays: { min: 2, max: 3 },
        },
      }),
    );
  });

  it('tracking: events with their source, expected time flagged as an estimate, and delivery confirmation for the buyer', async () => {
    const shipment = {
      id: ID(11),
      attempt: 1,
      status: 'delivered',
      carrier: 'Livestock Express',
      trackingNumber: 'LE-12345-TH',
      expectedDays: { min: 2, max: 3 },
      isEstimate: true,
      events: [
        { at: '2026-03-01T00:00:00Z', status: 'in_transit', source: 'seller' },
        {
          at: '2026-03-03T00:00:00Z',
          status: 'delivered',
          source: 'provider',
          location: 'Bangkok hub',
        },
      ],
    };
    open(
      order({
        status: 'SHIPPED',
        deliveredAt: '2026-03-03T00:00:00Z',
        shipments: [shipment],
        actions: {
          canCancel: false,
          canRequote: false,
          canProcess: false,
          canShip: false,
          canConfirmDelivery: true,
        },
      }),
    );
    const user = userEvent.setup();
    at(`/market/orders/${ID(9)}`, '/market/orders/:id', <OrderPage />);
    const events = await screen.findByRole('list', { name: 'Tracking events' });
    expect(within(events).getByText(/carrier · Bangkok hub/)).toBeTruthy();
    expect(screen.getByText(/LE-12345-TH/)).toBeTruthy();
    expect(screen.getAllByText('estimate').length).toBeGreaterThan(0);
    expect(screen.getByText(/carrier reports delivery/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'I received the animal' }));
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith('POST', `/orders/${ID(9)}/confirm-delivery`, {
        body: {},
      }),
    );
  });

  it('a conflict from the server is shown and the latest state reloaded', async () => {
    let gets = 0;
    request.mockImplementation(async (m: string) => {
      if (m === 'GET') {
        gets++;
        return { order: order() };
      }
      throw Object.assign(
        new Error('The order changed while you were working: reload and try again'),
        { status: 409 },
      );
    });
    const user = userEvent.setup();
    at(`/market/orders/${ID(9)}`, '/market/orders/:id', <OrderPage />);
    await user.click(await screen.findByRole('button', { name: 'Cancel order' }));
    await user.type(screen.getByLabelText('Reason'), 'Because');
    await user.click(screen.getAllByRole('button', { name: 'Cancel order' }).at(-1)!);
    expect(await screen.findByText(/order changed while you were working/)).toBeTruthy();
    await waitFor(() => expect(gets).toBeGreaterThanOrEqual(2));
  });

  it('refund / cancelled / refunded states are explained; cancelled orders offer no actions', async () => {
    open(
      order({
        status: 'REFUND_PENDING',
        cancelReason: 'shipment_returned',
        actions: {
          canCancel: false,
          canRequote: false,
          canProcess: false,
          canShip: false,
          canConfirmDelivery: false,
        },
      }),
    );
    at(`/market/orders/${ID(9)}`, '/market/orders/:id', <OrderPage />);
    expect(await screen.findByText(/refund of ฿42,500.00 is pending/)).toBeTruthy();
    expect(screen.getByText(/Shipment returned/)).toBeTruthy();
    expect(screen.getByText(/No actions available/)).toBeTruthy();
  });
});
