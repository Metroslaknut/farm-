import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const request = vi.hoisted(() => vi.fn());
vi.mock('../src/api', () => ({ api: { request } }));

import PedigreePage from '../src/pages/farms/records/PedigreePage';
import TradesPage from '../src/pages/farms/TradesPage';

type Opts = { query?: Record<string, unknown>; body?: unknown };
function mockApi(handlers: Record<string, (opts?: Opts) => unknown>) {
  request.mockImplementation(async (method: string, path: string, opts?: Opts) => {
    // The animal-type catalog (Thai names for the trades table).
    if (method === 'GET' && path === '/animal-types' && !handlers[`${method} ${path}`])
      return { animalTypes: [] };
    const handler = handlers[`${method} ${path}`];
    if (!handler) throw new Error(`unexpected request ${method} ${path}`);
    return handler(opts);
  });
}
beforeEach(() => {
  request.mockReset();
});

const renderAt = (path: string, route: string, element: React.ReactNode) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={route} element={element} />
      </Routes>
    </MemoryRouter>,
  );

const pa = (id: string, code: string, sex: string, over: object = {}) => ({
  id,
  animalCode: code,
  sex,
  currentStatus: 'active',
  archived: false,
  ...over,
});

describe('pedigree page', () => {
  it('draws the family tree with unknown parents, siblings and offspring; generations are adjustable', async () => {
    const lineage = vi.fn((opts?: Opts) => ({
      animal: { id: 'c', animalCode: 'CALF' },
      offspring: [{ id: 'g', animalCode: 'GRAND', sex: 'male', role: 'dam' }],
      generations: Number(opts?.query?.['generations']),
      generation: 2,
      pedigree: {
        animal: pa('c', 'CALF', 'female'),
        sire: {
          animal: pa('s', 'SIRE', 'male', { name: 'Big Boy' }),
          sire: { animal: pa('gs', 'GSIRE', 'male', { archived: true }) },
        },
        dam: { animal: pa('d', 'DAM', 'female', { currentStatus: 'for_sale' }) },
      },
      siblings: [
        { ...pa('f', 'FULL', 'male'), relation: 'full' },
        { ...pa('h', 'HALF', 'male'), relation: 'half_sire' },
      ],
    }));
    mockApi({ 'GET /farms/f1/animals/c/lineage': lineage });
    const user = userEvent.setup();
    renderAt(
      '/farms/f1/animals/c/lineage',
      '/farms/:farmId/animals/:animalId/lineage',
      <PedigreePage />,
    );
    expect(await screen.findByText('2 generations of ancestors recorded')).toBeTruthy();
    expect(lineage.mock.calls[0]![0]!.query).toEqual({ generations: '3' });
    expect(screen.getByRole('link', { name: 'SIRE — Big Boy' }).getAttribute('href')).toBe(
      '/farms/f1/animals/s',
    );
    expect(screen.getByRole('link', { name: 'GSIRE' })).toBeTruthy();
    // Missing ancestors are shown as unknown, never invented.
    expect(screen.getAllByText('Unknown').length).toBe(1); // the sire's dam; branches with no recorded parent are not expanded
    expect(screen.getAllByText('Same parents').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Same sire').length).toBeGreaterThan(0);
    expect(screen.getAllByText('as Dam').length).toBeGreaterThan(0);

    await user.selectOptions(screen.getByLabelText('Generations shown'), '5');
    await vi.waitFor(() => expect(lineage).toHaveBeenCalledTimes(2));
    expect(lineage.mock.calls[1]![0]!.query).toEqual({ generations: '5' });
  });

  it('says when no parents are recorded', async () => {
    mockApi({
      'GET /farms/f1/animals/c/lineage': () => ({
        animal: { id: 'c', animalCode: 'LONE' },
        offspring: [],
        generations: 3,
        generation: 0,
        pedigree: { animal: pa('c', 'LONE', 'male') },
        siblings: [],
      }),
    });
    renderAt(
      '/farms/f1/animals/c/lineage',
      '/farms/:farmId/animals/:animalId/lineage',
      <PedigreePage />,
    );
    expect(await screen.findByText('No parents recorded for this animal yet.')).toBeTruthy();
    expect(screen.queryByText('Unknown')).toBeNull();
  });
});

const farm = (permissions: string[]) => ({
  farm: {
    id: 'f1',
    name: 'Trade Farm',
    status: 'active',
    location: {},
    contact: {},
    animalTypeIds: [],
    myRole: 'owner',
    createdAt: '2026-01-01T00:00:00Z',
    access: { via: 'member', permissions },
    stats: { animalsTotal: 0, animalsActive: 0, byStatus: {} },
  },
});
const listing = (id: string, status: string, over: object = {}) => ({
  id,
  farmId: 'f1',
  animalId: `a-${id}`,
  title: `Listing ${id}`,
  status,
  askingPriceMinor: 4_000_000,
  animal: {
    animalTypeId: 't',
    animalTypeName: 'Buffalo',
    sex: 'female',
    birthDateEstimated: false,
  },
  createdAt: '2026-10-01T00:00:00Z',
  ...over,
});
const order = (id: string, kind: string, status: string) => ({
  id,
  kind,
  orderNo: `FP-${id}`,
  status,
  buyer: { id: 'b', displayName: 'Buyer Name' },
  items: [{ title: `Item ${id}` }],
  totals: { itemsMinor: 3_500_000 },
  paidAt: status === 'PAID' ? '2026-10-05T00:00:00Z' : null,
});

describe('trades page', () => {
  it('is for owners and managers only', async () => {
    mockApi({ 'GET /farms/f1': () => farm(['farm.read', 'animals.read']) });
    renderAt('/farms/f1/trades', '/farms/:farmId/trades', <TradesPage />);
    expect(
      await screen.findByText('Selling information is for the farm’s owners and managers.'),
    ).toBeTruthy();
    // Only the farm (for the permission check) and the shared animal-type names: no selling data.
    expect(request.mock.calls.every((c) => ['/farms/f1', '/animal-types'].includes(c[1]))).toBe(
      true,
    );
  });

  it('shows counts, listings (filterable, with the real sale price) and animal orders with payment state', async () => {
    const listings = vi.fn((opts?: Opts) =>
      opts?.query?.['cursor']
        ? { items: [listing('l3', 'CANCELLED')] }
        : opts?.query?.['status'] === 'SOLD'
          ? {
              items: [
                listing('l2', 'SOLD', {
                  soldAt: '2026-10-20T00:00:00Z',
                  reservation: { amountMinor: 3_500_000 },
                }),
              ],
            }
          : {
              items: [
                listing('l1', 'ACTIVE'),
                listing('l2', 'SOLD', {
                  soldAt: '2026-10-20T00:00:00Z',
                  reservation: { amountMinor: 3_500_000 },
                }),
              ],
              nextCursor: 'c2',
            },
    );
    mockApi({
      'GET /farms/f1': () => farm(['farm.read', 'listings.manage']),
      'GET /farms/f1/summary': () => ({
        totals: {},
        byType: [],
        growthCheckDays: 30,
        trade: { listingsByStatus: { ACTIVE: 1, SOLD: 1 }, listingsTotal: 3, animalOrders: 1 },
      }),
      'GET /farms/f1/listings': listings,
      'GET /farms/f1/orders': () => ({
        items: [order('o1', 'animal', 'PAID'), order('o2', 'product', 'PAID')],
      }),
    });
    const user = userEvent.setup();
    renderAt('/farms/f1/trades', '/farms/:farmId/trades', <TradesPage />);
    const listingTable = await screen.findByRole('table', { name: 'Listings' });
    expect((await within(listingTable).findAllByText('Listing l1')).length).toBeGreaterThan(0);
    expect(within(listingTable).getAllByText('฿35,000.00').length).toBeGreaterThan(0);
    const orderTable = await screen.findByRole('table', { name: 'Sales history (orders)' });
    expect((await within(orderTable).findAllByText('FP-o1')).length).toBeGreaterThan(0);
    expect(within(orderTable).queryByText('FP-o2')).toBeNull(); // product orders are not animal trades
    expect(within(orderTable).getAllByText('Buyer Name').length).toBeGreaterThan(0);
    expect(within(orderTable).getAllByText('Paid').length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: 'Load more' }));
    expect((await screen.findAllByText('Listing l3')).length).toBeGreaterThan(0);
    expect(listings.mock.calls.at(-1)![0]!.query).toMatchObject({ cursor: 'c2' });

    await user.selectOptions(screen.getByLabelText('Listing status'), 'SOLD');
    await vi.waitFor(() =>
      expect(listings.mock.calls.at(-1)![0]!.query).toMatchObject({ status: 'SOLD' }),
    );
    await vi.waitFor(() => expect(screen.queryAllByText('Listing l1')).toEqual([]));
  });
});
