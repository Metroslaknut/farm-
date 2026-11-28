import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('../src/api', () => ({ api, publicApi: api }));

import AssistantActions from '../src/components/assistant/AssistantActions';
import { setLocale } from '../src/i18n';

/** "Ask the assistant to do it" (PR 6a): shows what it understood, then opens the real form filled in. */
const FARM = 'f'.repeat(24);
const ANIMAL = 'a'.repeat(24);
beforeEach(() => {
  api.request.mockReset();
});
afterEach(() => setLocale('en'));

function Landing() {
  const { pathname, state } = useLocation();
  return <pre data-testid="landing">{JSON.stringify({ pathname, state })}</pre>;
}
const show = () =>
  render(
    <MemoryRouter initialEntries={['/help']}>
      <Routes>
        <Route path="/help" element={<AssistantActions />} />
        <Route path="*" element={<Landing />} />
      </Routes>
    </MemoryRouter>,
  );

describe('assistant actions', () => {
  it('Thai: shows 2.3 กก. and the Thai date, then opens the weight form with the values (nothing saved here)', async () => {
    setLocale('th');
    api.request.mockImplementation(async (method: string, path: string) => {
      if (path === '/farms') return { items: [{ id: FARM, name: 'ฟาร์มบัว' }], total: 1 };
      return {
        kind: 'form',
        form: 'record_weight',
        route: `/farms/${FARM}/weights/new`,
        values: { animalId: ANIMAL, weightKg: '2.3', weighedOn: '2026-11-28' },
        understood: [
          { field: 'animalId', value: 'A-00001 — Bua' },
          { field: 'weightKg', value: '2.3' },
          { field: 'weighedOn', value: '2026-11-28' },
        ],
      };
    });
    const user = userEvent.setup();
    show();
    await user.type(
      await screen.findByLabelText(/บอกสิ่งที่ต้องการทำ/),
      'บันทึกน้ำหนัก A-00001 2 โล 3 ขีด วันนี้',
    );
    await user.click(screen.getByRole('button', { name: 'ให้ช่วยทำ' }));
    const result = within(await screen.findByTestId('assistant-act-result'));
    expect(await result.findByText('สัตว์: A-00001 — Bua')).toBeTruthy();
    expect(result.getByText('น้ำหนัก: 2.3 กก.')).toBeTruthy();
    expect(result.getByText(/วันที่ชั่ง: .*2569/)).toBeTruthy();
    // The only farm is chosen without asking.
    expect(api.request).toHaveBeenCalledWith('POST', '/assistant/act', {
      body: {
        message: 'บันทึกน้ำหนัก A-00001 2 โล 3 ขีด วันนี้',
        locale: 'th',
        context: { route: '/help', farmId: FARM },
      },
    });
    expect(api.request.mock.calls.filter(([m]) => m === 'POST')).toHaveLength(1);
    await user.click(result.getByRole('button', { name: 'เปิดแบบฟอร์มที่กรอกไว้' }));
    expect(JSON.parse(screen.getByTestId('landing').textContent!)).toEqual({
      pathname: `/farms/${FARM}/weights/new`,
      state: { assistantPrefill: { animalId: ANIMAL, weightKg: '2.3', weighedOn: '2026-11-28' } },
    });
  });

  it('asks for what is missing, and says when it cannot help', async () => {
    api.request.mockImplementation(async (_m: string, path: string) =>
      path === '/farms'
        ? { items: [], total: 0 }
        : { kind: 'question', form: 'record_weight', missing: ['weightKg', 'somethingElse'] },
    );
    const user = userEvent.setup();
    show();
    await user.type(await screen.findByLabelText(/What do you want to do/), 'weigh A-00001');
    await user.click(screen.getByRole('button', { name: 'Do it' }));
    expect(
      await screen.findByText('More information needed: Weight. Try again with everything.'),
    ).toBeTruthy();
    api.request.mockImplementation(async () => ({ kind: 'none', reason: 'not_understood' }));
    await user.click(screen.getByRole('button', { name: 'Do it' }));
    expect(await screen.findByText(/The assistant cannot do that/)).toBeTruthy();
  });
});
