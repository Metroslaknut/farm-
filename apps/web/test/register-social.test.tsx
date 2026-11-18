import { createHash } from 'node:crypto';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  register: vi.fn(),
  login: vi.fn(),
  verifyMfa: vi.fn(),
  publicRequest: vi.fn(),
  oauthProviders: vi.fn(),
  oauthExchange: vi.fn(),
  request: vi.fn(),
  getMyAccess: vi.fn(),
}));
vi.mock('../src/api', async () => {
  // The start URL is built by the real api-client, so the test checks the exact address the browser is sent to.
  const { createApiClient } = await import('@farmplus/api-client');
  const real = createApiClient({ baseUrl: '' });
  return {
    publicApi: {
      register: m.register,
      login: m.login,
      verifyMfa: m.verifyMfa,
      request: m.publicRequest,
      oauthProviders: m.oauthProviders,
      oauthExchange: m.oauthExchange,
      oauthStartUrl: real.oauthStartUrl,
    },
    api: { request: m.request, getMyAccess: m.getMyAccess, logout: vi.fn() },
    refreshSession: vi.fn(async () => false),
  };
});

import { AuthProvider, useAuth } from '../src/auth/AuthContext';
import { browserNavigation } from '../src/auth/social';
import { SiteHeader } from '../src/components/layout/SiteHeader';
import { setLocale } from '../src/i18n';
import OAuthCallbackPage from '../src/pages/farms/OAuthCallbackPage';
import RegisterPage from '../src/pages/farms/RegisterPage';
import SignInPage from '../src/pages/farms/SignInPage';
import VerifyEmailPage from '../src/pages/farms/VerifyEmailPage';
import { renderAs } from './helpers';

const PASSWORD = 'long enough password';
const TOKENS = { accessToken: 'a'.repeat(40), refreshToken: 'r'.repeat(40), expiresIn: 900 };
const USER = {
  id: 'u1',
  displayName: 'สมชาย ใจดี',
  status: 'active' as const,
  emailVerified: false,
  phoneVerified: false,
  mfaEnabled: false,
  roles: ['user'],
  createdAt: '2026-01-01T00:00:00.000Z',
};
const apiError = (status: number, code: string) => Object.assign(new Error(code), { status, code });

function FarmsHome() {
  const { user } = useAuth();
  const location = useLocation();
  return (
    <p>
      FARMS {location.pathname} {user?.displayName}
    </p>
  );
}

function renderAt(route: string) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <AuthProvider>
        <Routes>
          <Route path="/farms" element={<FarmsHome />} />
          <Route path="/farms/x/*" element={<FarmsHome />} />
          <Route path="/farms/sign-in" element={<SignInPage />} />
          <Route path="/farms/register" element={<RegisterPage />} />
          <Route path="/farms/verify-email" element={<VerifyEmailPage />} />
          <Route path="/farms/oauth-callback" element={<OAuthCallbackPage />} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

async function fillRegistration(
  user: ReturnType<typeof userEvent.setup>,
  identifier: { email: string } | { phone: string },
) {
  await user.type(await screen.findByLabelText(/ชื่อที่แสดง/), 'สมชาย ใจดี');
  if ('phone' in identifier) {
    await user.click(screen.getByRole('radio', { name: 'เบอร์โทรศัพท์' }));
    await user.type(screen.getByLabelText(/เบอร์โทรศัพท์มือถือ/), identifier.phone);
  } else {
    await user.type(screen.getByRole('textbox', { name: /^อีเมล/ }), identifier.email);
  }
  await user.type(screen.getByLabelText(/^รหัสผ่าน/), PASSWORD);
  await user.type(screen.getByLabelText(/ยืนยันรหัสผ่าน/), PASSWORD);
  await user.click(screen.getByRole('button', { name: 'สมัครสมาชิก' }));
}

