import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const request = vi.hoisted(() => vi.fn());
vi.mock('../src/api', () => ({ api: { request } }));

import { setLocale } from '../src/i18n';
import NotFoundPage from '../src/pages/NotFoundPage';
import FarmFormPage from '../src/pages/farms/FarmFormPage';
import GrowthPage from '../src/pages/farms/records/GrowthPage';
import { HistoryList } from '../src/pages/farms/records/RecordHistoryPanel';
import { KINDS } from '../src/pages/farms/records/recordConfigs';
import MarketBrowsePage from '../src/pages/market/BrowsePage';
import { ListingCard } from '../src/pages/market/common';
import { ListingForm } from '../src/pages/market/ListingForm';
import ShopBrowsePage from '../src/pages/shop/BrowsePage';
import UploadPage from '../src/pages/videos/UploadPage';

/**
 * Regression tests for the staging QA findings of 2026-11-22 (docs/qa/fix-prompt-staging-qa-2026-11-22.md).
 */
const T1 = '111111111111111111111111';
const TYPES = [
  {
    id: T1,
    key: 'rabbit',
    name: 'Rabbit',
    nameTh: 'กระต่าย',
    status: 'active',
    breeds: [{ key: 'netherland_dwarf', name: 'Netherland dwarf', nameTh: 'เนเธอร์แลนด์ดวาร์ฟ' }],
  },
];

type Handler = (opts?: { query?: Record<string, unknown>; body?: unknown }) => unknown;
function mockApi(handlers: Record<string, Handler>) {
  request.mockImplementation(async (method: string, path: string, opts?: { body?: unknown }) => {
    const handler = handlers[`${method} ${path}`];
    if (!handler) throw new Error(`unexpected request ${method} ${path}`);
    return handler(opts);
  });
}

beforeEach(() => {
  request.mockReset();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: false })),
  );
});
afterEach(() => setLocale('en'));

const at = (path: string, routes: React.ReactNode) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        {routes}
        <Route path="*" element={<p>navigated elsewhere</p>} />
      </Routes>
    </MemoryRouter>,
  );

describe('growth: weights keep the precision they were recorded with', () => {
  it('shows 1.85 kg and a 0.25 kg change (not 1.9 / 0.3)', async () => {
    const point = (id: string, date: string, weightKg: number, changeKg?: number) => ({
      id,
      date,
      weightKg,
      ...(changeKg !== undefined ? { changeKg, gainKgPerDay: 0.025 } : {}),
      evaluation: { status: 'no_standard', metrics: {} },
    });
    mockApi({
      'GET /farms/f1': () => ({
        farm: { id: 'f1', status: 'active', access: { permissions: ['records.read'] } },
      }),
      'GET /farms/f1/animals/a1/growth': () => ({
        animal: { id: 'a1', animalCode: 'R-1', sex: 'female', animalType: TYPES[0] },
        age: { estimated: false },
        points: [point('w1', '2026-09-01', 1.6), point('w2', '2026-09-11', 1.85, 0.25)],
        standards: [],
        alerts: [],
        windows: {},
        maxWeightKg: null,
        summary: {
          count: 2,
          firstKg: 1.6,
          firstDate: '2026-09-01',
          latestKg: 1.85,
          latestDate: '2026-09-11',
          totalChangeKg: 0.25,
          averageGainKgPerDay: 0.025,
        },
      }),
    });
    at(
      '/farms/f1/animals/a1/growth',
      <Route path="/farms/:farmId/animals/:animalId/growth" element={<GrowthPage />} />,
    );
    const table = await screen.findByRole('table');
    expect(within(table).getAllByText('1.85').length).toBeGreaterThan(0);
    expect(within(table).getAllByText('0.25').length).toBeGreaterThan(0);
    expect(within(table).queryByText('1.9')).toBeNull();
    expect(screen.getAllByText(/^1\.85 kg ·/).length).toBeGreaterThan(0); // summary: latest weight
    expect(screen.getByText('0.25 kg')).toBeTruthy(); // summary: total change
  });
});

