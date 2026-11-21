import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClientError } from '@farmplus/api-client';
import { formatAge, humanize } from '@farmplus/shared-utils';
import {
  fieldErrorsFromDetails,
  fieldErrorsFromZod,
  createAnimalSchema,
  estimatedBirthDate,
} from '@farmplus/validation';

// All pages talk to the API only through `api.request` — replace it with fixtures.
const request = vi.hoisted(() => vi.fn());
vi.mock('../src/api', () => ({ api: { request } }));

import AnimalDetailPage from '../src/pages/farms/AnimalDetailPage';
import AnimalFormPage from '../src/pages/farms/AnimalFormPage';
import AnimalListPage from '../src/pages/farms/AnimalListPage';
import FarmListPage from '../src/pages/farms/FarmListPage';
import { setLocale } from '../src/i18n';
import { forgetRecent } from '../src/lib/shared';

const T1 = '111111111111111111111111';
const T2 = '222222222222222222222222';
const SIRE = '333333333333333333333333';
const TYPES = [
  {
    id: T1,
    key: 'buffalo',
    name: 'Buffalo',
    status: 'active',
    breeds: [{ key: 'swamp', name: 'Swamp buffalo', active: true }],
  },
  { id: T2, key: 'goat', name: 'Goat', status: 'active', breeds: [] },
];
const farm = (permissions: string[], over: object = {}) => ({
  farm: {
    id: 'f1',
    name: 'Happy Farm',
    status: 'active',
    location: {},
    contact: {},
    myRole: 'owner',
    createdAt: '2026-01-01T00:00:00Z',
    access: { via: 'member', permissions },
    stats: { animalsTotal: 2, animalsActive: 2, byStatus: { active: 2 } },
    ...over,
  },
});
const ALL = ['farm.read', 'animals.read', 'animals.write', 'animals.archive'];
const animal = (over: object = {}) => ({
  id: 'a1',
  farmId: 'f1',
  animalCode: 'A-00001',
  animalType: { id: T1, key: 'buffalo', name: 'Buffalo' },
  sex: 'female',
  currentStatus: 'active',
  archived: false,
  birthDateEstimated: false,
  origin: { kind: 'born_on_farm' },
  offspringCount: 0,
  media: [],
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  ...over,
});

function mockApi(
  handlers: Record<string, (opts?: { query?: Record<string, unknown>; body?: unknown }) => unknown>,
) {
  request.mockImplementation(
    async (
      method: string,
      path: string,
      opts?: { query?: Record<string, unknown>; body?: unknown },
    ) => {
      const handler = handlers[`${method} ${path}`];
      if (!handler) throw new Error(`unexpected request ${method} ${path}`);
      return handler(opts);
    },
  );
}

const renderAt = (path: string, route: string, element: React.ReactNode) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={route} element={element} />
        <Route path="*" element={<p>navigated: elsewhere</p>} />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  request.mockReset(); // braces: a returned function would be run by vitest as a cleanup hook
});