beforeEach(() => {
  // Registration and social sign-in are checked in Thai (the default language).
  setLocale('th');
  sessionStorage.clear();
  m.oauthProviders.mockResolvedValue([]);
  m.getMyAccess.mockResolvedValue({ user: USER, permissions: [], mfaRequired: false });
  m.register.mockResolvedValue(USER);
  m.login.mockResolvedValue({ status: 'authenticated', tokens: TOKENS, user: USER });
  m.publicRequest.mockResolvedValue(undefined);
});
afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('registration', () => {
  it('registers by email and signs in straight away when no verification is required', async () => {
    const user = userEvent.setup();
    renderAt('/farms/register');
    await fillRegistration(user, { email: 'New.Farmer@Example.test' });
    expect(await screen.findByText(/FARMS \/farms สมชาย ใจดี/)).toBeTruthy();
    expect(m.register).toHaveBeenCalledWith({
      displayName: 'สมชาย ใจดี',
      password: PASSWORD,
      email: 'new.farmer@example.test',
    });
    expect(m.login.mock.calls[0]?.[0]).toEqual({
      identifier: 'new.farmer@example.test',
      password: PASSWORD,
    });
    expect(sessionStorage.getItem('farmplus.refresh')).toBe(TOKENS.refreshToken);
  });

  it('registers by phone, normalising a Thai local number to E.164', async () => {
    const user = userEvent.setup();
    renderAt('/farms/register');
    await fillRegistration(user, { phone: '0812345678' });
    await screen.findByText(/FARMS \/farms/);
    expect(m.register).toHaveBeenCalledWith({
      displayName: 'สมชาย ใจดี',
      password: PASSWORD,
      phone: '+66812345678',
    });
    expect(m.login.mock.calls[0]?.[0]).toEqual({ identifier: '+66812345678', password: PASSWORD });
  });

  it('checks the form before calling the API', async () => {
    const user = userEvent.setup();
    renderAt('/farms/register');
    await user.click(await screen.findByRole('radio', { name: 'เบอร์โทรศัพท์' }));
    await user.type(screen.getByLabelText(/เบอร์โทรศัพท์มือถือ/), '12');
    await user.type(screen.getByLabelText(/^รหัสผ่าน/), 'short');
    await user.click(screen.getByRole('button', { name: 'สมัครสมาชิก' }));
    expect(screen.getByText('กรุณากรอกชื่อที่แสดง')).toBeTruthy();
    expect(screen.getByText(/กรุณากรอกเบอร์โทรศัพท์ให้ถูกต้อง/)).toBeTruthy();
    expect(screen.getByText('รหัสผ่านต้องมีอย่างน้อย 10 ตัวอักษร')).toBeTruthy();
    expect(m.register).not.toHaveBeenCalled();
  });

  it('shows a Thai message with a sign-in link when the account already exists', async () => {
    m.register.mockRejectedValue(apiError(409, 'ACCOUNT_EXISTS'));
    const user = userEvent.setup();
    renderAt('/farms/register');
    await fillRegistration(user, { email: 'taken@example.test' });
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('อีเมลนี้มีบัญชีอยู่แล้ว');
    expect(within(alert).getByRole('link', { name: 'เข้าสู่ระบบ' }).getAttribute('href')).toBe(
      '/farms/sign-in',
    );
    expect(m.login).not.toHaveBeenCalled();
  });

  it('phone needing verification: OTP step, resend, verify, then signed in with the same credentials', async () => {
    m.login
      .mockRejectedValueOnce(apiError(403, 'ACCOUNT_NOT_VERIFIED'))
      .mockResolvedValueOnce({ status: 'authenticated', tokens: TOKENS, user: USER });
    const user = userEvent.setup();
    renderAt('/farms/register');
    await fillRegistration(user, { phone: '081 234 5678' });
    expect(await screen.findByRole('heading', { name: 'ยืนยันเบอร์โทรศัพท์' })).toBeTruthy();
    expect(screen.getByText('+66812345678')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'ส่งรหัสใหม่' }));
    expect(m.publicRequest).toHaveBeenCalledWith('POST', '/auth/verify/resend', {
      body: { identifier: '+66812345678' },
    });
    expect(await screen.findByText('ส่งรหัสใหม่แล้ว')).toBeTruthy();

    await user.type(screen.getByLabelText(/รหัสยืนยัน 6 หลัก/), '123456');
    await user.click(screen.getByRole('button', { name: 'ยืนยันและเข้าสู่ระบบ' }));
    expect(await screen.findByText(/FARMS \/farms สมชาย ใจดี/)).toBeTruthy();
    expect(m.publicRequest).toHaveBeenCalledWith('POST', '/auth/verify/phone', {
      body: { phone: '+66812345678', code: '123456' },
    });
    expect(m.login).toHaveBeenCalledTimes(2);
    expect(m.login.mock.calls[1]?.[0]).toEqual({
      identifier: '+66812345678',
      password: PASSWORD,
    });
  });

  it('a wrong OTP shows a Thai error and stays on the step', async () => {
    m.login.mockRejectedValue(apiError(403, 'ACCOUNT_NOT_VERIFIED'));
    m.publicRequest.mockRejectedValue(apiError(400, 'INVALID_VERIFICATION'));
    const user = userEvent.setup();
    renderAt('/farms/register');
    await fillRegistration(user, { phone: '0812345678' });
    await user.type(await screen.findByLabelText(/รหัสยืนยัน 6 หลัก/), '000000');
    await user.click(screen.getByRole('button', { name: 'ยืนยันและเข้าสู่ระบบ' }));
    expect((await screen.findByRole('alert')).textContent).toContain('ไม่ถูกต้องหรือหมดอายุ');
    expect(m.login).toHaveBeenCalledTimes(1);
  });

  it('email needing verification: "we sent a link" with resend', async () => {
    m.login.mockRejectedValue(apiError(403, 'ACCOUNT_NOT_VERIFIED'));
    const user = userEvent.setup();
    renderAt('/farms/register');
    await fillRegistration(user, { email: 'verify@example.test' });
    expect(await screen.findByRole('heading', { name: 'ตรวจสอบอีเมลของคุณ' })).toBeTruthy();
    expect(screen.getByText('verify@example.test')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'ส่งลิงก์ยืนยันอีกครั้ง' }));
    expect(m.publicRequest).toHaveBeenCalledWith('POST', '/auth/verify/resend', {
      body: { identifier: 'verify@example.test' },
    });
    expect(await screen.findByText('ส่งลิงก์ยืนยันใหม่แล้ว')).toBeTruthy();
  });
});

