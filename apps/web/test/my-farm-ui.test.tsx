import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// All pages talk to the API only through `api.request` — replace it with fixtures.
const request = vi.hoisted(() => vi.fn());
vi.mock('../src/api', () => ({ api: { request } }));
vi.mock('../src/auth/AuthContext', async () => ({
  // The dashboard layout's inbox reads the context directly; signed out there means no realtime connection.
  AuthContext: (await import('react')).createContext(null),
  useAuth: () => ({
    status: 'authenticated',
    user: { displayName: 'Somchai', email: 's@example.test', roles: ['farm_owner'] },
  }),
}));

import FarmFormPage from '../src/pages/farms/FarmFormPage';
import FarmHomePage from '../src/pages/farms/FarmHomePage';
import { FarmShell } from '../src/pages/farms/shell/FarmShell';
import RequireFarmSetup from '../src/pages/farms/RequireFarmSetup';
import UserProfilePage from '../src/pages/farms/UserProfilePage';

const T1 = '111111111111111111111111';
const T2 = '222222222222222222222222';
const TYPES = [
  { id: T1, key: 'buffalo', name: 'Buffalo', nameTh: 'กระบือ', status: 'active', breeds: [] },
  { id: T2, key: 'goat', name: 'Goat', status: 'active', breeds: [] },
];
const summary = (over: object = {}) => ({
  id: 'f1',
  name: 'Happy Farm',
  status: 'active',
  location: { province: 'ขอนแก่น' },
  contact: { phone: '0812345678' },
  animalTypeIds: [T1],
  myRole: 'owner',
  createdAt: '2026-01-01T00:00:00Z',
  ...over,
});
const detail = (permissions: string[]) => ({
  farm: {
    ...summary(),
    access: { via: 'member', permissions },
    stats: { animalsTotal: 3, animalsActive: 2, byStatus: { active: 2, for_sale: 1 } },
  },
});

type Handler = (opts?: { query?: Record<string, unknown>; body?: unknown }) => unknown;
function mockApi(handlers: Record<string, Handler>) {
  request.mockImplementation(async (method: string, path: string, opts?: { body?: unknown }) => {
    const handler = handlers[`${method} ${path}`];
    if (!handler) throw new Error(`unexpected request ${method} ${path}`);
    return handler(opts);
  });
}

const renderAt = (path: string, routes: React.ReactNode, state?: unknown) =>
  render(
    <MemoryRouter initialEntries={[{ pathname: path, state }]}>
      <Routes>
        {routes}
        <Route path="*" element={<p>navigated: elsewhere</p>} />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  request.mockReset();
  // The address picker loads Thai places from the network; tests run without it.
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: false })),
  );
});

describe('onboarding guard', () => {
  const guarded = (
    <>
      <Route element={<RequireFarmSetup />}>
        <Route path="/farms" element={<p>farm list</p>} />
      </Route>
      <Route path="/farms/new" element={<p>farm setup</p>} />
    </>
  );

  it('sends a farm owner without a farm to the farm setup', async () => {
    mockApi({
      'GET /farms/me': () => ({ status: 'farm_setup_required', canCreateFarm: true, farms: [] }),
    });
    renderAt('/farms', guarded);
    expect(await screen.findByText('farm setup')).toBeTruthy();
  });

  it('lets users with a farm, and users who cannot create one, through', async () => {
    mockApi({
      'GET /farms/me': () => ({ status: 'farm_setup_completed', canCreateFarm: true, farms: [] }),
    });
    const { unmount } = renderAt('/farms', guarded);
    expect(await screen.findByText('farm list')).toBeTruthy();
    unmount();
    mockApi({
      'GET /farms/me': () => ({ status: 'not_applicable', canCreateFarm: false, farms: [] }),
    });
    renderAt('/farms', guarded);
    expect(await screen.findByText('farm list')).toBeTruthy();
  });
});

