import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const request = vi.hoisted(() => vi.fn());
vi.mock('../src/api', () => ({ api: { request } }));

import GrowthPage from '../src/pages/farms/records/GrowthPage';
import AnimalTypesPage from '../src/pages/admin/animal-types';
import GrowthStandardsPage from '../src/pages/admin/growth-standards';

const T1 = '111111111111111111111111';
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
});

const SYSTEM = { kind: 'system_recommendation' };
const standard = (over: object = {}) => ({
  id: 's1',
  animalType: { id: T1, key: 'buffalo', name: 'Buffalo' },
  sex: 'any',
  kind: 'weight_for_age',
  ageFromDays: 0,
  ageToDays: 60,
  minWeightKg: 20,
  maxWeightKg: 40,
  source: SYSTEM,
  active: true,
  updatedAt: '2026-11-01T00:00:00Z',
  ...over,
});
const point = (
  id: string,
  date: string,
  ageDays: number | undefined,
  kg: number,
  status: string,
) => ({
  id,
  date,
  weightKg: kg,
  ...(ageDays === undefined ? {} : { ageDays }),
  evaluation: {
    status,
    ageEstimated: false,
    metrics: status.startsWith('no_') ? {} : { weight: { status, value: kg, min: 20, max: 40 } },
  },
});
const growth = (over: object = {}) => ({
  animal: { id: 'a1', animalCode: 'A-1' },
  age: { birthDate: '2026-08-01', estimated: false, days: 98 },
  points: [point('w1', '2026-08-11', 10, 30, 'within'), point('w2', '2026-09-30', 50, 18, 'below')],
  summary: { count: 2 },
  maxWeightKg: null,
  standards: [
    standard(),
    standard({
      id: 's2',
      ageFromDays: 60,
      ageToDays: 400,
      minWeightKg: 50,
      maxWeightKg: undefined,
      source: { kind: 'reference', citation: 'DLD 2024' },
    }),
  ],
  windows: {
    sale: {
      standard: { id: 's3', ageFromDays: 300, ageToDays: 600, source: SYSTEM },
      status: 'before',
      ageEstimated: false,
    },
  },
  alerts: [
    {
      code: 'LATEST_BELOW_STANDARD',
      metric: 'weight',
      date: '2026-09-30',
      value: 18,
      min: 20,
      max: 40,
      ageEstimated: false,
    },
  ],
  ...over,
});

const renderGrowth = () =>
  render(
    <MemoryRouter initialEntries={['/farms/f1/animals/a1/growth']}>
      <Routes>
        <Route path="/farms/:farmId/animals/:animalId/growth" element={<GrowthPage />} />
      </Routes>
    </MemoryRouter>,
  );

describe('growth page against the criteria', () => {
  it('shows alerts, per-measurement status (icon + words), criteria with their source and age windows', async () => {
    mockApi({
      'GET /farms/f1': () => ({
        farm: { id: 'f1', status: 'active', access: { permissions: ['records.read'] } },
      }),
      'GET /farms/f1/animals/a1/growth': () => growth(),
    });
    renderGrowth();
    expect(
      await screen.findByText(/Weight 18 kg is below the criterion \(minimum 20 kg\) on 30 Sep/),
    ).toBeTruthy();
    const table = screen.getByRole('table');
    expect(within(table).getByText('▼ Below')).toBeTruthy();
    expect(within(table).getByText('● Within')).toBeTruthy();
    expect(screen.getAllByText('System recommendation (not an academic standard)').length).toBe(2);
    expect(screen.getByText('Source: DLD 2024')).toBeTruthy();
    expect(screen.getByText('Not yet')).toBeTruthy();
    expect(screen.getByText('No criterion yet')).toBeTruthy(); // breeding window not configured
    // Chart is drawn by age with the criterion band, and outside points are explained.
    expect(screen.getByRole('img').getAttribute('aria-label')).toContain('Weight by age');
    expect(document.querySelectorAll('[data-testid="criterion-band"]').length).toBe(1);
    expect(screen.getByText('Hollow point = outside the criterion')).toBeTruthy();
  });

  it('never compares without a birth date and says so', async () => {
    mockApi({
      'GET /farms/f1': () => ({
        farm: { id: 'f1', status: 'active', access: { permissions: ['records.read'] } },
      }),
      'GET /farms/f1/animals/a1/growth': () =>
        growth({
          age: { estimated: false },
          points: [
            point('w1', '2026-08-11', undefined, 30, 'no_age'),
            point('w2', '2026-09-30', undefined, 31, 'no_age'),
          ],
          standards: [],
          windows: {},
          alerts: [],
        }),
    });
    renderGrowth();
    expect(await screen.findByText(/Birth date unknown/)).toBeTruthy();
    expect(screen.getAllByText('Age unknown').length).toBe(2);
    expect(screen.getByRole('img').getAttribute('aria-label')).toContain('Weight over time');
    expect(screen.queryByText(/below the criterion/)).toBeNull();
  });
});