describe('verify-email page', () => {
  it('confirms the token from the link, removes it from the address bar and shows success', async () => {
    const replace = vi.spyOn(window.history, 'replaceState');
    renderAt('/farms/verify-email?token=tok-success-0123456789abcdef');
    expect(await screen.findByRole('heading', { name: 'ยืนยันอีเมลเรียบร้อยแล้ว' })).toBeTruthy();
    expect(m.publicRequest).toHaveBeenCalledTimes(1);
    expect(m.publicRequest).toHaveBeenCalledWith('POST', '/auth/verify/email', {
      body: { token: 'tok-success-0123456789abcdef' },
    });
    expect(replace.mock.calls.at(-1)?.[2]).toBe('/farms/verify-email');
    expect(screen.getByRole('link', { name: 'เข้าสู่ระบบ' }).getAttribute('href')).toBe(
      '/farms/sign-in',
    );
  });

  it('an expired link offers a new one', async () => {
    m.publicRequest.mockRejectedValueOnce(apiError(400, 'INVALID_VERIFICATION'));
    const user = userEvent.setup();
    renderAt('/farms/verify-email?token=tok-expired-0123456789abcdef');
    expect(
      await screen.findByRole('heading', { name: 'ลิงก์ยืนยันหมดอายุหรือไม่ถูกต้อง' }),
    ).toBeTruthy();
    await user.type(screen.getByLabelText(/อีเมล/), 'me@example.test');
    await user.click(screen.getByRole('button', { name: 'ส่งลิงก์ยืนยันใหม่' }));
    expect(m.publicRequest).toHaveBeenLastCalledWith('POST', '/auth/verify/resend', {
      body: { identifier: 'me@example.test' },
    });
    expect(await screen.findByText(/เราได้ส่งลิงก์ใหม่ให้แล้ว/)).toBeTruthy();
  });
});