describe('farm setup (step by step)', () => {
  it('validates each step, cannot be skipped when required, and posts the farm', async () => {
    const posted = vi.fn((opts?: { body?: unknown }) => {
      void opts;
      return { farm: summary({ id: 'new1' }) };
    });
    mockApi({ 'GET /animal-types': () => ({ animalTypes: TYPES }), 'POST /farms': posted });
    const user = userEvent.setup();
    renderAt(
      '/farms/new',
      <>
        <Route path="/farms/new" element={<FarmFormPage />} />
        <Route path="/farms/:farmId" element={<p>my farm home</p>} />
      </>,
      { setupRequired: true },
    );
    expect(screen.getByText('Step 1 of 3')).toBeTruthy();
    expect(screen.getByText('Farm setup required')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Cancel' })).toBeNull();

    // Step 1 needs a name before "Next".
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('Step 1 of 3')).toBeTruthy();
    await user.type(screen.getByLabelText(/Farm name|Name/), 'New Farm');
    await user.click(await screen.findByLabelText('Goat'));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('Step 2 of 3')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('Step 3 of 3')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Save and start' }));

    expect(await screen.findByText('my farm home')).toBeTruthy();
    expect(posted).toHaveBeenCalledTimes(1);
    expect(posted.mock.calls[0]![0]!.body).toMatchObject({
      name: 'New Farm',
      animalTypeIds: [T2],
    });
  });
});

describe('editing the farm (from the profile)', () => {
  it('prefills the farm and saves changes with PATCH', async () => {
    const patched = vi.fn((opts?: { body?: unknown }) => {
      void opts;
      return { farm: summary() };
    });
    mockApi({
      'GET /animal-types': () => ({ animalTypes: TYPES }),
      'GET /farms/f1': () => detail(['farm.read', 'farm.update']),
      'PATCH /farms/f1': patched,
    });
    const user = userEvent.setup();
    renderAt('/farms/f1/edit', <Route path="/farms/:farmId/edit" element={<FarmFormPage />} />);
    const name = await screen.findByDisplayValue('Happy Farm');
    expect(screen.queryByText(/Step 1 of 3/)).toBeNull();
    expect(((await screen.findByLabelText('Buffalo')) as HTMLInputElement).checked).toBe(true);
    await user.clear(name);
    await user.type(name, 'Renamed Farm');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Farm details saved')).toBeTruthy();
    expect(patched.mock.calls[0]![0]!.body).toMatchObject({
      name: 'Renamed Farm',
      animalTypeIds: [T1],
      contact: { phone: '0812345678' },
    });
  });
});

