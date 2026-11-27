import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const request = vi.hoisted(() => vi.fn());
const download = vi.hoisted(() => vi.fn());
vi.mock('../src/api', () => ({ api: { request, download } }));

import { formatBaht, formatMetric } from '../src/components/analytics/format';
import FarmDashboardPage from '../src/pages/farms/FarmDashboardPage';
import AnalyticsPage from '../src/pages/admin/analytics';

const def = (key: string, label: string, unit: string, extra: object = {}) => ({
  key,
  scope: key.split('.')[0],
  section: key.split('.')[1],
  label,
  unit,
  definition: `${label} means something precise.`,
  formula: 'sum(x)',
  includes: 'things',
  excludes: 'other things',
  source: 'orders',
  caveats: null,
  timeBasis: 'range',
  ...extra,
});
const meta = {
  generatedAt: '2026-06-15T05:00:00.000Z',
  cached: false,
  cacheTtlSeconds: 60,
  from: '2026-05-17',
  to: '2026-06-15',
  granularity: 'day',
  timezone: 'Asia/Bangkok',
  filters: {},
};
const farmDashboard = {
  meta,
  sections: {
    animals: {
      available: true,
      metrics: { animalsOnFarm: 5 },
      tables: {
        byTypeAndStatus: { columns: ['Animal type', 'Total'], rows: [['Buffalo', 4]] },
      },
      series: {},
    },
    costs: {
      available: false,
      reason: 'Needs permission to read costs.',
      metrics: {},
      tables: {},
      series: {},
    },
    sales: {
      available: true,
      metrics: { grossSalesMinor: 9_600_000, platformCommissionMinor: 480_000 },
      tables: {},
      series: { grossSales: [{ period: '2026-06-01', value: 9_600_000 }] },
      notes: ['Estimated net proceeds are not profit.'],
    },
  },
  definitions: {
    'farm.animals.animalsOnFarm': def('farm.animals.animalsOnFarm', 'Animals on the farm', 'count'),
    'farm.sales.grossSalesMinor': def('farm.sales.grossSalesMinor', 'Gross sales', 'minor_thb', {
      excludes: 'refunded orders',
    }),
    'farm.sales.platformCommissionMinor': def(
      'farm.sales.platformCommissionMinor',
      'Platform commission',
      'minor_thb',
    ),
  },
};

function renderFarm(path = '/farms/f1/dashboard') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/farms/:farmId/dashboard" element={<FarmDashboardPage />} />
      </Routes>
    </MemoryRouter>,
  );
}
const calls = (re: RegExp) => request.mock.calls.filter((c) => re.test(String(c[1])));

beforeEach(() => {
  request.mockReset();
  download.mockReset();
  request.mockImplementation((_m: string, path: string) => {
    if (path === '/animal-types')
      return Promise.resolve({ animalTypes: [{ id: 'a', key: 'buffalo', name: 'Buffalo' }] });
    if (/\/dashboard$/.test(path)) return Promise.resolve(farmDashboard);
    if (path === '/farms/f1')
      return Promise.resolve({ farm: { name: 'Happy Farm', access: { permissions: [] } } });
    if (path === '/admin/analytics')
      return Promise.resolve({
        ...farmDashboard,
        definitions: {},
        sections: {
          users: { available: true, metrics: { totalUsers: 7 }, tables: {}, series: {} },
          orders: {
            available: false,
            reason: 'Financial figures need the payments permission.',
            metrics: {},
            tables: {},
            series: {},
          },
        },
      });
    return Promise.reject(new Error(`unexpected ${path}`));
  });
});
afterEach(cleanup);

describe('formatting', () => {
  it('shows money in baht, never raw satang, and gaps as a dash', () => {
    expect(formatBaht(9_600_000)).toBe('฿96,000.00');
    expect(formatMetric(480_000, 'minor_thb')).toBe('฿4,800.00');
    expect(formatMetric(null, 'minor_thb')).toBe('—');
    expect(formatMetric(12.5, 'percent')).toBe('12.5%');
    expect(formatMetric(1000, 'g_per_day')).toBe('1,000 g/day');
  });
});