describe('shared helpers used by every client', () => {
  it('formatAge', () => {
    const now = new Date('2026-10-11T00:00:00Z');
    expect(formatAge('2023-08-01', now)).toBe('3 y 2 m');
    expect(formatAge('2026-05-11', now)).toBe('5 m');
    expect(formatAge('2026-10-01', now)).toBe('10 d');
    expect(formatAge('2020-10-11', now)).toBe('6 y');
    expect(formatAge('2999-01-01', now)).toBeUndefined();
    expect(formatAge('garbage', now)).toBeUndefined();
    expect(formatAge(undefined, now)).toBeUndefined();
    expect(humanize('born_on_farm')).toBe('Born on farm');
  });

  it('maps schema and API errors onto form fields (first message per field)', () => {
    const parsed = createAnimalSchema.safeParse({
      animalTypeId: 'x',
      sex: 'robot',
      animalCode: 'A 1',
      origin: { kind: 'stolen' },
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const errors = fieldErrorsFromZod(parsed.error);
      expect(Object.keys(errors).sort()).toEqual([
        'animalCode',
        'animalTypeId',
        'origin.kind',
        'sex',
      ]);
    }
    expect(
      fieldErrorsFromDetails([
        { path: 'animalCode', message: 'Already used' },
        { path: 'animalCode', message: 'later' },
      ]),
    ).toEqual({ animalCode: 'Already used' });
    expect(fieldErrorsFromDetails(undefined)).toEqual({});
  });
});

describe('FarmListPage', () => {
  it('shows an explanatory empty state, then farms I own and farms I help run apart', async () => {
    mockApi({ 'GET /farms': () => ({ items: [], page: 1, pageSize: 12, total: 0 }) });
    const { unmount } = renderAt('/farms', '/farms', <FarmListPage />);
    expect(
      await screen.findByText(/Creating farms requires an approved farm-owner registration/),
    ).toBeTruthy();
    unmount();

    mockApi({
      'GET /farms': (opts) => ({
        items:
          opts?.query?.['relation'] === 'owned'
            ? [{ ...farm([]).farm, name: 'Somchai Farm', location: { province: 'Khon Kaen' } }]
            : [{ ...farm([]).farm, id: 'f2', name: 'Neighbour Farm', myRole: 'manager' }],
        page: 1,
        pageSize: 12,
        total: 1,
      }),
    });
    renderAt('/farms', '/farms', <FarmListPage />);
    const owned = within(await screen.findByRole('region', { name: 'Farms I own' }));
    expect(await owned.findByRole('link', { name: 'Somchai Farm' })).toBeTruthy();
    expect(owned.getByText('Owner')).toBeTruthy();
    expect(owned.getByText('Khon Kaen')).toBeTruthy();
    const managed = within(screen.getByRole('region', { name: 'Farms I help run' }));
    expect(await managed.findByRole('link', { name: 'Neighbour Farm' })).toBeTruthy();
    expect(managed.getByText('Manager')).toBeTruthy();
    expect(new Set(request.mock.calls.map((c) => c[2]?.query?.relation))).toEqual(
      new Set(['managed', 'owned']),
    );
  });

  it('surfaces API failures with a retry', async () => {
    mockApi({
      'GET /farms': () => {
        throw new ApiClientError('Unable to reach the FARM+ API');
      },
    });
    renderAt('/farms', '/farms', <FarmListPage />);
    const alerts = await screen.findAllByRole('alert');
    expect(alerts[0]!.textContent).toContain('Unable to reach');
    expect(screen.getAllByRole('button', { name: 'Try again' }).length).toBe(2);
  });
});

describe('AnimalListPage', () => {
  const rows = [
    animal({ name: 'Bua', birthDate: '2020-01-01' }),
    animal({
      id: 'a2',
      animalCode: 'A-00002',
      sex: 'male',
      currentStatus: 'for_sale',
      archived: true,
    }),
  ];
  const setup = () => {
    const seen: Record<string, unknown>[] = [];
    mockApi({
      'GET /farms/f1': () => farm(ALL),
      'GET /animal-types': () => ({ animalTypes: TYPES }),
      'GET /farms/f1/animals': (o) => {
        seen.push(o?.query ?? {});
        return { items: rows, page: Number(o?.query?.['page'] ?? 1), pageSize: 15, total: 40 };
      },
    });
    renderAt('/farms/f1/animals', '/farms/:farmId/animals', <AnimalListPage />);
    return seen;
  };

  it('renders rows with status, archived marker and a sortable, captioned table', async () => {
    setup();
    expect(await screen.findByRole('link', { name: 'A-00001' })).toBeTruthy();
    expect(screen.getByRole('table', { name: 'Animals' })).toBeTruthy();
    expect(
      within(screen.getByRole('table', { name: 'Animals' })).getByText('For sale'),
    ).toBeTruthy();
    expect(
      within(screen.getByRole('table', { name: 'Animals' })).getByText('Archived'),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Register animal' })).toBeTruthy();
    expect(screen.getByText('1–15 of 40')).toBeTruthy();
  });

  it('filters and pagination are sent to the API as query parameters', async () => {
    const seen = setup();
    await screen.findByRole('link', { name: 'A-00001' });
    await userEvent.selectOptions(screen.getByLabelText('Type'), T2);
    await waitFor(() =>
      expect(seen.at(-1)).toMatchObject({ animalTypeId: T2, page: '1', pageSize: 15 }),
    );
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'sold');
    await waitFor(() => expect(seen.at(-1)).toMatchObject({ animalTypeId: T2, status: 'sold' }));
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(seen.at(-1)).toMatchObject({ page: '2' }));
    await userEvent.click(screen.getByRole('button', { name: 'Reset' }));
    await waitFor(() => expect(seen.at(-1)).not.toHaveProperty('status', 'sold'));
  });

  it('hides "Register animal" from people who cannot write', async () => {
    mockApi({
      'GET /farms/f1': () => farm(['farm.read', 'animals.read'], { myRole: 'viewer' }),
      'GET /animal-types': () => ({ animalTypes: TYPES }),
      'GET /farms/f1/animals': () => ({ items: rows, page: 1, pageSize: 15, total: 2 }),
    });
    renderAt('/farms/f1/animals', '/farms/:farmId/animals', <AnimalListPage />);
    await screen.findByRole('link', { name: 'A-00001' });
    expect(screen.queryByRole('link', { name: 'Register animal' })).toBeNull();
  });
});

