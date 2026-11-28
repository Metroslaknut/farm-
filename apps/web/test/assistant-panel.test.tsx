import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ request: vi.fn() }));
const publicApi = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('../src/api', () => ({ api, publicApi }));

import { AuthContext, withHelpers, type AuthState } from '../src/auth/AuthContext';
import { setLocale } from '../src/i18n';
import HelpApp from '../src/pages/help/HelpApp';

/** The "Ask the FARM+ assistant" panel on /help (docs/architecture/assistant.md). */
beforeEach(() => {
  api.request.mockReset();
  publicApi.request.mockReset();
});
afterEach(() => setLocale('en'));

function helpAs(status: AuthState['status']) {
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
      <MemoryRouter initialEntries={['/help']}>
        <Routes>
          <Route path="/help/*" element={<HelpApp />} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

describe('assistant panel', () => {
  it('a guest gets the related articles and is told to sign in for AI answers (Thai)', async () => {
    setLocale('th');
    publicApi.request.mockResolvedValue({
      mode: 'search',
      reason: 'guest',
      citations: [{ slug: 'add-animal', title: 'เพิ่มสัตว์เข้าฟาร์ม' }],
      links: [],
      tours: [],
    });
    const user = userEvent.setup();
    helpAs('anonymous');
    await user.type(await screen.findByLabelText(/คำถามเรื่องการใช้งาน/), 'เพิ่มไก่ยังไง');
    await user.click(screen.getByRole('button', { name: 'ถาม' }));
    const result = within(await screen.findByTestId('assistant-result'));
    expect(result.getByText(/เข้าสู่ระบบเพื่อรับคำตอบจากผู้ช่วย AI/)).toBeTruthy();
    expect(result.getByRole('link', { name: 'เพิ่มสัตว์เข้าฟาร์ม' }).getAttribute('href')).toBe(
      '/help/add-animal',
    );
    expect(publicApi.request).toHaveBeenCalledWith('POST', '/assistant/ask', {
      body: { message: 'เพิ่มไก่ยังไง', locale: 'th', context: { route: '/help' } },
    });
    expect(api.request).not.toHaveBeenCalled();
  });

  it('signed in: shows the AI answer as text with its sources and page links', async () => {
    api.request.mockResolvedValue({
      mode: 'ai',
      answer: 'Open your farm, then press Add animal.\n<b>not markup</b>',
      citations: [{ slug: 'add-animal', title: 'Add an animal' }],
      links: [{ route: '/farms', label: 'My farms' }],
      tours: ['not-a-tour-here'],
    });
    const user = userEvent.setup();
    helpAs('authenticated');
    await user.type(await screen.findByLabelText(/Your question/), 'how do I add an animal');
    await user.click(screen.getByRole('button', { name: 'Ask' }));
    const result = within(await screen.findByTestId('assistant-result'));
    expect(result.getByText(/Open your farm, then press Add animal\./).textContent).toContain(
      '<b>not markup</b>',
    );
    expect(result.getByText(/comes from AI and may not be fully correct/)).toBeTruthy();
    expect(result.getByRole('link', { name: 'Add an animal' }).getAttribute('href')).toBe(
      '/help/add-animal',
    );
    expect(result.getByRole('link', { name: 'My farms' }).getAttribute('href')).toBe('/farms');
    // A tour this person cannot start here gets no button.
    expect(result.queryByRole('button')).toBeNull();
  });

  it('says so when asking fails', async () => {
    publicApi.request.mockRejectedValue(new Error('offline'));
    const user = userEvent.setup();
    helpAs('anonymous');
    await user.type(await screen.findByLabelText(/Your question/), 'help me');
    await user.click(screen.getByRole('button', { name: 'Ask' }));
    expect(await screen.findByText('Could not ask. Please try again.')).toBeTruthy();
  });
});