describe('farm dashboard page', () => {
  it('shows each metric with its label and formatted value, the tables, and what is unavailable and why', async () => {
    renderFarm();
    const animals = await screen.findByRole('region', { name: 'Animals' });
    expect(within(animals).getAllByText('Animals on the farm').length).toBeGreaterThan(0);
    expect(within(animals).getByText('5')).toBeTruthy();
    expect(within(animals).getByRole('table', { name: 'By type and status' })).toBeTruthy();
    const sales = screen.getByRole('region', { name: 'Sales' });
    expect(within(sales).getByText('฿96,000.00')).toBeTruthy();
    expect(within(sales).getByText('฿4,800.00')).toBeTruthy();
    expect(within(sales).getByText(/not profit/)).toBeTruthy();
    const costs = screen.getByRole('region', { name: 'Costs' });
    expect(within(costs).getByRole('note').textContent).toContain(
      'Needs permission to read costs.',
    );
    expect(within(costs).queryByRole('table')).toBeNull();
  });

  it('explains how a figure is calculated, from the definitions the API sent', async () => {
    renderFarm();
    const sales = await screen.findByRole('region', { name: 'Sales' });
    await userEvent.click(within(sales).getByText('How are these calculated?'));
    expect(within(sales).getByText('refunded orders')).toBeTruthy();
    expect(within(sales).getAllByText(/means something precise/).length).toBeGreaterThan(0);
  });

  it('sends the chosen filters as query parameters and nothing the API would not accept', async () => {
    renderFarm('/farms/f1/dashboard?from=2026-06-01&to=2026-06-10&animalType=buffalo');
    await screen.findByRole('region', { name: 'Animals' });
    const first = calls(/dashboard$/)[0]!;
    expect(first[2].query).toEqual({ from: '2026-06-01', to: '2026-06-10', animalType: 'buffalo' });
    await userEvent.selectOptions(screen.getByLabelText('Orders'), 'product');
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() =>
      expect(calls(/dashboard$/).at(-1)![2].query).toMatchObject({
        orderKind: 'product',
        animalType: 'buffalo',
      }),
    );
  });

  it('offers CSV downloads only for sections that are available, and saves the file the API returns', async () => {
    download.mockResolvedValue({
      text: 'a,b',
      filename: 'animals_x.csv',
      contentType: 'text/csv',
      truncated: false,
    });
    const createUrl = vi.fn(() => 'blob:x');
    Object.assign(URL, { createObjectURL: createUrl, revokeObjectURL: vi.fn() });
    renderFarm('/farms/f1/dashboard?from=2026-06-01&to=2026-06-10');
    await screen.findByRole('region', { name: 'Animals' });
    expect(screen.getByRole('button', { name: 'Animals' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Orders' })).toBeTruthy(); // mirrors the sales section
    expect(screen.queryByRole('button', { name: 'Costs' })).toBeNull(); // costs unavailable → no export
    await userEvent.click(screen.getByRole('button', { name: 'Animals' }));
    await waitFor(() => expect(download).toHaveBeenCalled());
    expect(download.mock.calls[0]![0]).toBe('/farms/f1/dashboard/export');
    expect(download.mock.calls[0]![1].query).toEqual({
      section: 'animals',
      from: '2026-06-01',
      to: '2026-06-10',
    });
    expect(await screen.findByText('animals_x.csv saved.')).toBeTruthy();
  });

  it('shows the API error when an export is refused', async () => {
    download.mockRejectedValue(new Error('You do not have permission to export this'));
    renderFarm();
    await userEvent.click(await screen.findByRole('button', { name: 'Animals' }));
    expect((await screen.findByRole('alert')).textContent).toContain('permission to export');
  });

  it('shows an error with a retry when the dashboard cannot load', async () => {
    request.mockImplementation((_m: string, path: string) =>
      path === '/animal-types'
        ? Promise.resolve({ animalTypes: [] })
        : Promise.reject(new Error('Server down')),
    );
    renderFarm();
    expect((await screen.findByText(/Server down/)).textContent).toContain('Server down');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });
});

describe('admin analytics page', () => {
  it('renders available sections and marks the rest unavailable without data', async () => {
    render(
      <MemoryRouter initialEntries={['/admin/analytics']}>
        <AnalyticsPage />
      </MemoryRouter>,
    );
    const users = await screen.findByRole('region', { name: 'Users' });
    expect(within(users).getByText('7')).toBeTruthy();
    const orders = screen.getByRole('region', { name: 'Orders' });
    expect(within(orders).getByRole('note').textContent).toContain('payments permission');
    expect(screen.getByRole('button', { name: 'Sign-ups' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Commissions' })).toBeNull();
  });
});

describe('AUDIT2-UI1: dates typed before the animal types load are kept', () => {
  it('applies the From date the user typed even if the type list arrived in between', async () => {
    let releaseTypes: (v: unknown) => void = () => undefined;
    const typesLoaded = new Promise((resolve) => (releaseTypes = resolve));
    request.mockImplementation((_m: string, path: string) => {
      if (path === '/animal-types') return typesLoaded;
      if (/\/dashboard$/.test(path)) return Promise.resolve(farmDashboard);
      if (path === '/farms/f1')
        return Promise.resolve({ farm: { name: 'Happy Farm', access: { permissions: [] } } });
      return Promise.reject(new Error(`unexpected ${path}`));
    });
    renderFarm();
    const from = await screen.findByLabelText('From');
    await userEvent.type(from, '2026-05-01');
    releaseTypes({ animalTypes: [{ id: 'a', key: 'buffalo', name: 'Buffalo' }] });
    await screen.findByRole('option', { name: 'Buffalo' });
    expect((screen.getByLabelText('From') as HTMLInputElement).value).toBe('2026-05-01');
  });
});