describe('AnimalFormPage (register)', () => {
  const setup = (post: (body: unknown) => unknown) => {
    mockApi({
      'GET /farms/f1': () => farm(ALL),
      'GET /animal-types': () => ({ animalTypes: TYPES }),
      'GET /farms/f1/animals': () => ({
        items: [animal({ id: SIRE, animalCode: 'BULL-1', sex: 'male' })],
        page: 1,
        pageSize: 100,
        total: 1,
      }),
      'POST /farms/f1/animals': (o) => post(o?.body),
    });
    renderAt('/farms/f1/animals/new', '/farms/:farmId/animals/new', <AnimalFormPage />);
  };
  const posted = () => request.mock.calls.filter((c) => c[0] === 'POST');

  it('validates required fields in the browser with the shared rules, and sends nothing', async () => {
    setup(() => ({ animal: animal() }));
    await screen.findByLabelText(/Animal type/);
    await userEvent.click(screen.getByRole('button', { name: 'Register animal' }));
    expect(await screen.findByText('Choose an animal type')).toBeTruthy();
    expect(screen.getByText('Choose the animal’s sex')).toBeTruthy();
    expect(screen.getByLabelText(/Animal type/).getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByLabelText(/Sex/).getAttribute('aria-invalid')).toBe('true');
    expect(posted()).toHaveLength(0);
    // an error disappears as soon as the user fixes that field
    await userEvent.selectOptions(screen.getByLabelText(/Sex/), 'female');
    expect(screen.queryByText('Choose the animal’s sex')).toBeNull();
    expect(screen.getByText('Choose an animal type')).toBeTruthy();
  });

  it('breed choices follow the selected type', async () => {
    setup(() => ({ animal: animal() }));
    const typeSelect = await screen.findByLabelText(/Animal type/);
    expect((screen.getByLabelText('Breed') as HTMLSelectElement).disabled).toBe(true);
    await userEvent.selectOptions(typeSelect, T1);
    const breed = screen.getByLabelText('Breed') as HTMLSelectElement;
    expect(breed.disabled).toBe(false);
    expect(within(breed).getByRole('option', { name: 'Swamp buffalo' })).toBeTruthy();
    await userEvent.selectOptions(typeSelect, T2); // different species: its (empty) breed list, selection reset
    expect(within(breed).queryByRole('option', { name: 'Swamp buffalo' })).toBeNull();
  });

  it('submits only the filled fields and navigates away on success', async () => {
    setup(() => ({ animal: animal({ id: 'new1' }) }));
    await userEvent.selectOptions(await screen.findByLabelText(/Animal type/), T1);
    await userEvent.selectOptions(screen.getByLabelText(/Sex/), 'female');
    await userEvent.type(screen.getByLabelText('Name'), '  Bua  ');
    await userEvent.click(screen.getByRole('button', { name: 'Register animal' }));
    await waitFor(() => expect(posted()).toHaveLength(1));
    expect(posted()[0]![2].body).toEqual({
      animalTypeId: T1,
      sex: 'female',
      name: 'Bua',
      birthDateEstimated: false,
      origin: { kind: 'born_on_farm' },
      currentStatus: 'active',
    });
    expect(await screen.findByText('navigated: elsewhere')).toBeTruthy();
  });

  it('turns an approximate age into an estimated birth date and sends the colour', async () => {
    setup(() => ({ animal: animal({ id: 'new2' }) }));
    await userEvent.selectOptions(await screen.findByLabelText(/Animal type/), T1);
    await userEvent.selectOptions(screen.getByLabelText(/Sex/), 'male');
    await userEvent.type(screen.getByLabelText(/^Colour/), 'Grey, white blaze');
    // Nonsense is refused, not guessed.
    await userEvent.type(screen.getByLabelText('Age (months)'), '14');
    await userEvent.click(screen.getByRole('button', { name: 'Use approximate age' }));
    expect(screen.getByText('Enter whole years and/or months (months 0–11).')).toBeTruthy();
    await userEvent.clear(screen.getByLabelText('Age (months)'));
    await userEvent.type(screen.getByLabelText('Age (years)'), '2');
    await userEvent.type(screen.getByLabelText('Age (months)'), '3');
    await userEvent.click(screen.getByRole('button', { name: 'Use approximate age' }));
    const expected = estimatedBirthDate(2, 3)!;
    expect((screen.getByLabelText('Birth date') as HTMLInputElement).value).toBe(expected);
    expect((screen.getByLabelText(/estimate/i) as HTMLInputElement).checked).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: 'Register animal' }));
    await waitFor(() => expect(posted()).toHaveLength(1));
    expect(posted()[0]![2].body).toMatchObject({
      birthDate: expected,
      birthDateEstimated: true,
      color: 'Grey, white blaze',
    });
  });

  it('shows a duplicate-code conflict under the Animal code field', async () => {
    setup(() => {
      throw new ApiClientError('Animal code "X-1" is already used on this farm', 409, {
        code: 'DUPLICATE_ANIMAL_CODE',
        details: [{ path: 'animalCode', message: 'Already used on this farm' }],
      });
    });
    await userEvent.selectOptions(await screen.findByLabelText(/Animal type/), T1);
    await userEvent.selectOptions(screen.getByLabelText(/Sex/), 'male');
    await userEvent.type(screen.getByLabelText('Animal code'), 'X-1');
    await userEvent.click(screen.getByRole('button', { name: 'Register animal' }));
    const code = screen.getByLabelText('Animal code');
    await waitFor(() => expect(code.getAttribute('aria-invalid')).toBe('true'));
    expect(screen.getByText('Already used on this farm')).toBeTruthy();
    expect(screen.queryByText('navigated: elsewhere')).toBeNull();
  });

  it('rejects an invalid code and a future birth date before contacting the server', async () => {
    setup(() => ({ animal: animal() }));
    await userEvent.selectOptions(await screen.findByLabelText(/Animal type/), T1);
    await userEvent.selectOptions(screen.getByLabelText(/Sex/), 'male');
    await userEvent.type(screen.getByLabelText('Animal code'), 'has space');
    fireEvent.change(screen.getByLabelText('Birth date'), { target: { value: '2999-01-01' } });
    await userEvent.click(screen.getByRole('button', { name: 'Register animal' }));
    expect(await screen.findByText(/no spaces/)).toBeTruthy();
    expect(screen.getByText(/cannot be in the future/)).toBeTruthy();
    expect(posted()).toHaveLength(0);
  });

  it('refuses to render the form for users who cannot write, or on an archived farm', async () => {
    mockApi({
      'GET /farms/f1': () => farm(['farm.read', 'animals.read']),
      'GET /animal-types': () => ({ animalTypes: TYPES }),
      'GET /farms/f1/animals': () => ({ items: [], page: 1, pageSize: 100, total: 0 }),
    });
    const first = renderAt(
      '/farms/f1/animals/new',
      '/farms/:farmId/animals/new',
      <AnimalFormPage />,
    );
    expect(await screen.findByText(/do not have permission/)).toBeTruthy();
    first.unmount();
    // The farm is archived later on: past the few seconds a page may reuse the farm it just read.
    forgetRecent();
    mockApi({
      'GET /farms/f1': () => farm(ALL, { status: 'archived' }),
      'GET /animal-types': () => ({ animalTypes: TYPES }),
      'GET /farms/f1/animals': () => ({ items: [], page: 1, pageSize: 100, total: 0 }),
    });
    renderAt('/farms/f1/animals/new', '/farms/:farmId/animals/new', <AnimalFormPage />);
    expect(await screen.findByText(/archived and read-only/)).toBeTruthy();
  });
});