describe('record history: field names and values like the form', () => {
  const expenses = KINDS.expenses;
  const entry = (changes: { field: string; from: unknown; to: unknown }[]) => ({
    at: '2026-11-20T03:00:00.000Z',
    by: { id: 'u1', displayName: 'Somchai' },
    kind: 'correction' as const,
    reason: 'typo',
    changes,
  });

  it('shows labels, baht, enum options, dates and nested groups; unknown fields keep their name', () => {
    render(
      <HistoryList
        config={expenses}
        history={[
          entry([
            { field: 'amount', from: 123.45, to: 150 },
            { field: 'category', from: 'feed', to: 'veterinary' },
            { field: 'expenseDate', from: '2026-11-01', to: '2026-11-02' },
            { field: 'quantity', from: null, to: { amount: 2.5, unit: 'kg' } },
            { field: 'somethingNew', from: 'a', to: 'b' },
          ]),
        ]}
      />,
    );
    const items = screen.getAllByRole('listitem').map((li) => li.textContent ?? '');
    const line = (start: string) => items.find((t) => t.startsWith(start));
    expect(line('Amount (THB):')).toBe('Amount (THB): ฿123.45 → ฿150.00');
    expect(line('Category:')).toMatch(/^Category: Feed → Veterinary/);
    expect(line('Date:')).toMatch(/^Date: 1 Nov 2026 → 2 Nov 2026/);
    expect(line('Quantity bought')).toBeUndefined(); // nested: under the group's own line
    expect(items.some((t) => /quantity: — → Quantity bought.*: 2\.5, Unit: kg/i.test(t))).toBe(
      true,
    );
    expect(line('somethingNew:')).toBe('somethingNew: a → b');
    expect(screen.queryByText('amount')).toBeNull();
  });

  it('formats expense amounts as ฿ in lists and details', () => {
    const t = ((k: string) => k) as never;
    const fmt = { date: (v: string | null | undefined) => v ?? '' };
    const amountColumn = expenses.columns.find((c) => c.header === 'rec.expense.amountThb')!;
    expect(amountColumn.cell({ amount: 150 }, t, fmt)).toBe('฿150.00');
    const rows = expenses.describe(
      { amount: 1234.5, currency: 'THB', category: 'feed', expenseDate: '2026-11-01' },
      t,
      fmt,
    );
    expect(rows.find(([k]) => k === 'rec.expense.amount')![1]).toBe('฿1,234.50');
  });
});