describe('social sign-in buttons', () => {
  it('shows no buttons (and no divider) when the API offers no providers', async () => {
    renderAt('/farms/register');
    await waitFor(() => expect(m.oauthProviders).toHaveBeenCalled());
    await screen.findByRole('heading', { name: 'สมัครสมาชิก' });
    expect(screen.queryByRole('button', { name: /ดำเนินการต่อด้วย/ })).toBeNull();
    expect(screen.queryByText('หรือ')).toBeNull();
  });

  it('shows only the offered providers, on the register and the sign-in page', async () => {
    m.oauthProviders.mockResolvedValue(['facebook']);
    const { unmount } = renderAt('/farms/register');
    expect(await screen.findByRole('button', { name: 'ดำเนินการต่อด้วย Facebook' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'ดำเนินการต่อด้วย Google' })).toBeNull();
    unmount();

    m.oauthProviders.mockResolvedValue(['google', 'facebook']);
    renderAt('/farms/sign-in');
    expect(await screen.findByRole('button', { name: 'ดำเนินการต่อด้วย Google' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'ดำเนินการต่อด้วย Facebook' })).toBeTruthy();
    expect(screen.getByText('หรือ')).toBeTruthy();
    // Registration is linked below the form.
    expect(screen.getByRole('link', { name: 'สมัครสมาชิก' }).getAttribute('href')).toBe(
      '/farms/register',
    );
    // In English the sign-in form keeps its English wording.
    act(() => setLocale('en'));
    expect(screen.getByLabelText(/Email or phone/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeTruthy();
  });

  it('start: stores a 43-char verifier and sends the browser to the API with its SHA-256 challenge', async () => {
    m.oauthProviders.mockResolvedValue(['google', 'facebook']);
    const assign = vi.spyOn(browserNavigation, 'assign').mockImplementation(() => undefined);
    const user = userEvent.setup();
    render(
      <MemoryRouter
        initialEntries={[{ pathname: '/farms/sign-in', state: { from: '/farms/x/animals' } }]}
      >
        <AuthProvider>
          <Routes>
            <Route path="/farms/sign-in" element={<SignInPage />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );
    await user.click(await screen.findByRole('button', { name: 'ดำเนินการต่อด้วย Google' }));
    await waitFor(() => expect(assign).toHaveBeenCalledTimes(1));

    const url = new URL(String(assign.mock.calls[0]?.[0]), 'http://api.invalid');
    expect(url.pathname).toBe('/api/v1/auth/oauth/google/start');
    expect(url.searchParams.get('returnTo')).toBe(`${window.location.origin}/farms/oauth-callback`);
    const challenge = url.searchParams.get('challenge')!;
    expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const stored = JSON.parse(sessionStorage.getItem('farmplus.oauth')!) as {
      verifier: string;
      next?: string;
    };
    expect(stored.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(stored.next).toBe('/farms/x/animals');
    expect(challenge).toBe(createHash('sha256').update(stored.verifier).digest('base64url'));
  });
});

describe('social sign-in return page', () => {
  const VERIFIER = 'v'.repeat(43);
  const remember = (next?: string) =>
    sessionStorage.setItem('farmplus.oauth', JSON.stringify({ verifier: VERIFIER, next }));

  it('exchanges the ticket with the stored verifier, signs in and goes to the saved page', async () => {
    remember('/farms/x/dashboard');
    m.oauthExchange.mockResolvedValue({ status: 'authenticated', tokens: TOKENS, user: USER });
    const replace = vi.spyOn(window.history, 'replaceState');
    renderAt('/farms/oauth-callback?ticket=ticket-ok-0123456789abcdef');
    expect(await screen.findByText(/FARMS \/farms\/x\/dashboard สมชาย ใจดี/)).toBeTruthy();
    expect(m.oauthExchange).toHaveBeenCalledTimes(1);
    expect(m.oauthExchange).toHaveBeenCalledWith('ticket-ok-0123456789abcdef', VERIFIER);
    expect(replace.mock.calls.at(-1)?.[2]).toBe('/farms/oauth-callback');
    expect(sessionStorage.getItem('farmplus.oauth')).toBeNull();
    expect(sessionStorage.getItem('farmplus.refresh')).toBe(TOKENS.refreshToken);
  });

  it('goes to /farms when no page was saved', async () => {
    remember();
    m.oauthExchange.mockResolvedValue({ status: 'authenticated', tokens: TOKENS, user: USER });
    renderAt('/farms/oauth-callback?ticket=ticket-plain-0123456789abcdef');
    expect(await screen.findByText(/FARMS \/farms สมชาย ใจดี/)).toBeTruthy();
  });

  it('mfa_required continues to the existing code step, then signs in', async () => {
    setLocale('en'); // the code step is checked with its English labels
    remember();
    m.oauthExchange.mockResolvedValue({ status: 'mfa_required', mfaToken: 'm'.repeat(40) });
    m.verifyMfa.mockResolvedValue({ status: 'authenticated', tokens: TOKENS, user: USER });
    const user = userEvent.setup();
    renderAt('/farms/oauth-callback?ticket=ticket-mfa-0123456789abcdef');
    const field = await screen.findByLabelText(/Authenticator or recovery code/);
    await user.type(field, '123456');
    await user.click(screen.getByRole('button', { name: 'Verify' }));
    expect(await screen.findByText(/FARMS \/farms สมชาย ใจดี/)).toBeTruthy();
    expect(m.verifyMfa).toHaveBeenCalledWith('m'.repeat(40), '123456');
  });

  it('an expired ticket (INVALID_TICKET) asks to try again', async () => {
    remember();
    m.oauthExchange.mockRejectedValue(apiError(401, 'INVALID_TICKET'));
    renderAt('/farms/oauth-callback?ticket=ticket-old-0123456789abcdef');
    expect((await screen.findByRole('alert')).textContent).toBe(
      'การเข้าสู่ระบบหมดอายุ กรุณาลองใหม่',
    );
    expect(sessionStorage.getItem('farmplus.oauth')).toBeNull();
  });

  it('a ticket without a stored verifier (other tab / storage cleared) is treated as expired', async () => {
    renderAt('/farms/oauth-callback?ticket=ticket-nover-0123456789abcdef');
    expect((await screen.findByRole('alert')).textContent).toBe(
      'การเข้าสู่ระบบหมดอายุ กรุณาลองใหม่',
    );
    expect(m.oauthExchange).not.toHaveBeenCalled();
  });

  it.each([
    ['cancelled', 'การเข้าสู่ระบบถูกยกเลิก'],
    ['provider_error', 'ไม่สามารถเชื่อมต่อกับผู้ให้บริการได้ในขณะนี้ กรุณาลองใหม่อีกครั้ง'],
    [
      'account_exists',
      'อีเมลนี้มีบัญชีอยู่แล้ว กรุณาเข้าสู่ระบบด้วยรหัสผ่าน แล้วจึงเชื่อมต่อภายหลัง',
    ],
    ['account_suspended', 'บัญชีนี้ถูกระงับการใช้งาน กรุณาติดต่อผู้ดูแลระบบ'],
    ['account_deactivated', 'บัญชีนี้ถูกปิดการใช้งานแล้ว'],
  ])('?error=%s shows a Thai message and forgets the verifier', async (code, message) => {
    remember();
    const replace = vi.spyOn(window.history, 'replaceState');
    renderAt(`/farms/oauth-callback?error=${code}`);
    expect((await screen.findByRole('alert')).textContent).toBe(message);
    expect(replace.mock.calls.at(-1)?.[2]).toBe('/farms/oauth-callback');
    expect(sessionStorage.getItem('farmplus.oauth')).toBeNull();
    expect(m.oauthExchange).not.toHaveBeenCalled();
    expect(screen.getByRole('link', { name: 'กลับไปหน้าเข้าสู่ระบบ' })).toBeTruthy();
  });
});

describe('header', () => {
  it('signed out: a register link next to the unchanged sign-in link', () => {
    renderAs(<SiteHeader />, { status: 'anonymous', route: '/' });
    expect(screen.getByRole('link', { name: /เข้าสู่ระบบ/ }).getAttribute('href')).toBe(
      '/farms/sign-in',
    );
    expect(screen.getByRole('link', { name: 'สมัครสมาชิก' }).getAttribute('href')).toBe(
      '/farms/register',
    );
  });

  it('signed in: no register link', () => {
    m.request.mockResolvedValue({ cart: { itemCount: 0 }, categories: [] });
    renderAs(<SiteHeader />, { route: '/' });
    expect(screen.queryByRole('link', { name: 'สมัครสมาชิก' })).toBeNull();
  });
});