describe('AnimalDetailPage', () => {
  const setup = (
    permissions: string[],
    a = animal({ name: 'Bua', sire: { id: SIRE, animalCode: 'BULL-1' }, offspringCount: 2 }),
    farmOver = {},
  ) => {
    mockApi({
      'GET /farms/f1': () => farm(permissions, farmOver),
      'GET /farms/f1/animals/a1': () => ({ animal: a }),
      'POST /farms/f1/animals/a1/archive': () => ({ animal: { ...a, archived: true } }),
    });
    renderAt('/farms/f1/animals/a1', '/farms/:farmId/animals/:animalId', <AnimalDetailPage />);
  };

  it('shows the record, parents and offspring count', async () => {
    setup(ALL);
    expect(await screen.findByRole('heading', { name: /A-00001 — Bua/ })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'BULL-1' }).getAttribute('href')).toBe(
      `/farms/f1/animals/${SIRE}`,
    );
    expect(screen.getByText('2')).toBeTruthy();
  });

  it('actions follow the farm permissions: viewers see none, workers can edit but not archive', async () => {
    setup(['farm.read', 'animals.read']);
    await screen.findByRole('heading', { name: /A-00001/ });
    expect(screen.queryByRole('link', { name: 'Edit' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Archive' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Attach' })).toBeNull();
  });

  it('workers get Edit and Attach but no Archive', async () => {
    setup(['farm.read', 'animals.read', 'animals.write']);
    expect(await screen.findByRole('link', { name: 'Edit' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Attach' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Archive' })).toBeNull();
  });

  it('archiving asks for confirmation and sends the optional reason', async () => {
    setup(ALL);
    await userEvent.click(await screen.findByRole('button', { name: 'Archive' }));
    const dialog = document.querySelector('dialog')!;
    expect(dialog.hasAttribute('open')).toBe(true);
    await userEvent.type(within(dialog).getByLabelText(/Reason/), 'Sold');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Archive' }));
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith('POST', '/farms/f1/animals/a1/archive', {
        body: { reason: 'Sold' },
      }),
    );
  });

  it('an archived animal is read-only in the UI (only Restore)', async () => {
    setup(
      ALL,
      animal({ archived: true, archivedAt: '2026-02-01T00:00:00Z', archiveReason: 'Moved' }),
    );
    expect(await screen.findByText(/The record is read-only/)).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Edit' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Restore' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Attach' })).toBeNull();
  });

  it('validates a media link (https only) before sending', async () => {
    setup(ALL);
    await userEvent.type(await screen.findByLabelText('File URL'), 'http://insecure.example/x.jpg');
    await userEvent.click(screen.getByRole('button', { name: 'Attach' }));
    expect(await screen.findByText(/Invalid URL|invalid/i)).toBeTruthy();
    expect(request.mock.calls.some((c) => c[0] === 'POST' && String(c[1]).includes('/media'))).toBe(
      false,
    );
  });
});

