import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ApiClientError } from '@farmplus/api-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const request = vi.hoisted(() => vi.fn());
vi.mock('../src/api', () => ({
  api: { request },
  publicApi: { request },
}));

import { setLocale } from '../src/i18n';
import { articles } from '../src/help/content';
import { search, words } from '../src/help/search';
import HelpApp from '../src/pages/help/HelpApp';
import SignInPage from '../src/pages/farms/SignInPage';
import ForgotPasswordPage from '../src/pages/farms/ForgotPasswordPage';
import ResetPasswordPage from '../src/pages/farms/ResetPasswordPage';
import { FarmOwnerRequestPage } from '../src/pages/farms/SellerRegistrationPage';
import { AuthContext, withHelpers, type AuthState } from '../src/auth/AuthContext';

beforeEach(() => {
  request.mockReset();
});
afterEach(() => setLocale('en'));

const at = (path: string, routes: React.ReactNode) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>{routes}</Routes>
    </MemoryRouter>,
  );
const help = (path: string) => at(path, <Route path="/help/*" element={<HelpApp />} />);

describe('help search', () => {
  it('splits Thai into words and finds what farmers type', () => {
    expect(words('ไม่ได้รับอีเมล')).toEqual(expect.arrayContaining(['ไม่', 'รับ', 'อีเมล']));
    const th = articles('th');
    expect(search(th, 'ไม่ได้รับอีเมล')[0]?.slug).toBe('register-email');
    expect(
      search(th, 'รหัส sms ไม่มา')
        .slice(0, 3)
        .map((a) => a.slug),
    ).toContain('register-phone');
    expect(search(th, 'ลืมรหัสผ่าน')[0]?.slug).toBe('forgot-password');
    expect(
      search(th, 'สร้างฟาร์มไม่ได้')
        .slice(0, 3)
        .map((a) => a.slug),
    ).toContain('request-farm-owner');
    expect(search(articles('en'), 'email did not arrive')[0]?.slug).toBe('register-email');
    expect(search(th, '')).toEqual([]);
  });
});

