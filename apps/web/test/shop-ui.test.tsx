import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const request = vi.hoisted(() => vi.fn());
vi.mock('../src/api', () => ({ api: { request } }));

import ProductsAdminPage from '../src/pages/admin/products';
import ShopBrowsePage from '../src/pages/shop/BrowsePage';
import CartPage from '../src/pages/shop/CartPage';
import ProductPage from '../src/pages/shop/ProductPage';
import { ProductFormPage } from '../src/pages/shop/SellPages';
import { setLocale } from '../src/i18n';

const ID = (n: number) => String(n).padStart(24, '0');
const calls = (method: string, path: RegExp | string) =>
  request.mock.calls.filter(
    (c) => c[0] === method && (typeof path === 'string' ? c[1] === path : path.test(String(c[1]))),
  );

const product = (over: object = {}) => ({
  id: ID(1),
  farmId: ID(10),
  farmName: 'Happy Farm',
  seller: { id: ID(20), displayName: 'Somchai' },
  categoryKey: 'feed',
  categoryName: 'Animal feed',
  title: 'Dairy feed 25 kg',
  description: 'Pellet feed.',
  brand: 'AgriBest',
  sku: 'DF-25',
  unit: 'bag',
  status: 'ACTIVE',
  currency: 'THB',
  priceMinor: 120_000,
  promotion: null,
  effectivePriceMinor: 120_000,
  onSale: false,
  specs: [{ name: 'Protein', value: '18%' }],
  photos: [{ url: 'https://cdn.example.test/a.jpg' }],
  deliveryOptions: ['pickup', 'delivery'],
  minOrderQty: 1,
  maxOrderQty: null,
  available: 8,
  inStock: true,
  regulatory: null,
  rating: { average: 4, count: 2 },
  soldCount: 3,
  viewer: { isSellerSide: false },
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  ...over,
});
const categories = [
  {
    key: 'feed',
    name: 'Animal feed',
    regulation: 'none',
    salesEnabled: true,
    complianceReference: null,
    complianceReviewedAt: null,
  },
  {
    key: 'medicines',
    name: 'Veterinary medicines',
    regulation: 'regulated',
    salesEnabled: false,
    requiresRegistration: true,
    complianceReference: null,
    complianceReviewedAt: null,
  },
];

beforeEach(() => {
  request.mockReset();
});

describe('shop browse', () => {
  it('shows only open categories in the filter, shows promotions and out-of-stock, and validates prices before searching', async () => {
    request.mockImplementation(async (_m: string, path: string) => {
      if (path === '/shop/categories') return { categories };
      if (path === '/shop/cart') return { cart: { itemCount: 3 } };
      return {
        items: [
          product({ onSale: true, effectivePriceMinor: 90_000 }),
          product({ id: ID(2), title: 'Sold out feed', inStock: false, available: 0 }),
        ],
        total: 2,
        page: 1,
        pageSize: 12,
      };
    });
    render(
      <MemoryRouter>
        <ShopBrowsePage />
      </MemoryRouter>,
    );
    expect(await screen.findByText('Dairy feed 25 kg')).toBeTruthy();
    const opts = within(screen.getByLabelText('Category'))
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(opts).toEqual(['All categories', 'Animal feed']); // medicines are closed: not offered
    expect(screen.getByText('Sale')).toBeTruthy();
    expect(screen.getByText('Out of stock')).toBeTruthy();
    expect(screen.getByText(/Cart \(3\)/)).toBeTruthy();
    const before = calls('GET', '/shop/products').length;
    await userEvent.type(screen.getByLabelText('Lowest price (฿)'), 'abc');
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(await screen.findByText(/Enter prices as numbers/)).toBeTruthy();
    expect(calls('GET', '/shop/products')).toHaveLength(before);
    await userEvent.clear(screen.getByLabelText('Lowest price (฿)'));
    await userEvent.type(screen.getByLabelText('Lowest price (฿)'), '500');
    await userEvent.type(screen.getByLabelText('Highest price (฿)'), '100');
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(await screen.findByText(/lowest price is above the highest/)).toBeTruthy();
    await userEvent.clear(screen.getByLabelText('Highest price (฿)'));
    await userEvent.type(screen.getByLabelText('Highest price (฿)'), '900.50');
    await userEvent.type(screen.getByLabelText('Search'), 'feed');
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() =>
      expect(calls('GET', '/shop/products').at(-1)![2].query).toMatchObject({
        q: 'feed',
        minPriceMinor: 50_000,
        maxPriceMinor: 90_050,
      }),
    );
  });
});

