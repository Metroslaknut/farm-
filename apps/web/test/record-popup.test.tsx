import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Staging QA 2026-11-25, task 4: "Add" and "Correct" open the record form in a dialog over the page; the /new and
 * /:id/edit pages stay (links, new tabs, phones). Breeding keeps its own page.
 */
const request = vi.hoisted(() => vi.fn());
vi.mock('../src/api', () => ({ api: { request } }));

import RecordDetailPage from '../src/pages/farms/records/RecordDetailPage';
import RecordListPage from '../src/pages/farms/records/RecordListPage';
import { KINDS } from '../src/pages/farms/records/recordConfigs';

const ANIMAL = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const actor = { id: 'u1', displayName: 'Somchai' };
const PERMS = [
  'records.read',
  'records.write',
  'records.correct',
  'breeding.read',
  'breeding.write',
];
const farm = {
  farm: {
    id: 'f1',
    name: 'Farm',
    status: 'active',
    location: {},
    contact: {},
    myRole: 'owner',
    createdAt: '2026-01-01T00:00:00Z',
    access: { via: 'member', permissions: PERMS },
    stats: { animalsTotal: 1, animalsActive: 1, byStatus: {} },
  },
};
const weight = (id: string, kg: number) => ({
  id,
  farmId: 'f1',
  animal: { id: ANIMAL, animalCode: 'A-1' },
  weighedOn: '2026-03-01',
  weightKg: kg,
  method: 'scale',
  revision: 1,
  attachments: [],
  createdBy: actor,
  createdAt: '2026-03-01T00:00:00Z',
  updatedAt: '2026-03-01T00:00:00Z',
  history: [],
});
let rows: object[] = [];

beforeEach(() => {
  rows = [weight('w1', 250)];
  request.mockReset();
  request.mockImplementation(
    async (
      method: string,
      path: string,
      opts?: { body?: { weightKg?: number; changes?: { weightKg: number } } },
    ) => {
      if (path === '/farms/f1') return farm;
      if (method === 'GET' && path === '/farms/f1/animals')
        return {
          items: [{ id: ANIMAL, animalCode: 'A-1', sex: 'female', currentStatus: 'active' }],
          page: 1,
          pageSize: 100,
          total: 1,
        };
      if (method === 'GET' && path === '/farms/f1/weights')
        return { items: rows, page: 1, pageSize: 20, total: rows.length };
      if (method === 'GET' && path === '/farms/f1/weights/w1') return { record: rows[0] };
      if (method === 'POST' && path === '/farms/f1/weights') {
        const created = weight('w2', opts!.body!.weightKg!);
        rows = [created, ...rows];
        return { record: created };
      }
      if (method === 'POST' && path === '/farms/f1/weights/w1/corrections') {
        rows = [{ ...weight('w1', opts!.body!.changes!.weightKg), revision: 2 }];
        return { record: rows[0] };
      }
      throw new Error(`unexpected ${method} ${path}`);
    },
  );
});

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/farms/:farmId/weights" element={<RecordListPage config={KINDS.weights} />} />
        <Route path="/farms/:farmId/weights/new" element={<p>the add page</p>} />
        <Route
          path="/farms/:farmId/weights/:id"
          element={<RecordDetailPage config={KINDS.weights} />}
        />
        <Route path="/farms/:farmId/weights/:id/edit" element={<p>the correct page</p>} />
        <Route
          path="/farms/:farmId/breeding"
          element={<RecordListPage config={KINDS.breeding} />}
        />
        <Route path="/farms/:farmId/breeding/new" element={<p>the breeding page</p>} />
      </Routes>
    </MemoryRouter>,
  );

describe('record form in a dialog', () => {
  it('"Add" opens the form over the list; saving closes it, says so and refreshes the list', async () => {
    const user = userEvent.setup();
    renderAt('/farms/f1/weights');
    const add = await screen.findByRole('link', { name: 'Add weight' });
    expect(add.getAttribute('href')).toBe('/farms/f1/weights/new'); // still a real link (new tab, phone)
    await user.click(add);
    const dialog = await screen.findByRole('dialog', { name: 'New weight' });
    expect(screen.queryByText('the add page')).toBeNull();

    await user.selectOptions(within(dialog).getByLabelText(/^Animal/), ANIMAL);
    fireEvent.change(within(dialog).getByLabelText(/^Date/), { target: { value: '2026-11-20' } });
    await user.type(within(dialog).getByLabelText(/^Weight \(kg\)/), '260');
    await user.click(within(dialog).getByRole('button', { name: 'Save weight' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByRole('status').textContent).toContain('Saved.');
    expect(screen.getByRole('link', { name: 'Open it' }).getAttribute('href')).toBe(
      '/farms/f1/weights/w2',
    );
    expect(await screen.findByText('260')).toBeTruthy(); // the list was fetched again
    expect(screen.getByText('250')).toBeTruthy();
  });

  it('Cancel closes the dialog without saving', async () => {
    const user = userEvent.setup();
    renderAt('/farms/f1/weights');
    await user.click(await screen.findByRole('link', { name: 'Add weight' }));
    const dialog = await screen.findByRole('dialog', { name: 'New weight' });
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(request.mock.calls.some((c) => c[0] === 'POST')).toBe(false);
  });

  it('"Correct" on a record opens the form with its values; saving shows the corrected record', async () => {
    const user = userEvent.setup();
    renderAt('/farms/f1/weights/w1');
    await user.click(await screen.findByRole('link', { name: 'Correct' }));
    const dialog = await screen.findByRole('dialog', { name: 'Correct weight' });
    const kg = within(dialog).getByLabelText(/^Weight \(kg\)/) as HTMLInputElement;
    expect(kg.value).toBe('250');
    await user.clear(kg);
    await user.type(kg, '255');
    await user.type(
      within(dialog).getByLabelText(/Why are you changing this record\?/),
      'Scale misread',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Save correction' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect((await screen.findAllByText(/255/)).length).toBeGreaterThan(0);
  });

  it('breeding keeps its own page', async () => {
    const user = userEvent.setup();
    request.mockImplementation(async (method: string, path: string) => {
      if (path === '/farms/f1') return farm;
      if (path === '/farms/f1/animals') return { items: [], page: 1, pageSize: 100, total: 0 };
      if (path === '/farms/f1/breeding') return { items: [], page: 1, pageSize: 20, total: 0 };
      throw new Error(`unexpected ${method} ${path}`);
    });
    renderAt('/farms/f1/breeding');
    await user.click(await screen.findByRole('link', { name: 'Add breeding record' }));
    expect(await screen.findByText('the breeding page')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
