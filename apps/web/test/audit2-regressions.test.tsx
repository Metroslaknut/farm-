/* eslint-disable @typescript-eslint/no-explicit-any -- request options and payloads are inspected loosely in tests */
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClientError } from '@farmplus/api-client';

const request = vi.hoisted(() => vi.fn());
vi.mock('../src/api', () => ({ api: { request } }));

/** `fetch` for the real `../src/api` module (W1); installed before that module creates its clients. */
const fetchMock = vi.hoisted(() => {
  const fn = vi.fn();
  globalThis.fetch = fn as unknown as typeof fetch;
  return fn;
});

/** A controllable realtime client for the chat (W3): tests fire a resync by hand. */
const fake = vi.hoisted(() => {
  const resync = new Set<() => void>();
  const client = {
    on: () => () => undefined,
    onResync: (h: () => void) => (resync.add(h), () => resync.delete(h)),
    join: async () => ({ ok: true }),
    leave: () => undefined,
  };
  return { client, resync: () => resync.forEach((h) => h()), clear: () => resync.clear() };
});
vi.mock('../src/lib/inbox', () => ({
  useInbox: () => ({ client: fake.client, state: 'connected', refresh: () => undefined }),
}));

import { tokenStore } from '../src/auth/tokens';
import WalletPage from '../src/pages/market/WalletPage';
import MessagesPage from '../src/pages/inbox/MessagesPage';
import ProductPage from '../src/pages/shop/ProductPage';
import CartPage from '../src/pages/shop/CartPage';

/**
 * Regression tests for Web defects found in the second audit.
 * Each test reproduces the reported behaviour first; the fix makes it pass.
 */
const ID = (n: number) => String(n).padStart(24, '0');
const calls = (method: string, path: RegExp | string) =>
  request.mock.calls.filter(
    (c) => c[0] === method && (typeof path === 'string' ? c[1] === path : path.test(String(c[1]))),
  );

beforeEach(() => {
  request.mockReset();
  fetchMock.mockReset();
  fake.clear();
  sessionStorage.clear();
});

describe('AUDIT2-W1: only a definitive rejection of the refresh token ends the session', () => {
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  /** The real module (the rest of this file uses the mocked `api`). */
  const actualApi = () => vi.importActual<{ refreshSession: () => Promise<boolean> }>('../src/api');
  const errorBody = (code: string) => ({ error: { code, message: code } });

  it.each([
    ['a network error', () => Promise.reject(new TypeError('Failed to fetch'))],
    ['429', () => Promise.resolve(json(429, errorBody('RATE_LIMITED')))],
    ['503', () => Promise.resolve(json(503, errorBody('UNAVAILABLE')))],
    ['500', () => Promise.resolve(json(500, errorBody('INTERNAL')))],
  ])('keeps the refresh token and stays signed in after %s', async (_label, respond) => {
    const { refreshSession } = await actualApi();
    sessionStorage.setItem('farmplus.refresh', 'refresh-1');
    const lost = vi.fn();
    const off = tokenStore.onSessionLost(lost);
    fetchMock.mockImplementation(respond);
    expect(await refreshSession()).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(tokenStore.getRefresh()).toBe('refresh-1');
    expect(lost).not.toHaveBeenCalled();
    off();
  });

  it.each([400, 401, 403])('signs out when the API rejects the refresh token (%i)', async (s) => {
    const { refreshSession } = await actualApi();
    sessionStorage.setItem('farmplus.refresh', 'refresh-1');
    const lost = vi.fn();
    const off = tokenStore.onSessionLost(lost);
    fetchMock.mockResolvedValue(json(s, errorBody('INVALID_TOKEN')));
    expect(await refreshSession()).toBe(false);
    expect(tokenStore.getRefresh()).toBeNull();
    expect(lost).toHaveBeenCalledTimes(1);
    off();
  });
});

