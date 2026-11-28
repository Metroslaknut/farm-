import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('../src/api', () => ({ api, publicApi: api }));

import { AuthContext, withHelpers, type AuthState } from '../src/auth/AuthContext';
import { TipCards } from '../src/components/assistant/TipCards';
import { setLocale } from '../src/i18n';

/** Contextual tips on the farm dashboard and /help (docs/architecture/assistant.md, PR 5). */
beforeEach(() => {
  api.request.mockReset();
});
afterEach(() => setLocale('en'));

const FARM = 'a'.repeat(24);
function show(status: AuthState['status'], farmId?: string) {
  const value = withHelpers(
    { status, permissions: [], mfaRequired: false },
    {
      login: async () => 'authenticated',
      completeSignIn: async () => 'authenticated',
      verifyMfa: async () => undefined,
      logout: async () => undefined,
      reload: async () => undefined,
    },
  );
  render(
    <AuthContext.Provider value={value}>
      <MemoryRouter initialEntries={[`/farms/${FARM}`]}>
        <TipCards farmId={farmId} compact />
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

describe('tip cards', () => {
  it('words the tips in Thai, links the action, and stores "remind me in 7 days" / "hide"', async () => {
    setLocale('th');
    api.request.mockImplementation(async (method: string, path: string) =>
      method === 'GET'
        ? {
            tips: [
              {
                key: `withdrawal:${FARM}`,
                rule: 'withdrawal',
                severity: 'warning',
                params: { count: 2, until: '2026-12-05' },
                action: { route: `/farms/${FARM}/health` },
              },
              {
                key: 'seller-rejected',
                rule: 'seller-rejected',
                severity: 'action',
                params: { reason: 'บัตรไม่ชัด' },
                action: { route: '/farms/seller' },
              },
            ],
          }
        : { tip: { path } },
    );
    const user = userEvent.setup();
    show('authenticated', FARM);
    const tips = within(await screen.findByTestId('assistant-tips'));
    expect(api.request).toHaveBeenCalledWith(
      'GET',
      `/assistant/suggestions?route=%2Ffarms%2F${FARM}&farmId=${FARM}`,
    );
    expect(tips.getByText('สัตว์ 2 ตัวอยู่ในระยะหยุดยา')).toBeTruthy();
    // The date is a Thai (Buddhist-era) date, not the raw ISO day.
    expect(tips.getByText(/จนกว่าจะสิ้นสุด \(ถึง .*2569\)/)).toBeTruthy();
    expect(tips.getByRole('link', { name: 'ดูบันทึกสุขภาพ' }).getAttribute('href')).toBe(
      `/farms/${FARM}/health`,
    );
    expect(tips.getByText('เหตุผล: บัตรไม่ชัด')).toBeTruthy();

    await user.click(tips.getAllByRole('button', { name: 'เตือนอีกครั้งใน 7 วัน' })[0]!);
    expect(api.request).toHaveBeenCalledWith('PUT', `/me/assistant-tips/withdrawal%3A${FARM}`, {
      body: { action: 'snooze' },
    });
    expect(screen.queryByText('สัตว์ 2 ตัวอยู่ในระยะหยุดยา')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'ซ่อน' }));
    expect(api.request).toHaveBeenCalledWith('PUT', '/me/assistant-tips/seller-rejected', {
      body: { action: 'hide' },
    });
    expect(screen.queryByTestId('assistant-tips')).toBeNull();
  });

  it('asks nothing and shows nothing for a guest, and stays quiet when the request fails', async () => {
    show('anonymous');
    expect(api.request).not.toHaveBeenCalled();
    api.request.mockRejectedValue(new Error('offline'));
    show('authenticated');
    await Promise.resolve();
    expect(screen.queryByTestId('assistant-tips')).toBeNull();
  });
});