describe('farms in Thai', () => {
  beforeEach(() => setLocale('th'));

  it('renders the animal list in Thai and switches to English without a reload', async () => {
    mockApi({
      'GET /farms/f1': () => farm(ALL),
      'GET /animal-types': () => ({ animalTypes: TYPES }),
      'GET /farms/f1/animals': () => ({
        items: [
          animal({ birthDate: '2020-01-01' }),
          animal({
            id: 'a2',
            animalCode: 'A-00002',
            sex: 'male',
            currentStatus: 'for_sale',
            archived: true,
          }),
        ],
        page: 1,
        pageSize: 15,
        total: 2,
      }),
    });
    renderAt('/farms/f1/animals', '/farms/:farmId/animals', <AnimalListPage />);
    expect(await screen.findByRole('link', { name: 'A-00001' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'สัตว์' })).toBeTruthy();
    const table = within(screen.getByRole('table', { name: 'สัตว์' }));
    expect(table.getByText('ประกาศขาย')).toBeTruthy();
    expect(table.getByText('ตัวเมีย')).toBeTruthy();
    expect(table.getByText('เก็บถาวรแล้ว')).toBeTruthy();
    expect(table.getByText(/\d+ ปี/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'ขึ้นทะเบียนสัตว์' })).toBeTruthy();
    expect(screen.getByLabelText('ค้นหารหัสหรือชื่อ')).toBeTruthy();

    act(() => setLocale('en'));
    expect(screen.getByRole('heading', { name: 'Animals' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Register animal' })).toBeTruthy();
    expect(
      within(screen.getByRole('table', { name: 'Animals' })).getByText('For sale'),
    ).toBeTruthy();
  });

  it('shows the farm list empty state and roles in Thai', async () => {
    mockApi({ 'GET /farms': () => ({ items: [], page: 1, pageSize: 12, total: 0 }) });
    renderAt('/farms', '/farms', <FarmListPage />);
    expect(await screen.findByText('ยังไม่มีฟาร์ม')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'ฟาร์มของฉัน' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'ฟาร์มที่ฉันเป็นเจ้าของ' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'ฟาร์มที่ฉันเป็นผู้ดูแล' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'สร้างฟาร์ม' })).toBeTruthy();
  });

  it('shows the animal detail in Thai', async () => {
    mockApi({
      'GET /farms/f1': () => farm(ALL),
      'GET /farms/f1/animals/a1': () => ({ animal: animal({ name: 'Bua' }) }),
    });
    renderAt('/farms/f1/animals/a1', '/farms/:farmId/animals/:animalId', <AnimalDetailPage />);
    expect(await screen.findByRole('heading', { name: /A-00001 — Bua/ })).toBeTruthy();
    expect(screen.getByText('อยู่ในฟาร์ม')).toBeTruthy();
    expect(screen.getByText('เกิดในฟาร์ม')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'แก้ไข' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'เก็บถาวร' })).toBeTruthy();
    expect(screen.queryByText('Archive')).toBeNull();
  });
});