describe('AUDIT2-W2: a rejected withdrawal is never replayed by the next request', () => {
  const wallet = {
    id: ID(40),
    currency: 'THB',
    pendingMinor: 0,
    availableMinor: 3_000_000,
    payoutAccount: { bankCode: 'KBANK', accountName: 'Somchai Jaidee', accountLast4: '7890' },
    payoutsEnabled: true,
    minWithdrawalMinor: 10_000,
  };
  const setup = (post: () => Promise<unknown>) => {
    request.mockImplementation(async (method: string, path: string) => {
      if (method === 'GET' && path === '/wallet') return { wallet };
      if (method === 'GET' && path.startsWith('/wallet/')) return { items: [] };
      if (method === 'POST' && path === '/wallet/withdrawals') return post();
      return {};
    });
    render(
      <MemoryRouter>
        <WalletPage />
      </MemoryRouter>,
    );
  };
  const keys = () =>
    calls('POST', '/wallet/withdrawals').map((c) => c[2].headers['Idempotency-Key']);
  const submit = () => userEvent.click(screen.getByRole('button', { name: 'Request withdrawal' }));

  it('uses a new key after the server answered with a 4xx, even for the same amount', async () => {
    const post = vi
      .fn()
      .mockRejectedValueOnce(
        new ApiClientError('Not enough available balance', 409, { code: 'INSUFFICIENT_FUNDS' }),
      )
      .mockResolvedValueOnce({ withdrawal: {} });
    setup(post);
    await userEvent.type(await screen.findByLabelText(/Amount/), '1500');
    await submit();
    expect(await screen.findByText('Not enough available balance')).toBeTruthy();
    await submit();
    await waitFor(() => expect(keys()).toHaveLength(2));
    expect(keys()[1]).not.toBe(keys()[0]);
  });

  it('keeps the key after a network error (the request may have arrived), unless the amount changes', async () => {
    const post = vi
      .fn()
      .mockRejectedValue(new ApiClientError('Unable to reach the FARM+ API', undefined));
    setup(post);
    const amount = await screen.findByLabelText(/Amount/);
    await userEvent.type(amount, '1500');
    await submit();
    await screen.findByText('Unable to reach the FARM+ API');
    await submit();
    await waitFor(() => expect(keys()).toHaveLength(2));
    expect(keys()[1]).toBe(keys()[0]);
    await userEvent.clear(amount);
    await userEvent.type(amount, '1200');
    await submit();
    await waitFor(() => expect(keys()).toHaveLength(3));
    expect(keys()[2]).not.toBe(keys()[0]);
  });
});

