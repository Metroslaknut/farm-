import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const request = vi.hoisted(() => vi.fn());
vi.mock('../src/api', () => ({ api: { request } }));

import RecordDetailPage from '../src/pages/farms/records/RecordDetailPage';
import RecordFormPage from '../src/pages/farms/records/RecordFormPage';
import {
  changesFrom,
  draftFromRecord,
  payloadFromDraft,
} from '../src/pages/farms/records/formEngine';
import { KINDS } from '../src/pages/farms/records/recordConfigs';
import { setLocale } from '../src/i18n';

const ANIMAL = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const actor = { id: 'u1', displayName: 'Somchai' };
const farm = (permissions: string[], status = 'active') => ({
  farm: {
    id: 'f1',
    name: 'Farm',
    status,
    location: {},
    contact: {},
    myRole: 'worker',
    createdAt: '2026-01-01T00:00:00Z',
    access: { via: 'member', permissions },
    stats: { animalsTotal: 0, animalsActive: 0, byStatus: {} },
  },
});
const weight = (over: object = {}) => ({
  id: 'w1',
  farmId: 'f1',
  animal: { id: ANIMAL, animalCode: 'A-1' },
  weighedOn: '2026-03-01',
  weightKg: 250,
  method: 'scale',
  revision: 2,
  attachments: [],
  createdBy: actor,
  createdAt: '2026-03-01T00:00:00Z',
  updatedAt: '2026-03-02T00:00:00Z',
  history: [
    {
      kind: 'correction',
      at: '2026-03-02T00:00:00Z',
      by: actor,
      reason: 'Scale misread',
      changes: [{ field: 'weightKg', from: 520, to: 250 }],
    },
  ],
  ...over,
});

function serve(permissions: string[], record: object, status = 'active') {
  request.mockImplementation(async (method: string, path: string) => {
    if (path === '/farms/f1') return farm(permissions, status);
    if (method === 'GET' && path === '/farms/f1/weights/w1') return { record };
    throw new Error(`unexpected ${method} ${path}`);
  });
}

const at = (path: string, route: string, el: React.ReactNode) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={route} element={el} />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  request.mockReset();
});

describe('form engine', () => {
  const fields = KINDS.weights.fields;
  it('omits empty values, converts numbers and nests dotted names', () => {
    const payload = payloadFromDraft(fields, {
      animalId: ANIMAL,
      weighedOn: '2026-03-01',
      weightKg: '250.5',
      method: '',
      notes: ' ',
    });
    expect(payload).toEqual({ animalId: ANIMAL, weighedOn: '2026-03-01', weightKg: 250.5 });
    expect(KINDS.weights.schema.safeParse(payload).success).toBe(true);
  });
  it('a correction only sends changed fields and never the locked animal', () => {
    const initial = draftFromRecord(fields, weight());
    expect(initial['animalId']).toBe(ANIMAL);
    expect(changesFrom(fields, initial, { ...initial, weightKg: '260' })).toEqual({
      weightKg: 260,
    });
    expect(changesFrom(fields, initial, { ...initial, animalId: 'other' })).toEqual({});
    expect(changesFrom(fields, { ...initial, notes: 'x' }, { ...initial, notes: '' })).toEqual({
      notes: null,
    });
  });
});

describe('record detail', () => {
  const route = '/farms/:farmId/weights/:id';
  it('shows who changed what, when and why', async () => {
    serve(['records.read', 'records.write', 'records.correct'], weight());
    at('/farms/f1/weights/w1', route, <RecordDetailPage config={KINDS.weights} />);
    expect(await screen.findByText(/Scale misread/)).toBeTruthy();
    expect(screen.getByText('520')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Correct' })).toBeTruthy();
  });
  it('hides correct/void for a role without records.correct', async () => {
    serve(['records.read', 'records.write'], weight());
    at('/farms/f1/weights/w1', route, <RecordDetailPage config={KINDS.weights} />);
    await screen.findByText(/Scale misread/);
    expect(screen.queryByRole('link', { name: 'Correct' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Void' })).toBeNull();
  });
  it('a voided record is flagged and offers no actions', async () => {
    serve(
      ['records.read', 'records.write', 'records.correct'],
      weight({ voided: { at: '2026-03-03T00:00:00Z', by: actor, reason: 'Wrong animal' } }),
    );
    at('/farms/f1/weights/w1', route, <RecordDetailPage config={KINDS.weights} />);
    expect(await screen.findByText(/Wrong animal/)).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Correct' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Void' })).toBeNull();
  });
  it('voiding needs a reason and posts it', async () => {
    serve(['records.read', 'records.write', 'records.correct'], weight());
    const user = userEvent.setup();
    at('/farms/f1/weights/w1', route, <RecordDetailPage config={KINDS.weights} />);
    await user.click(await screen.findByRole('button', { name: 'Void' }));
    const confirm = screen.getByRole('button', { name: 'Void record' });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    await user.type(screen.getAllByLabelText('Reason').at(-1)!, 'Entered twice');
    request.mockImplementation(async (m: string, p: string) => {
      if (p === '/farms/f1') return farm(['records.read', 'records.correct']);
      if (m === 'POST') return {};
      return { record: weight() };
    });
    await user.click(confirm);
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith('POST', '/farms/f1/weights/w1/void', {
        body: { reason: 'Entered twice' },
      }),
    );
  });
});

describe('record form access', () => {
  it('blocks the form for a viewer', async () => {
    request.mockImplementation(async () => farm(['records.read']));
    at(
      '/farms/f1/weights/new',
      '/farms/:farmId/weights/new',
      <RecordFormPage config={KINDS.weights} />,
    );
    expect(await screen.findByText(/do not have permission/)).toBeTruthy();
  });
  it('blocks writes on an archived farm', async () => {
    request.mockImplementation(async () => farm(['records.read', 'records.write'], 'archived'));
    at(
      '/farms/f1/weights/new',
      '/farms/:farmId/weights/new',
      <RecordFormPage config={KINDS.weights} />,
    );
    expect(await screen.findByText(/archived and read-only/)).toBeTruthy();
  });
});

describe('records in Thai', () => {
  beforeEach(() => setLocale('th'));
  const route = '/farms/:farmId/weights/:id';

  it('shows a weight record in Thai, then in English after switching', async () => {
    serve(['records.read', 'records.write', 'records.correct'], weight());
    at('/farms/f1/weights/w1', route, <RecordDetailPage config={KINDS.weights} />);
    expect(await screen.findByText(/Scale misread/)).toBeTruthy();
    expect(screen.getByRole('heading', { name: /250 กก\. เมื่อ/ })).toBeTruthy();
    expect(screen.getByText('ชั่งด้วยตาชั่ง')).toBeTruthy();
    expect(screen.getByText('ประวัติการเปลี่ยนแปลง')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'แก้ไข' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'ยกเลิกบันทึก' })).toBeTruthy();

    act(() => setLocale('en'));
    expect(screen.getByRole('heading', { name: /250 kg on/ })).toBeTruthy();
    expect(screen.getByText('Scale')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Correct' })).toBeTruthy();
  });

  it('explains a missing permission in Thai', async () => {
    request.mockImplementation(async () => farm(['records.read']));
    at(
      '/farms/f1/weights/new',
      '/farms/:farmId/weights/new',
      <RecordFormPage config={KINDS.weights} />,
    );
    expect(await screen.findByText('คุณไม่มีสิทธิ์เพิ่มน้ำหนักในฟาร์มนี้')).toBeTruthy();
  });
});