describe('Thai names in the market and the shop', () => {
  const listing = {
    id: 'l1',
    farmId: 'f1',
    title: 'Rabbit for sale',
    status: 'ACTIVE',
    askingPriceMinor: 150000,
    photos: [],
    location: { province: 'ขอนแก่น' },
    animal: {
      animalTypeId: T1,
      animalTypeName: 'Other animals',
      breed: 'netherland_dwarf',
      sex: 'female',
      birthDateEstimated: false,
    },
  };

  it('a listing card shows the type and breed from the catalog in Thai, the snapshot otherwise', async () => {
    setLocale('th');
    mockApi({ 'GET /animal-types': () => ({ animalTypes: TYPES }) });
    const { unmount } = render(
      <MemoryRouter>
        <ListingCard listing={listing as never} to="/market/listing/l1" />
      </MemoryRouter>,
    );
    expect(await screen.findByText(/กระต่าย · เนเธอร์แลนด์ดวาร์ฟ/)).toBeTruthy();
    unmount();
    // A type no longer in the catalog: the snapshot (and humanized breed key) is the fallback.
    render(
      <MemoryRouter>
        <ListingCard
          listing={{ ...listing, animal: { ...listing.animal, animalTypeId: 'gone' } } as never}
          to="/market/listing/l1"
        />
      </MemoryRouter>,
    );
    expect(await screen.findByText(/Other animals · Netherland dwarf/)).toBeTruthy();
  });

  it('the market animal-type filter uses the Thai name', async () => {
    setLocale('th');
    mockApi({
      'GET /animal-types': () => ({ animalTypes: TYPES }),
      'GET /marketplace/listings': () => ({ items: [], total: 0, page: 1, pageSize: 24 }),
    });
    at('/market', <Route path="/market" element={<MarketBrowsePage />} />);
    expect(await screen.findByLabelText('กระต่าย')).toBeTruthy();
    expect(screen.queryByLabelText('Rabbit')).toBeNull();
  });

  const shopApi = () =>
    request.mockImplementation(async (_m: string, path: string) =>
      path === '/shop/categories'
        ? {
            categories: [
              { key: 'feed', name: 'Animal feed', nameTh: 'อาหารสัตว์', salesEnabled: true },
              { key: 'custom_x', name: 'Custom category', salesEnabled: true },
            ],
          }
        : {
            items: [
              {
                id: 'p1',
                farmId: 'f1',
                farmName: 'Happy Farm',
                seller: { id: 'u2', displayName: 'Somchai' },
                categoryKey: 'feed',
                categoryName: 'Animal feed',
                categoryNameTh: 'อาหารสัตว์',
                title: 'Layer pellets',
                brand: null,
                status: 'ACTIVE',
                currency: 'THB',
                priceMinor: 25_000,
                promotion: null,
                effectivePriceMinor: 25_000,
                onSale: false,
                specs: [],
                photos: [],
                deliveryOptions: ['pickup'],
                minOrderQty: 1,
                maxOrderQty: null,
                available: 5,
                inStock: true,
                regulatory: null,
                rating: { average: 0, count: 0 },
                soldCount: 0,
                viewer: { isSellerSide: false },
              },
            ],
            total: 1,
            page: 1,
            pageSize: 24,
          },
    );

  it("the shop shows a category's Thai name (nameTh) in Thai mode, its name otherwise", async () => {
    setLocale('th');
    shopApi();
    at('/shop', <Route path="/shop" element={<ShopBrowsePage />} />);
    expect(await screen.findByLabelText('อาหารสัตว์')).toBeTruthy();
    expect(screen.getByLabelText('Custom category')).toBeTruthy(); // no nameTh: falls back
    expect(screen.queryByLabelText('Animal feed')).toBeNull();
    expect(screen.getByText(/อาหารสัตว์ · Happy Farm/)).toBeTruthy(); // product card
  });

  it('the shop shows the English names in English mode', async () => {
    shopApi();
    at('/shop', <Route path="/shop" element={<ShopBrowsePage />} />);
    expect(await screen.findByLabelText('Animal feed')).toBeTruthy();
    expect(screen.queryByLabelText('อาหารสัตว์')).toBeNull();
    expect(screen.getByText(/Animal feed · Happy Farm/)).toBeTruthy();
  });
});