describe('AUDIT2-W3: catching up after a reconnect follows every page', () => {
  const msg = (seq: number) => ({
    id: `m${seq}`,
    conversationId: 'c1',
    seq,
    side: 'seller',
    mine: false,
    senderName: 'Somchai',
    body: `Message ${seq}`,
    createdAt: '2026-06-15T05:00:00.000Z',
    readAt: null,
  });
  const conv = {
    id: 'c1',
    farmId: 'f1',
    farmName: 'Happy Farm',
    myRole: 'buyer',
    counterpartName: 'Happy Farm',
    subject: null,
    lastMessage: null,
    unread: 0,
    blocked: null,
    createdAt: '2026-06-15T05:00:00.000Z',
  };

  it('keeps fetching while the server says there is more', async () => {
    request.mockImplementation(async (method: string, path: string, opts: any = {}) => {
      if (method === 'GET' && path === '/conversations') return { items: [conv] };
      if (method === 'GET' && path === '/conversations/c1') return { conversation: conv };
      if (method === 'GET' && path === '/conversations/c1/messages') {
        const after = opts.query?.after;
        if (after === undefined) return { items: [msg(1), msg(2)], hasMore: false };
        const from = after + 1;
        const to = Math.min(after + opts.query.limit, 120);
        const items = Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => msg(from + i));
        return { items, hasMore: to < 120 };
      }
      if (method === 'POST') return { updated: 0 };
      return {};
    });
    render(
      <MemoryRouter initialEntries={['/messages/c1']}>
        <Routes>
          <Route path="/messages/:conversationId" element={<MessagesPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await screen.findByText('Message 2');
    act(() => fake.resync());
    expect(await screen.findByText('Message 120')).toBeTruthy();
    expect(screen.getByText('Message 60')).toBeTruthy();
    const afters = calls('GET', '/conversations/c1/messages')
      .map((c) => c[2]?.query?.after)
      .filter((a) => a !== undefined);
    expect(afters).toEqual([2, 52, 102]);
  });
});

const product = (over: object = {}) => ({
  id: ID(1),
  farmId: ID(10),
  farmName: 'Happy Farm',
  seller: { id: ID(20), displayName: 'Somchai' },
  categoryKey: 'feed',
  categoryName: 'Animal feed',
  title: 'Dairy feed 25 kg',
  description: null,
  brand: null,
  sku: null,
  unit: 'bag',
  status: 'ACTIVE',
  currency: 'THB',
  priceMinor: 120_000,
  promotion: null,
  effectivePriceMinor: 120_000,
  onSale: false,
  specs: [],
  photos: [],
  deliveryOptions: ['pickup'],
  minOrderQty: 1,
  maxOrderQty: null,
  available: 8,
  inStock: true,
  regulatory: null,
  rating: { average: 0, count: 0 },
  soldCount: 0,
  viewer: { isSellerSide: false },
  createdAt: '2026-01-01T00:00:00Z',
  ...over,
});
const line = (productId: string, quantity: number) => ({
  productId,
  quantity,
  title: 'Dairy feed 25 kg',
  photoUrl: null,
  unit: 'bag',
  farmId: ID(10),
  farmName: 'Happy Farm',
  unitPriceMinor: 120_000,
  regularPriceMinor: 120_000,
  onSale: false,
  lineTotalMinor: 120_000 * quantity,
  available: 8,
  problems: [],
});
const cartOf = (lines: ReturnType<typeof line>[], over: object = {}) => ({
  cart: {
    groups: lines.length
      ? [
          {
            farmId: ID(10),
            farmName: 'Happy Farm',
            lines,
            itemsMinor: lines.reduce((a, l) => a + l.lineTotalMinor, 0),
            canPickup: true,
            canDeliver: true,
            ...over,
          },
        ]
      : [],
    itemCount: lines.reduce((a, l) => a + l.quantity, 0),
    itemsMinor: lines.reduce((a, l) => a + l.lineTotalMinor, 0),
    hasProblems: false,
    updatedAt: null,
  },
});

describe('AUDIT2-W4: "Add to cart" adds to what is already in the cart', () => {
  const renderProduct = (p: ReturnType<typeof product>, inCart: number) => {
    request.mockImplementation(async (method: string, path: string, opts: any = {}) => {
      if (method === 'GET' && path === `/shop/products/${p.id}`) return { product: p };
      if (method === 'GET' && path.endsWith('/reviews'))
        return { items: [], eligibility: { eligible: false, reviewed: false } };
      if (method === 'GET' && path === '/shop/cart')
        return cartOf(inCart ? [line(ID(2), 4), line(p.id, inCart)] : [line(ID(2), 4)]);
      if (method === 'PUT') return cartOf([line(p.id, opts.body.quantity)]);
      return {};
    });
    render(
      <MemoryRouter initialEntries={[`/shop/product/${p.id}`]}>
        <Routes>
          <Route path="/shop/product/:id" element={<ProductPage />} />
        </Routes>
      </MemoryRouter>,
    );
  };
  const addQty = async (n: string) => {
    const qty = await screen.findByLabelText('Quantity');
    await userEvent.clear(qty);
    await userEvent.type(qty, n);
    await userEvent.click(screen.getByRole('button', { name: 'Add to cart' }));
  };

  it('2 already in the cart + 3 sets the line to 5', async () => {
    renderProduct(product(), 2);
    await addQty('3');
    await waitFor(() => expect(calls('PUT', `/shop/cart/items/${ID(1)}`)).toHaveLength(1));
    expect(calls('PUT', /cart/)[0]![2]).toEqual({ body: { quantity: 5 } });
    expect(await screen.findByText('Added to your cart.')).toBeTruthy();
  });

  it('checks the stock and the maximum against the resulting total', async () => {
    renderProduct(product({ available: 4 }), 2);
    await addQty('3');
    expect(await screen.findByText(/Only 4 in stock/)).toBeTruthy();
    expect(calls('PUT', /cart/)).toHaveLength(0);
  });

  it('a product not yet in the cart is added with the typed quantity', async () => {
    renderProduct(product(), 0);
    await addQty('3');
    await waitFor(() => expect(calls('PUT', /cart/)).toHaveLength(1));
    expect(calls('PUT', /cart/)[0]![2]).toEqual({ body: { quantity: 3 } });
  });
});

describe('AUDIT2-W5: the shipping quote is not re-fetched on every keystroke', () => {
  it('fetches once after typing settles, and checkout waits for the quote of the typed province', async () => {
    request.mockImplementation(async (method: string, path: string, opts: any = {}) => {
      if (method === 'GET' && path === '/shop/cart')
        return cartOf(
          [line(ID(1), 2)],
          opts.query?.province
            ? {
                shipping: {
                  available: true,
                  shippingMinor: opts.query.province === 'Bangkok' ? 15_000 : 9_000,
                  isEstimate: true,
                },
              }
            : {},
        );
      if (method === 'POST') return { orders: [{ id: ID(99) }] };
      return {};
    });
    render(
      <MemoryRouter initialEntries={['/shop/cart']}>
        <Routes>
          <Route path="/shop/cart" element={<CartPage />} />
          <Route path="*" element={<p>elsewhere</p>} />
        </Routes>
      </MemoryRouter>,
    );
    await screen.findByText('Dairy feed 25 kg');
    await userEvent.click(screen.getByLabelText('Deliver to me'));
    await userEvent.type(screen.getByLabelText('Recipient name'), 'Somsak Jaidee');
    await userEvent.type(screen.getByLabelText('Phone'), '+66 81 234 5678');
    await userEvent.type(screen.getByLabelText('Street address'), '99/9 Moo 3 Street');
    await userEvent.type(screen.getByLabelText('District'), 'Bang Na');
    await userEvent.type(screen.getByLabelText('Postal code'), '10260');
    await userEvent.type(screen.getByLabelText('Province'), 'Nan');
    await waitFor(() => expect(screen.getByText('Shipping: ฿90.00')).toBeTruthy());
    const province = screen.getByLabelText('Province');
    await userEvent.clear(province);
    await userEvent.type(province, 'Bangkok');
    const button = screen.getByRole('button', { name: 'Place order' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true); // the shown quote is for "Nan" until "Bangkok" is quoted
    await waitFor(() => expect(screen.getByText('Shipping: ฿150.00')).toBeTruthy());
    const provinces = calls('GET', '/shop/cart')
      .map((c) => c[2]?.query?.province)
      .filter(Boolean);
    expect(provinces).toEqual(['Nan', 'Bangkok']);
    await waitFor(() => expect(button.disabled).toBe(false));
    await userEvent.click(button);
    await waitFor(() => expect(calls('POST', '/shop/cart/checkout')).toHaveLength(1));
    const body = calls('POST', '/shop/cart/checkout')[0]![2].body;
    expect(body.expected).toEqual([{ farmId: ID(10), itemsMinor: 240_000, shippingMinor: 15_000 }]);
    expect(body.address.province).toBe('Bangkok');
  });
});