describe('/help', () => {
  it('lists "getting started" first, searches in Thai and says when nothing matches', async () => {
    setLocale('th');
    const user = userEvent.setup();
    help('/help');
    const sections = screen
      .getAllByRole('heading', { level: 2 })
      .filter((h) => h.id !== 'help-assistant');
    expect(sections[0]!.textContent).toBe('เริ่มต้นใช้งาน');
    await user.type(screen.getByLabelText('ค้นหาวิธีใช้'), 'ไม่ได้รับอีเมล');
    await user.click(screen.getByRole('button', { name: 'ค้นหาวิธีใช้' }));
    const results = within(screen.getByRole('region', { name: 'ผลการค้นหา' }));
    expect(results.getAllByRole('link')[0]!.textContent).toContain('สมัครสมาชิกด้วยอีเมล');
    await user.clear(screen.getByLabelText('ค้นหาวิธีใช้'));
    await user.type(screen.getByLabelText('ค้นหาวิธีใช้'), 'ภูเขาไฟฟูจิ');
    await user.click(screen.getByRole('button', { name: 'ค้นหาวิธีใช้' }));
    expect(screen.getByText(/ไม่พบบทความที่ตรงกับ "ภูเขาไฟฟูจิ"/)).toBeTruthy();
  });

  it('an article: steps with pictures, boxes, a notice when e-mail is not sent yet, "go to this page"', async () => {
    help('/help/register-email');
    expect(
      screen.getByRole('heading', { level: 1, name: 'Register with your email' }),
    ).toBeTruthy();
    expect(screen.getByText(/Emails and text messages are not being sent yet/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Go to this page' }).getAttribute('href')).toBe(
      '/farms/register',
    );
    const toc = within(screen.getByRole('navigation', { name: 'Steps' }));
    expect(toc.getAllByRole('listitem')).toHaveLength(6);
    const img = screen.getByAltText('The Register button at the top right') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe('/help/img/register-email/1-en-1280.webp');
    expect(img.getAttribute('loading')).toBe('lazy');
    expect(screen.getAllByText('If something goes wrong').length).toBe(3);
    expect(
      screen.getAllByRole('link', { name: 'Sign in' }).map((a) => a.getAttribute('href')),
    ).toContain('/help/sign-in');
  });

  it('an unknown article says so, with the way back', () => {
    help('/help/no-such-article');
    expect(screen.getByRole('heading', { name: 'Article not found' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Back to the help centre' })).toBeTruthy();
  });

  it('"was this helpful?" sends an anonymous vote once, and says when it failed', async () => {
    const user = userEvent.setup();
    request.mockResolvedValueOnce(undefined);
    const { unmount } = help('/help/sign-in');
    await user.click(screen.getByRole('button', { name: 'Helpful' }));
    expect(await screen.findByText('Thank you for your feedback')).toBeTruthy();
    expect(request).toHaveBeenCalledWith('POST', '/help/feedback', {
      body: { slug: 'sign-in', locale: 'en', helpful: true },
    });
    unmount();
    request.mockRejectedValueOnce(new Error('offline'));
    help('/help/sign-in');
    await user.click(screen.getByRole('button', { name: 'Not helpful' }));
    expect(await screen.findByText('Could not send your feedback. Please try again.')).toBeTruthy();
  });
});

function signedOut(ui: React.ReactNode, path: string) {
  const state: AuthState = { status: 'anonymous', permissions: [], mfaRequired: false };
  const login = vi.fn(async () => {
    throw new ApiClientError('Verify first', 403, { code: 'ACCOUNT_NOT_VERIFIED' });
  });
  const value = withHelpers(state, {
    login,
    completeSignIn: async () => 'authenticated',
    verifyMfa: async () => undefined,
    logout: async () => undefined,
    reload: async () => undefined,
  });
  render(
    <AuthContext.Provider value={value}>
      <MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>
    </AuthContext.Provider>,
  );
}

describe('sign-in, forgot and reset password', () => {
  it('an unverified account can ask for the verification link again from the sign-in page', async () => {
    const user = userEvent.setup();
    request.mockResolvedValue(undefined);
    signedOut(<SignInPage />, '/farms/sign-in');
    expect(screen.getByRole('link', { name: 'Forgot your password?' }).getAttribute('href')).toBe(
      '/farms/forgot-password',
    );
    expect(screen.queryByRole('button', { name: 'Send the link again' })).toBeNull();
    await user.type(screen.getByLabelText(/^Email or phone/), 'somchai@example.com');
    await user.type(screen.getByLabelText(/^Password/, { selector: 'input' }), 'example-password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await user.click(await screen.findByRole('button', { name: 'Send the link again' }));
    expect(request).toHaveBeenCalledWith('POST', '/auth/verify/resend', {
      body: { identifier: 'somchai@example.com' },
    });
    expect(await screen.findByText(/we have sent it a new link or code/)).toBeTruthy();
  });

  it('forgot password: checks the input, then never tells whether the account exists', async () => {
    const user = userEvent.setup();
    request.mockResolvedValue(undefined);
    at('/', <Route path="/" element={<ForgotPasswordPage />} />);
    await user.click(screen.getByRole('button', { name: 'Send a reset link' }));
    expect(screen.getByText('Please enter a valid email or phone number')).toBeTruthy();
    expect(request).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText(/^Email or phone/), 'somchai@example.com');
    await user.click(screen.getByRole('button', { name: 'Send a reset link' }));
    expect(
      await screen.findByText('If this account exists, we have sent it a reset link'),
    ).toBeTruthy();
    expect(request).toHaveBeenCalledWith('POST', '/auth/password/forgot', {
      body: { identifier: 'somchai@example.com' },
    });
  });

  it('reset password: validates, saves, and handles an expired link and a missing token', async () => {
    const user = userEvent.setup();
    const token = 'x'.repeat(40);
    request.mockResolvedValueOnce(undefined);
    const { unmount } = at(`/?token=${token}`, <Route path="/" element={<ResetPasswordPage />} />);
    await user.type(screen.getByLabelText(/^New password/, { selector: 'input' }), 'short');
    await user.click(screen.getByRole('button', { name: 'Save the new password' }));
    expect(screen.getByText('The password must be at least 10 characters')).toBeTruthy();
    await user.clear(screen.getByLabelText(/^New password/, { selector: 'input' }));
    await user.type(
      screen.getByLabelText(/^New password/, { selector: 'input' }),
      'new-password-1',
    );
    await user.type(
      screen.getByLabelText(/^Confirm new password/, { selector: 'input' }),
      'new-password-1',
    );
    await user.click(screen.getByRole('button', { name: 'Save the new password' }));
    expect(await screen.findByRole('heading', { name: 'Your new password is saved' })).toBeTruthy();
    expect(request).toHaveBeenCalledWith('POST', '/auth/password/reset', {
      body: { token, newPassword: 'new-password-1' },
    });
    unmount();

    request.mockRejectedValueOnce(
      new ApiClientError('expired', 401, { code: 'INVALID_RESET_TOKEN' }),
    );
    const second = at(`/?token=${token}`, <Route path="/" element={<ResetPasswordPage />} />);
    await user.type(
      screen.getByLabelText(/^New password/, { selector: 'input' }),
      'new-password-1',
    );
    await user.type(
      screen.getByLabelText(/^Confirm new password/, { selector: 'input' }),
      'new-password-1',
    );
    await user.click(screen.getByRole('button', { name: 'Save the new password' }));
    expect(
      await screen.findByRole('heading', { name: 'The reset link has expired or is invalid' }),
    ).toBeTruthy();
    second.unmount();

    at('/', <Route path="/" element={<ResetPasswordPage />} />);
    expect(screen.getByRole('link', { name: 'Ask for a new link' }).getAttribute('href')).toBe(
      '/farms/forgot-password',
    );
  });
});

describe('farm-owner request (G1)', () => {
  const mine = (registrations: object[], canCreateFarm = false) =>
    request.mockImplementation(async (_m: string, path: string) =>
      path === '/registrations/mine'
        ? { registrations }
        : { status: 'not_applicable', canCreateFarm, farms: [] },
    );
  const page = () => at('/', <Route path="/" element={<FarmOwnerRequestPage />} />);

  it('no request yet: the form, which sends a farm_owner registration', async () => {
    const user = userEvent.setup();
    mine([]);
    page();
    const form = await screen.findByRole('form', { name: 'Farm-owner request form' });
    await user.type(within(form).getByLabelText(/Farm or business name/), '[[Example] Sukjai Farm');
    await user.click(within(form).getByRole('button', { name: 'Send request' }));
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith('POST', '/registrations', {
        body: { type: 'farm_owner', businessName: '[Example] Sukjai Farm', documents: [] },
      }),
    );
  });

  it('pending, approved, rejected, and an account that can already create farms', async () => {
    const reg = (status: string, extra: object = {}) => ({
      id: 'r1',
      type: 'farm_owner',
      status,
      applicant: { id: 'u1', displayName: 'Somchai' },
      documents: [],
      submittedAt: '2026-11-20T03:00:00.000Z',
      ...extra,
    });
    mine([reg('PENDING')]);
    let r = page();
    expect(await screen.findByText(/waiting for review/)).toBeTruthy();
    r.unmount();
    mine([
      reg('REJECTED', {
        decision: {
          outcome: 'REJECTED',
          byId: 'a',
          at: '2026-11-21T00:00:00Z',
          reason: 'No farm details',
        },
      }),
    ]);
    r = page();
    expect(await screen.findByText('Reason from the reviewer: No farm details')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Send the request again' })).toBeTruthy();
    r.unmount();
    mine([], true);
    page();
    expect(await screen.findByText('Your account can already create farms.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Create a farm' }).getAttribute('href')).toBe(
      '/farms/new',
    );
    expect(screen.queryByRole('form')).toBeNull();
  });
});