describe('My farm home (dashboard layout)', () => {
  const section = (over: object = {}) => ({
    available: true,
    metrics: {},
    tables: {},
    series: {},
    ...over,
  });
  const dashboard = (sections: string[]) => ({
    meta: {},
    definitions: {},
    sections: Object.fromEntries(
      sections.map((s) => [
        s,
        s === 'growth'
          ? section({
              metrics: { weighingsInRange: 4 },
              series: {
                weighings: [
                  { period: '2026-11-01', value: 1 },
                  { period: '2026-11-02', value: 3 },
                ],
              },
              tables: {
                gainByAnimal: {
                  columns: [
                    'Animal',
                    'First kg',
                    'Latest kg',
                    'Days',
                    'Average daily gain (g/day)',
                  ],
                  rows: [['BUF-7', 100, 120, 20, 1000]],
                },
              },
            })
          : s === 'health'
            ? section({ metrics: { healthRecordsInRange: 2 } })
            : ['sales', 'products'].includes(s)
              ? { available: false, reason: 'no', metrics: {}, tables: {}, series: {} }
              : section(),
      ]),
    ),
  });

  it('shows the sidebar menu (filtered by permission), KPI cards, animal types and growth alerts', async () => {
    mockApi({
      'GET /farms/me': () => ({ status: 'ready', canCreateFarm: true, farms: [summary()] }),
      'GET /farms/f1': () => detail(['farm.read', 'animals.read', 'records.read']),
      'GET /farms/f1/dashboard': (o) => dashboard(String(o?.query?.['sections']).split(',')),
      'GET /farms/f1/summary': () => ({
        totals: {
          total: 3,
          onFarm: 3,
          forSale: 1,
          sold: 0,
          needsGrowthCheck: 2,
          outsideStandard: 1,
        },
        byType: [
          {
            animalTypeId: T1,
            key: 'buffalo',
            name: 'Buffalo',
            total: 3,
            onFarm: 3,
            forSale: 1,
            sold: 0,
            needsGrowthCheck: 2,
            outsideStandard: 1,
          },
        ],
        growthCheckDays: 30,
      }),
    });
    renderAt(
      '/farms/f1',
      <Route path="/farms" element={<FarmShell />}>
        <Route path=":farmId" element={<FarmHomePage />} />
      </Route>,
    );
    expect(await screen.findByRole('heading', { name: 'Overview', level: 1 })).toBeTruthy();
    const menu = screen.getByRole('navigation', { name: 'My farm menu' });
    // The group holding the current page is open; the others open on click.
    expect(within(menu).getByRole('link', { name: 'Overview' }).getAttribute('href')).toBe(
      '/farms/f1',
    );
    const animals = await within(menu).findByRole('button', { name: 'Animals' });
    expect(animals.getAttribute('aria-expanded')).toBe('false');
    await userEvent.click(animals);
    expect(within(menu).getByRole('link', { name: 'All animals' }).getAttribute('href')).toBe(
      '/farms/f1/animals',
    );
    await userEvent.click(within(menu).getByRole('button', { name: 'Farm records' }));
    expect(within(menu).getByRole('link', { name: 'Growth records' })).toBeTruthy();
    // No animals.write / listings.manage → no add or selling items.
    expect(within(menu).queryByRole('link', { name: 'Add animal' })).toBeNull();
    expect(within(menu).queryByRole('button', { name: 'Trade' })).toBeNull();

    // KPI cards: sales are not visible to this member, so farm activity fills the row.
    expect(await screen.findByText('Weighings', { selector: 'dt' })).toBeTruthy();
    expect(screen.getByText('Animals on the farm', { selector: 'dt' })).toBeTruthy();
    expect(screen.queryByText('Gross sales', { selector: 'dt' })).toBeNull();

    const type = await screen.findByRole('link', { name: 'Buffalo' });
    expect(type.getAttribute('href')).toBe(`/farms/f1/animals?animalTypeId=${T1}`);
    const card = type.closest('li')!;
    expect(within(card).getByText('Need a growth check: 2')).toBeTruthy();
    expect(within(card).getByText('Outside growth criteria: 1')).toBeTruthy();
    expect(screen.getByText(/Animals on the farm not weighed in the last 30 days/)).toBeTruthy();
    // Best growers come from the growth section.
    expect((await screen.findByRole('link', { name: 'BUF-7' })).getAttribute('href')).toBe(
      '/farms/f1/animals?q=BUF-7',
    );
  });
});

describe('profile → farm settings', () => {
  it('lists my farms with an edit link for owners', async () => {
    mockApi({
      'GET /farms/me': () => ({
        status: 'farm_setup_completed',
        canCreateFarm: true,
        farms: [summary(), summary({ id: 'f2', name: 'Other Farm', myRole: 'worker' })],
      }),
    });
    renderAt('/farms/profile', <Route path="/farms/profile" element={<UserProfilePage />} />);
    expect(
      (await screen.findByRole('link', { name: 'Edit farm details' })).getAttribute('href'),
    ).toBe('/farms/f1/edit');
    expect(screen.getByRole('link', { name: 'Open farm' }).getAttribute('href')).toBe('/farms/f2');
  });

  it('offers the farm setup when the user has none', async () => {
    mockApi({
      'GET /farms/me': () => ({ status: 'farm_setup_required', canCreateFarm: true, farms: [] }),
    });
    renderAt('/farms/profile', <Route path="/farms/profile" element={<UserProfilePage />} />);
    expect((await screen.findByRole('link', { name: 'Set up farm' })).getAttribute('href')).toBe(
      '/farms/new',
    );
  });
});

it('waits for the API before deciding (no flash of the farm list)', async () => {
  let resolve: (v: unknown) => void = () => {};
  request.mockImplementation(() => new Promise((r) => (resolve = r)));
  renderAt(
    '/farms',
    <Route element={<RequireFarmSetup />}>
      <Route path="/farms" element={<p>farm list</p>} />
    </Route>,
  );
  expect(screen.getByRole('status').textContent).toContain('Checking your farm…');
  resolve({ status: 'farm_setup_completed', canCreateFarm: true, farms: [] });
  await waitFor(() => expect(screen.getByText('farm list')).toBeTruthy());
});