describe('farm settings', () => {
  const farm = (permissions: string[], status = 'active') => ({
    farm: {
      id: 'f1',
      name: 'Happy Farm',
      status,
      location: {},
      contact: {},
      animalTypeIds: [],
      myRole: 'owner',
      createdAt: '2026-01-01T00:00:00Z',
      access: { via: 'member', permissions },
    },
  });

  it('the owner archives the farm after confirming, then lands on the farm', async () => {
    const archived = vi.fn(() => farm(['farm.read'], 'archived'));
    mockApi({
      'GET /animal-types': () => ({ animalTypes: TYPES }),
      'GET /farms/f1': () => farm(['farm.read', 'farm.update', 'farm.archive']),
      'POST /farms/f1/archive': archived,
    });
    const user = userEvent.setup();
    at(
      '/farms/f1/edit',
      <>
        <Route path="/farms/:farmId/edit" element={<FarmFormPage />} />
        <Route path="/farms/:farmId" element={<p>farm home</p>} />
      </>,
    );
    await user.click(await screen.findByRole('button', { name: 'Archive farm' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/until it is restored/)).toBeTruthy();
    expect(archived).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Archive farm' }));
    expect(await screen.findByText('farm home')).toBeTruthy();
    expect(archived).toHaveBeenCalledTimes(1);
  });

  it('managers (no farm.archive) get no archive button; an archived farm offers restore', async () => {
    mockApi({
      'GET /animal-types': () => ({ animalTypes: TYPES }),
      'GET /farms/f1': () => farm(['farm.read', 'farm.update']),
    });
    const { unmount } = at(
      '/farms/f1/edit',
      <Route path="/farms/:farmId/edit" element={<FarmFormPage />} />,
    );
    await screen.findByDisplayValue('Happy Farm');
    expect(screen.queryByRole('button', { name: 'Archive farm' })).toBeNull();
    unmount();

    const restored = vi.fn(() => farm(['farm.read', 'farm.archive']));
    mockApi({
      'GET /animal-types': () => ({ animalTypes: TYPES }),
      'GET /farms/f1': () => farm(['farm.read', 'farm.archive'], 'archived'),
      'POST /farms/f1/restore': restored,
    });
    const user = userEvent.setup();
    at('/farms/f1/edit', <Route path="/farms/:farmId/edit" element={<FarmFormPage />} />);
    expect(await screen.findByText('This farm is archived and read-only.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Restore farm' }));
    expect(await screen.findByText('Farm restored')).toBeTruthy();
    expect(restored).toHaveBeenCalledTimes(1);
  });

  it('setup steps are numbered once (by the badge, not also by the list)', async () => {
    mockApi({ 'GET /animal-types': () => ({ animalTypes: TYPES }) });
    at('/farms/new', <Route path="/farms/new" element={<FarmFormPage />} />);
    const steps = await screen.findByRole('list', { name: /Step 1 of 3/ });
    expect(steps.style.listStyle).toBe('none');
    expect(within(steps).getAllByRole('listitem')[0]!.textContent).toBe('1. Farm profile');
  });
});

describe('telling people before they fill in a form', () => {
  it('a non-seller sees why a new listing cannot be saved, and Save is disabled', async () => {
    mockApi({
      'GET /marketplace/sell-eligibility': () => ({ canSell: false, reason: 'SELLER_REQUIRED' }),
      'GET /farms/f2/animals': () => ({ items: [] }),
    });
    render(
      <MemoryRouter>
        <ListingForm farmId="f2" onSaved={() => undefined} />
      </MemoryRouter>,
    );
    expect(await screen.findByText(/Only approved sellers can list animals/)).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: 'Save as draft' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('a seller gets the form as before', async () => {
    mockApi({
      'GET /marketplace/sell-eligibility': () => ({ canSell: true }),
      'GET /farms/f3/animals': () => ({ items: [] }),
    });
    render(
      <MemoryRouter>
        <ListingForm farmId="f3" onSaved={() => undefined} />
      </MemoryRouter>,
    );
    await waitFor(() =>
      expect(request.mock.calls.some((c) => c[1] === '/marketplace/sell-eligibility')).toBe(true),
    );
    expect(screen.queryByText(/Only approved sellers/)).toBeNull();
    expect(
      (screen.getByRole('button', { name: 'Save as draft' }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it('video upload says it is not available instead of showing the form (VIDEO_PROVIDER=none)', async () => {
    mockApi({
      'GET /videos/limits': () => ({
        maxUploadBytes: 1000,
        maxDurationSeconds: 60,
        mimeTypes: ['video/mp4'],
        provider: 'none',
      }),
    });
    render(
      <MemoryRouter>
        <UploadPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText(/Video uploads are not available yet/)).toBeTruthy();
    expect(screen.queryByLabelText('Video file')).toBeNull();
  });
});

describe('unknown pages', () => {
  it('says the page was not found, with a link home, in Thai and English', () => {
    const { unmount } = render(
      <MemoryRouter>
        <NotFoundPage />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Page not found' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Back to the home page' }).getAttribute('href')).toBe(
      '/',
    );
    unmount();
    setLocale('th');
    render(
      <MemoryRouter>
        <NotFoundPage />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'ไม่พบหน้านี้' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'กลับหน้าแรก' })).toBeTruthy();
  });
});