const renderProduct = (
  p = product(),
  reviews: object = {
    items: [],
    eligibility: {
      eligible: false,
      reason: 'Only buyers who received this product can review it',
      reviewed: false,
    },
  },
) => {
  request.mockImplementation(async (m: string, path: string) => {
    if (m === 'GET' && path === `/shop/products/${p.id}`) return { product: p };
    if (m === 'GET' && path.endsWith('/reviews')) return reviews;
    return {};
  });
  return render(
    <MemoryRouter initialEntries={[`/shop/product/${p.id}`]}>
      <Routes>
        <Route path="/shop/product/:id" element={<ProductPage />} />
        <Route path="*" element={<p>elsewhere</p>} />
      </Routes>
    </MemoryRouter>,
  );
};

describe('product page', () => {
  it('shows price, stock, specs and reviews, and checks the quantity before adding to the cart', async () => {
    renderProduct(product({ minOrderQty: 2, maxOrderQty: 5, available: 4 }));
    expect(await screen.findByRole('heading', { name: 'Dairy feed 25 kg', level: 1 })).toBeTruthy();
    expect(screen.getByText('฿1,200.00')).toBeTruthy();
    expect(screen.getByText(/In stock \(4\)/)).toBeTruthy();
    expect(within(screen.getByLabelText('Specifications')).getByText('18%')).toBeTruthy();
    const qty = screen.getByLabelText('Quantity');
    const add = () => userEvent.click(screen.getByRole('button', { name: 'Add to cart' }));
    await userEvent.clear(qty);
    await userEvent.type(qty, '1');
    await add();
    expect(await screen.findByText(/minimum order is 2/)).toBeTruthy();
    await userEvent.clear(qty);
    await userEvent.type(qty, '6');
    await add();
    expect(await screen.findByText(/maximum order is 5/)).toBeTruthy();
    await userEvent.clear(qty);
    await userEvent.type(qty, '5');
    await add();
    expect(await screen.findByText(/Only 4 in stock/)).toBeTruthy();
    expect(calls('PUT', /cart/)).toHaveLength(0);
    await userEvent.clear(qty);
    await userEvent.type(qty, '3');
    await add();
    await waitFor(() => expect(calls('PUT', `/shop/cart/items/${ID(1)}`)).toHaveLength(1));
    expect(calls('PUT', /cart/)[0]![2]).toEqual({ body: { quantity: 3 } });
    expect(await screen.findByText('Added to your cart.')).toBeTruthy();
  });

  it('offers no purchase for out-of-stock, unlisted or own products', async () => {
    renderProduct(product({ inStock: false, available: 0 }));
    await screen.findByRole('heading', { name: 'Dairy feed 25 kg', level: 1 });
    expect(screen.queryByRole('form', { name: 'Add to cart' })).toBeNull();
    expect(screen.getByText('Out of stock', { selector: 'span' })).toBeTruthy();
  });

  it('own product: a link to manage it, no add-to-cart; non-live product: warning', async () => {
    renderProduct(product({ viewer: { isSellerSide: true }, status: 'DRAFT' }));
    expect(await screen.findByText(/Only you and moderators can see it/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Manage it' })).toBeTruthy();
    expect(screen.queryByRole('form', { name: 'Add to cart' })).toBeNull();
  });

  it('reviews: only an eligible buyer sees the form; the rating is validated; verified purchases are labelled', async () => {
    renderProduct(product(), {
      items: [
        {
          id: ID(5),
          productId: ID(1),
          author: { id: ID(2), displayName: 'Buyer Bee' },
          rating: 5,
          title: 'Great',
          body: 'Cows love it',
          verifiedPurchase: true,
          status: 'published',
          createdAt: '2026-02-01T00:00:00Z',
          mine: false,
        },
      ],
      eligibility: { eligible: true, reviewed: false },
    });
    expect(await screen.findByText('Cows love it')).toBeTruthy();
    expect(screen.getByText(/Verified purchase/)).toBeTruthy();
    await userEvent.clear(screen.getByLabelText('Stars (1–5)'));
    await userEvent.type(screen.getByLabelText('Stars (1–5)'), '9');
    await userEvent.type(screen.getByLabelText('Your review'), 'Good');
    await userEvent.click(screen.getByRole('button', { name: 'Post review' }));
    expect(await screen.findByText(/1 to 5 stars/)).toBeTruthy();
    expect(calls('POST', /reviews/)).toHaveLength(0);
    await userEvent.clear(screen.getByLabelText('Stars (1–5)'));
    await userEvent.type(screen.getByLabelText('Stars (1–5)'), '4');
    await userEvent.click(screen.getByRole('button', { name: 'Post review' }));
    await waitFor(() => expect(calls('POST', /reviews/)).toHaveLength(1));
    expect(calls('POST', /reviews/)[0]![2]).toEqual({ body: { rating: 4, body: 'Good' } });
  });

  it('a buyer who cannot review is told why', async () => {
    renderProduct();
    expect(
      await screen.findByText(/Only buyers who received this product can review it/),
    ).toBeTruthy();
    expect(screen.queryByRole('form', { name: 'Write a review' })).toBeNull();
  });
});

const cartData = (over: object = {}) => ({
  cart: {
    groups: [
      {
        farmId: ID(10),
        farmName: 'Happy Farm',
        lines: [
          {
            productId: ID(1),
            quantity: 2,
            title: 'Dairy feed 25 kg',
            photoUrl: null,
            unit: 'bag',
            farmId: ID(10),
            farmName: 'Happy Farm',
            unitPriceMinor: 120_000,
            regularPriceMinor: 120_000,
            onSale: false,
            lineTotalMinor: 240_000,
            available: 8,
            problems: [],
          },
        ],
        itemsMinor: 240_000,
        canPickup: true,
        canDeliver: true,
      },
    ],
    itemCount: 2,
    itemsMinor: 240_000,
    hasProblems: false,
    updatedAt: '2026-01-01T00:00:00Z',
    ...over,
  },
});
const renderCart = () =>
  render(
    <MemoryRouter initialEntries={['/shop/cart']}>
      <Routes>
        <Route path="/shop/cart" element={<CartPage />} />
        <Route path="/market/orders/:id" element={<p>order page</p>} />
        <Route path="/market/orders" element={<p>orders list</p>} />
        <Route path="*" element={<p>elsewhere</p>} />
      </Routes>
    </MemoryRouter>,
  );

describe('cart and checkout', () => {
  it('pickup checkout sends exactly what the buyer saw (items and shipping per seller) and lands on the new order', async () => {
    request.mockImplementation(async (m: string, path: string) => {
      if (m === 'GET' && path === '/shop/cart') return cartData();
      if (m === 'POST' && path === '/shop/cart/checkout') return { orders: [{ id: ID(99) }] };
      return {};
    });
    renderCart();
    expect(await screen.findByText('Dairy feed 25 kg')).toBeTruthy();
    expect(screen.getByText('Shipping: Pickup — free')).toBeTruthy();
    expect(screen.getByText('Total: ฿2,400.00')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Place order' }));
    expect(await screen.findByText('order page')).toBeTruthy();
    expect(calls('POST', '/shop/cart/checkout')[0]![2]).toEqual({
      body: {
        fulfillment: 'pickup',
        expected: [{ farmId: ID(10), itemsMinor: 240_000, shippingMinor: 0 }],
      },
    });
  });

  it('delivery needs an address; shipping is looked up from the province and shown per seller; the total includes it', async () => {
    request.mockImplementation(
      async (m: string, path: string, opts?: { query?: { province?: string } }) => {
        if (m === 'GET' && path === '/shop/cart') {
          const g = cartData().cart.groups[0]!;
          return cartData(
            opts?.query?.province
              ? {
                  groups: [
                    {
                      ...g,
                      shipping: {
                        available: true,
                        shippingMinor: 15_000,
                        estimatedDays: { min: 1, max: 3 },
                        isEstimate: true,
                      },
                    },
                  ],
                }
              : {},
          );
        }
        if (m === 'POST') return { orders: [{ id: ID(99) }] };
        return {};
      },
    );
    renderCart();
    await screen.findByText('Dairy feed 25 kg');
    await userEvent.click(screen.getByLabelText('Deliver to me'));
    expect(screen.getByText(/enter your province/)).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: 'Place order' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    await userEvent.type(screen.getByLabelText('Province'), 'Bangkok');
    expect(await screen.findByText(/about 1–3 days — an estimate/)).toBeTruthy();
    expect(screen.getByText('Total: ฿2,550.00')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Place order' }));
    expect(calls('POST', '/shop/cart/checkout')).toHaveLength(0); // the address form is incomplete
    await userEvent.type(screen.getByLabelText('Recipient name'), 'Somsak Jaidee');
    await userEvent.type(screen.getByLabelText('Phone'), '+66 81 234 5678');
    await userEvent.type(screen.getByLabelText('Street address'), '99/9 Moo 3 Street');
    await userEvent.type(screen.getByLabelText('District'), 'Bang Na');
    await userEvent.type(screen.getByLabelText('Postal code'), '10260');
    await userEvent.click(screen.getByRole('button', { name: 'Place order' }));
    await waitFor(() => expect(calls('POST', '/shop/cart/checkout')).toHaveLength(1));
    const body = calls('POST', '/shop/cart/checkout')[0]![2].body;
    expect(body.expected).toEqual([{ farmId: ID(10), itemsMinor: 240_000, shippingMinor: 15_000 }]);
    expect(body.address).toMatchObject({ province: 'Bangkok', postalCode: '10260' });
  });

  it('items with problems block the checkout and say why; a seller without shipping to the province blocks delivery', async () => {
    const g = cartData().cart.groups[0]!;
    request.mockImplementation(
      async (m: string, path: string, opts?: { query?: { province?: string } }) => {
        if (m === 'GET' && path === '/shop/cart')
          return cartData({
            hasProblems: true,
            groups: [
              {
                ...g,
                lines: [{ ...g.lines[0]!, problems: ['insufficient_stock'] }],
                ...(opts?.query?.province
                  ? {
                      shipping: {
                        available: false,
                        shippingMinor: 0,
                        isEstimate: false,
                        reason: 'Dairy feed is not delivered to Khon Kaen',
                      },
                    }
                  : {}),
              },
            ],
          });
        return {};
      },
    );
    renderCart();
    expect(await screen.findByText('Not enough in stock')).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: 'Place order' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.getByText(/Fix or remove the items marked above/)).toBeTruthy();
    await userEvent.click(screen.getByLabelText('Deliver to me'));
    await userEvent.type(screen.getByLabelText('Province'), 'Khon Kaen');
    expect(
      await screen
        .findByRole('alert', { name: '' })
        .catch(() => screen.findByText(/not delivered to Khon Kaen/)),
    ).toBeTruthy();
  });

  it('a server refusal (price changed, stock gone) is shown and the cart is reloaded; quantity edits and removal go to the API', async () => {
    request.mockImplementation(async (m: string) => {
      if (m === 'GET') return cartData();
      if (m === 'POST')
        throw Object.assign(new Error('A price at Happy Farm changed: review your cart'), {});
      return {};
    });
    renderCart();
    await screen.findByText('Dairy feed 25 kg');
    await userEvent.click(screen.getByRole('button', { name: 'Place order' }));
    expect(await screen.findByText(/A price at Happy Farm changed/)).toBeTruthy();
    expect(calls('GET', '/shop/cart').length).toBeGreaterThanOrEqual(2);
    const qty = screen.getByLabelText('Quantity of Dairy feed 25 kg');
    await userEvent.clear(qty);
    await userEvent.type(qty, '4');
    expect(calls('PUT', /cart/)).toHaveLength(0); // typing alone does not save
    await userEvent.tab();
    await waitFor(() => expect(calls('PUT', `/shop/cart/items/${ID(1)}`)).toHaveLength(1));
    expect(calls('PUT', /cart/)[0]![2]).toEqual({ body: { quantity: 4 } });
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(calls('DELETE', `/shop/cart/items/${ID(1)}`)).toHaveLength(1));
  });

  it('multiple sellers: tells the buyer that separate orders are created', async () => {
    const g = cartData().cart.groups[0]!;
    request.mockImplementation(async () =>
      cartData({ groups: [g, { ...g, farmId: ID(11), farmName: 'Other Farm' }] }),
    );
    renderCart();
    expect(await screen.findByText(/2 separate orders are created/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Place orders' })).toBeTruthy();
  });

  it('an empty cart points back to the shop', async () => {
    request.mockImplementation(async () => cartData({ groups: [], itemCount: 0, itemsMinor: 0 }));
    renderCart();
    expect(await screen.findByText(/Your cart is empty/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Browse the shop' })).toBeTruthy();
  });
});

describe('seller product form', () => {
  const renderForm = (path = '/shop/sell/' + ID(10) + '/new') =>
    render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/shop/sell/:farmId/new" element={<ProductFormPage />} />
          <Route path="/shop/sell/:farmId/:id" element={<ProductFormPage />} />
          <Route path="*" element={<p>elsewhere</p>} />
        </Routes>
      </MemoryRouter>,
    );
  it('converts baht to satang, builds shipping and sends only valid data; closed categories cannot be chosen', async () => {
    request.mockImplementation(async (m: string, path: string) => {
      if (path === '/shop/categories') return { categories };
      if (m === 'POST') return { product: product({ id: ID(77), status: 'DRAFT' }) };
      return {};
    });
    renderForm();
    await screen.findByRole('option', { name: 'Animal feed' });
    const med = screen.getByRole('option', { name: /Veterinary medicines/ }) as HTMLOptionElement;
    expect(med.disabled).toBe(true);
    await userEvent.selectOptions(screen.getByLabelText('Category'), 'feed');
    await userEvent.type(screen.getByLabelText('Title'), 'Dairy feed');
    await userEvent.type(screen.getByLabelText('Price per unit (฿)'), 'abc');
    await userEvent.click(screen.getByRole('button', { name: 'Create product' }));
    expect(await screen.findByText(/Enter an amount like 450/)).toBeTruthy();
    expect(calls('POST', /products/)).toHaveLength(0);
    await userEvent.clear(screen.getByLabelText('Price per unit (฿)'));
    await userEvent.type(screen.getByLabelText('Price per unit (฿)'), '1200.50');
    await userEvent.clear(screen.getByLabelText('Units in stock'));
    await userEvent.type(screen.getByLabelText('Units in stock'), '25');
    await userEvent.type(
      screen.getByLabelText('Photo 1 link (https)'),
      'https://cdn.example.test/p.jpg',
    );
    await userEvent.click(screen.getByLabelText('I deliver'));
    await userEvent.type(screen.getByLabelText('Province 1'), 'Bangkok');
    await userEvent.type(screen.getByLabelText('Price 1 (฿)'), '150');
    await userEvent.click(screen.getByRole('button', { name: 'Create product' }));
    await waitFor(() => expect(calls('POST', `/farms/${ID(10)}/products`)).toHaveLength(1));
    expect(calls('POST', /products/)[0]![2].body).toMatchObject({
      categoryKey: 'feed',
      title: 'Dairy feed',
      priceMinor: 120_050,
      stock: 25,
      photos: [{ url: 'https://cdn.example.test/p.jpg' }],
      deliveryOptions: ['pickup', 'delivery'],
      shipping: {
        mode: 'by_province',
        provinces: [{ province: 'Bangkok', priceMinor: 15_000 }],
        requirements: [],
      },
    });
  });

  it('regulated categories ask for the registration number', async () => {
    request.mockImplementation(async (_m: string, path: string) =>
      path === '/shop/categories'
        ? { categories: categories.map((c) => ({ ...c, salesEnabled: true })) }
        : {},
    );
    renderForm();
    await screen.findByRole('option', { name: 'Animal feed' });
    expect(screen.queryByLabelText('Registration / licence number')).toBeNull();
    await userEvent.selectOptions(screen.getByLabelText('Category'), 'medicines');
    expect(screen.getByLabelText('Registration / licence number')).toBeTruthy();
  });

  it('editing shows the stock panel and sends stock changes with a reason', async () => {
    const p = product({
      status: 'DRAFT',
      inventory: { stock: 10, reserved: 2, lowStockThreshold: null },
    });
    request.mockImplementation(async (m: string, path: string) => {
      if (path === '/shop/categories') return { categories };
      if (m === 'GET' && path === `/farms/${ID(10)}/products/${p.id}`)
        return {
          product: p,
          events: [{ at: '2026-01-01T00:00:00Z', type: 'created', from: null, to: 'DRAFT' }],
        };
      if (path.endsWith('/movements')) return { items: [] };
      return { product: p, events: [] };
    });
    renderForm(`/shop/sell/${ID(10)}/${p.id}`);
    expect(await screen.findByText(/held by unpaid orders/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Submit for review' })).toBeTruthy();
    await userEvent.type(screen.getByLabelText(/Change \(e\.g\./), '5');
    await userEvent.click(screen.getByRole('button', { name: 'Update stock' }));
    expect(await screen.findByText(/Give a reason/)).toBeTruthy();
    expect(calls('POST', /stock/)).toHaveLength(0);
    await userEvent.type(screen.getByLabelText('Reason'), 'Delivery from supplier');
    await userEvent.click(screen.getByRole('button', { name: 'Update stock' }));
    await waitFor(() => expect(calls('POST', /stock/)).toHaveLength(1));
    expect(calls('POST', /stock/)[0]![2]).toEqual({
      body: { delta: 5, reason: 'Delivery from supplier' },
    });
  });
});

describe('admin: products', () => {
  const pending = product({
    status: 'PENDING_REVIEW',
    review: {
      submittedAt: '2026-01-01T00:00:00Z',
      approvedAt: null,
      rejectedReason: null,
      suspendedReason: null,
    },
  });
  it('approves from the queue; rejection needs a reason', async () => {
    request.mockImplementation(async (m: string, path: string) => {
      if (path === '/shop/categories') return { categories };
      if (m === 'GET') return { items: [pending], total: 1, page: 1, pageSize: 10 };
      return {};
    });
    render(
      <MemoryRouter>
        <ProductsAdminPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText('Dairy feed 25 kg')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Reject' }));
    const dialog = document.querySelector('dialog[open]') as HTMLElement;
    const reject = within(dialog).getByRole('button', {
      name: 'Reject',
      hidden: true,
    }) as HTMLButtonElement;
    expect(reject.disabled).toBe(true);
    await userEvent.type(
      within(dialog).getByLabelText(/Reason/, { selector: 'textarea' }),
      'Photos do not show the product',
    );
    await userEvent.click(reject);
    await waitFor(() => expect(calls('POST', /reject/)).toHaveLength(1));
    expect(calls('POST', /reject/)[0]![2]).toEqual({
      body: { reason: 'Photos do not show the product' },
    });
  });

  it('opening a regulated category needs the review reference, a reason and the typed phrase', async () => {
    request.mockImplementation(async (m: string, path: string) => {
      if (path === '/shop/categories') return { categories };
      if (m === 'GET') return { items: [], total: 0, page: 1, pageSize: 10 };
      return {};
    });
    render(
      <MemoryRouter>
        <ProductsAdminPage />
      </MemoryRouter>,
    );
    const row = (await screen.findByText(/Veterinary medicines/)).closest('tr')!;
    await userEvent.click(within(row).getByRole('button', { name: 'Open sales' }));
    const dialog = document.querySelector('dialog[open]') as HTMLElement;
    const go = within(dialog).getByRole('button', {
      name: 'Open sales',
      hidden: true,
    }) as HTMLButtonElement;
    expect(go.disabled).toBe(true);
    await userEvent.type(
      within(dialog).getByLabelText(/Reference of the compliance review/),
      'LEGAL-2026-014',
    );
    await userEvent.type(
      within(dialog).getByLabelText(/Reason/, { selector: 'textarea' }),
      'Reviewed with counsel',
    );
    expect(go.disabled).toBe(true); // still needs the phrase
    await userEvent.type(within(dialog).getByLabelText(/Type/), 'ENABLE medicines');
    expect(go.disabled).toBe(false);
    await userEvent.click(go);
    await waitFor(() =>
      expect(calls('POST', '/shop/admin/categories/medicines/sales')).toHaveLength(1),
    );
    expect(calls('POST', /sales/)[0]![2]).toEqual({
      body: {
        enabled: true,
        reason: 'Reviewed with counsel',
        confirmation: 'ENABLE medicines',
        complianceReference: 'LEGAL-2026-014',
      },
    });
  });
});

describe('shop in Thai', () => {
  beforeEach(() => setLocale('th'));

  it('shows the browse page in Thai (sort options, badges, cart) and switches to English without a reload', async () => {
    request.mockImplementation(async (_m: string, path: string) => {
      if (path === '/shop/categories') return { categories };
      if (path === '/shop/cart') return { cart: { itemCount: 3 } };
      return {
        items: [
          product({ onSale: true, effectivePriceMinor: 90_000 }),
          product({ id: ID(2), title: 'Sold out feed', inStock: false, available: 0 }),
        ],
        total: 2,
        page: 1,
        pageSize: 12,
      };
    });
    render(
      <MemoryRouter>
        <ShopBrowsePage />
      </MemoryRouter>,
    );
    expect(await screen.findByText('Dairy feed 25 kg')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'ร้านค้า' })).toBeTruthy();
    expect(screen.getByText('ตะกร้า (3)')).toBeTruthy();
    expect(screen.getByText('สินค้าหมด')).toBeTruthy();
    expect(screen.getByText('ลดราคา')).toBeTruthy();
    const sorts = within(screen.getByLabelText('เรียงตาม'))
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(sorts).toEqual([
      'ใหม่ล่าสุด',
      'ราคา: ต่ำไปสูง',
      'ราคา: สูงไปต่ำ',
      'คะแนนสูงสุด',
      'ขายดีที่สุด',
    ]);
    await userEvent.type(screen.getByLabelText('ราคาต่ำสุด (฿)'), 'abc');
    await userEvent.click(screen.getByRole('button', { name: 'ค้นหา' }));
    expect(await screen.findByText('กรอกราคาเป็นตัวเลข เช่น 500 หรือ 500.50')).toBeTruthy();

    act(() => setLocale('en'));
    expect(screen.getByRole('heading', { name: 'Shop' })).toBeTruthy();
    expect(screen.getByText('Cart (3)')).toBeTruthy();
    expect(screen.getByText(/Enter prices as numbers/)).toBeTruthy(); // the shown error follows too
    expect(screen.getByRole('option', { name: 'Price: low to high' })).toBeTruthy();
  });

  it('shows the product page status, delivery options and add-to-cart in Thai', async () => {
    renderProduct(product({ status: 'PAUSED' }));
    expect(await screen.findByText('หยุดขายชั่วคราว')).toBeTruthy();
    expect(screen.getByText(/สินค้านี้ไม่ได้วางขาย/)).toBeTruthy();
    expect(screen.getByText('รับสินค้าเอง')).toBeTruthy();
    expect(screen.getByText('จัดส่ง')).toBeTruthy();
    expect(screen.getByText(/ขายโดย Happy Farm/)).toBeTruthy();
    expect(screen.getByText('เฉพาะผู้ซื้อที่ได้รับสินค้านี้แล้วเท่านั้นที่รีวิวได้')).toBeTruthy();
  });
});