describe('admin: growth criteria', () => {
  const TYPES = [
    {
      id: T1,
      key: 'buffalo',
      name: 'Buffalo',
      status: 'active',
      breeds: [{ key: 'swamp', name: 'Swamp', active: true }],
    },
  ];

  it('lists criteria with their source and creates one (a reference needs a citation)', async () => {
    const posted = vi.fn((opts?: { body?: unknown }) => ({
      standard: { ...standard(), ...(opts?.body as object) },
    }));
    mockApi({
      'GET /animal-types': () => ({ animalTypes: TYPES }),
      'GET /growth-standards': () => ({ standards: [standard()] }),
      'POST /growth-standards': posted,
    });
    const user = userEvent.setup();
    render(<GrowthStandardsPage />);
    expect(await screen.findByText('System recommendation')).toBeTruthy();
    expect(screen.getByText('20–40 kg')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Add criterion' }));
    const form = screen.getByRole('form', { name: 'New growth criterion' });
    await user.selectOptions(within(form).getByLabelText('Breed'), 'swamp');
    await user.type(within(form).getByLabelText('Age from (days, inclusive)'), '0');
    await user.type(within(form).getByLabelText('Age to (days, exclusive)'), '90');
    await user.type(within(form).getByLabelText('Minimum weight (kg)'), '25');
    await user.selectOptions(within(form).getByLabelText('Source'), 'reference');
    await user.click(within(form).getByRole('button', { name: 'Save criterion' }));
    expect(within(form).getByText('A reference needs a citation')).toBeTruthy();
    expect(posted).not.toHaveBeenCalled();

    await user.type(within(form).getByLabelText(/^Citation/), 'DLD 2024');
    await user.click(within(form).getByRole('button', { name: 'Save criterion' }));
    await vi.waitFor(() => expect(posted).toHaveBeenCalledTimes(1));
    expect(posted.mock.calls[0]![0]!.body).toEqual({
      animalTypeId: T1,
      kind: 'weight_for_age',
      breed: 'swamp',
      sex: 'any',
      ageFromDays: 0,
      ageToDays: 90,
      minWeightKg: 25,
      source: { kind: 'reference', citation: 'DLD 2024' },
    });
  });

  it('edits send null for cleared bounds and can deactivate', async () => {
    const patched = vi.fn((opts?: { body?: unknown }) => {
      void opts;
      return { standard: standard() };
    });
    mockApi({
      'GET /animal-types': () => ({ animalTypes: TYPES }),
      'GET /growth-standards': () => ({ standards: [standard()] }),
      'PATCH /growth-standards/s1': patched,
    });
    const user = userEvent.setup();
    render(<GrowthStandardsPage />);
    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    const form = screen.getByRole('form', { name: 'Edit criterion' });
    expect((within(form).getByLabelText('Animal type') as HTMLSelectElement).disabled).toBe(true);
    await user.clear(within(form).getByLabelText('Maximum weight (kg)'));
    await user.click(within(form).getByRole('button', { name: 'Save criterion' }));
    await vi.waitFor(() => expect(patched).toHaveBeenCalledTimes(1));
    expect(patched.mock.calls[0]![0]!.body).toMatchObject({ minWeightKg: 20, maxWeightKg: null });

    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    await user.click(screen.getByRole('button', { name: /deactivate/i }));
    await vi.waitFor(() => expect(patched).toHaveBeenCalledTimes(2));
    expect(patched.mock.calls[1]![0]!.body).toEqual({ active: false });
  });
});

describe('admin: animal types', () => {
  it('creates a type (empty settings stay unset) and adds a breed', async () => {
    const created = vi.fn((opts?: { body?: unknown }) => {
      void opts;
      return { animalType: {} };
    });
    const breed = vi.fn((opts?: { body?: unknown }) => {
      void opts;
      return { animalType: {} };
    });
    mockApi({
      'GET /animal-types': () => ({
        animalTypes: [{ id: T1, key: 'buffalo', name: 'Buffalo', status: 'active', breeds: [] }],
      }),
      'POST /animal-types': created,
      [`POST /animal-types/${T1}/breeds`]: breed,
    });
    const user = userEvent.setup();
    render(<AnimalTypesPage />);
    await user.click(await screen.findByRole('button', { name: 'Add animal type' }));
    const form = screen.getByRole('form', { name: 'Add animal type' });
    await user.type(within(form).getByLabelText(/^Key/), 'alpaca');
    await user.type(within(form).getByLabelText('Name'), 'Alpaca');
    await user.type(within(form).getByLabelText(/^Gestation/), '345');
    await user.click(within(form).getByRole('button', { name: 'Save animal type' }));
    await vi.waitFor(() => expect(created).toHaveBeenCalledTimes(1));
    expect(created.mock.calls[0]![0]!.body).toEqual({
      key: 'alpaca',
      name: 'Alpaca',
      gestationDays: 345,
      breeds: [],
    });

    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    const breeds = screen.getByRole('form', { name: 'Add breed' });
    await user.type(within(breeds).getByLabelText(/^Key/), 'murrah');
    await user.type(within(breeds).getByLabelText('Name'), 'Murrah');
    await user.click(within(breeds).getByRole('button', { name: 'Add breed' }));
    await vi.waitFor(() => expect(breed).toHaveBeenCalledTimes(1));
    expect(breed.mock.calls[0]![0]!.body).toEqual({ key: 'murrah', name: 'Murrah' });
  });
});
