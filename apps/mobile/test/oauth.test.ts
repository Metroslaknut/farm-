import { createHash, randomBytes, webcrypto } from 'node:crypto';
import type { LoginResponse } from '@farmplus/shared-types';
import { describe, expect, it, vi } from 'vitest';
import {
  OAUTH_RETURN_URL,
  PENDING_VERIFIER_KEY,
  base64url,
  callbackFromParams,
  challengeFor,
  createPendingVerifierStore,
  createVerifier,
  oauthErrorMessage,
  parseOAuthCallback,
  signInWithProvider,
  supportedProviders,
  type OAuthDeps,
} from '../src/auth/oauth';
import type { SecureStoreLike } from '../src/auth/token-storage';

/** Stand-in for expo-crypto `digest(SHA256, bytes)` — same contract: bytes in, ArrayBuffer out. */
const sha256 = (data: Uint8Array<ArrayBuffer>) => webcrypto.subtle.digest('SHA-256', data);
const TICKET = 't'.repeat(43);

describe('base64url', () => {
  it.each([0, 1, 2, 3, 31, 32, 33, 64])('matches Node for %i random bytes', (n) => {
    const bytes = new Uint8Array(randomBytes(n));
    expect(base64url(bytes)).toBe(Buffer.from(bytes).toString('base64url'));
  });
  it('uses the URL-safe alphabet without padding', () => {
    expect(base64url(new Uint8Array([0xfb, 0xff, 0xbf]))).toBe('-_-_');
    expect(base64url(new Uint8Array([0xff]))).toBe('_w');
  });
});

describe('PKCE verifier and challenge', () => {
  it('verifier is 32 random bytes → 43 base64url characters (accepted by the API)', () => {
    const v = createVerifier((n) => new Uint8Array(randomBytes(n)));
    expect(v).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('challenge equals Node createHash(sha256).digest(base64url) — fixed vector', async () => {
    const verifier = base64url(new Uint8Array(32).map((_, i) => i)); // AAECAwQF…
    const expected = createHash('sha256').update(verifier).digest('base64url');
    expect(expected).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await challengeFor(verifier, sha256)).toBe(expected);
  });

  it('challenge equals Node for random verifiers and accepts a Uint8Array digest too', async () => {
    for (let i = 0; i < 20; i++) {
      const v = createVerifier((n) => new Uint8Array(randomBytes(n)));
      const expected = createHash('sha256').update(v).digest('base64url');
      expect(await challengeFor(v, sha256)).toBe(expected);
      expect(await challengeFor(v, async (d) => new Uint8Array(await sha256(d)))).toBe(expected);
    }
  });
});

describe('callback URL parsing', () => {
  it.each([
    [`farmplus://oauth-callback?ticket=${TICKET}`, { ticket: TICKET }],
    [`farmplus://oauth-callback/?ticket=${TICKET}#_=_`, { ticket: TICKET }], // Facebook appends #_=_
    [`exp://192.168.1.2:8081/--/oauth-callback?ticket=${TICKET}`, { ticket: TICKET }],
    ['farmplus://oauth-callback?error=account_exists', { error: 'account_exists' }],
    ['farmplus://oauth-callback?error=cancelled', { error: 'cancelled' }],
    ['farmplus://oauth-callback?error=<script>', { error: 'provider_error' }],
    ['farmplus://oauth-callback?ticket=short', { error: 'provider_error' }],
    ['farmplus://oauth-callback', { error: 'provider_error' }],
  ])('%s', (url, expected) => {
    expect(parseOAuthCallback(url)).toEqual(expected);
  });

  it.each([
    undefined,
    '',
    `farmplus://farm/1?ticket=${TICKET}`,
    `https://evil.example/oauth-callback?ticket=${TICKET}`,
    `farmplus://oauth-callbackX?ticket=${TICKET}`,
  ])('not a callback: %j', (url) => {
    expect(parseOAuthCallback(url)).toBeNull();
  });

  it('callbackFromParams prefers a valid ticket', () => {
    expect(callbackFromParams(new URLSearchParams({ ticket: TICKET, error: 'cancelled' }))).toEqual(
      {
        ticket: TICKET,
      },
    );
  });

  it('error codes map to readable messages', () => {
    expect(oauthErrorMessage('account_exists')).toBe(
      'An account with this email already exists. Sign in with your password.',
    );
    expect(oauthErrorMessage('account_suspended')).toMatch(/suspended/);
    expect(oauthErrorMessage('account_deactivated')).toMatch(/deactivated/);
    expect(oauthErrorMessage('provider_error')).toMatch(/try again/);
    expect(oauthErrorMessage('cancelled')).toMatch(/cancelled/);
    expect(oauthErrorMessage('whatever')).toMatch(/try again/);
  });

  it('only known providers are drawn, in a stable order', () => {
    expect(supportedProviders(['facebook', 'twitter', 'google'])).toEqual(['google', 'facebook']);
    expect(supportedProviders([])).toEqual([]);
  });
});

// ---- orchestration

const authenticated: LoginResponse = {
  status: 'authenticated',
  tokens: { tokenType: 'Bearer', accessToken: 'a', refreshToken: 'r'.repeat(40), expiresIn: 900 },
  user: {} as never,
} as LoginResponse;

function setup(
  result: { type: string; url?: string } | Error,
  exchange: () => Promise<LoginResponse> = async () => authenticated,
) {
  const tokensSet: LoginResponse[] = [];
  const deps = {
    api: {
      oauthStartUrl: vi.fn(
        (p: string, r: string, c: string) =>
          `https://api.example/api/v1/auth/oauth/${p}/start?returnTo=${encodeURIComponent(r)}&challenge=${c}`,
      ),
      oauthExchange: vi.fn(exchange),
    },
    openAuthSession: vi.fn(async () => {
      if (result instanceof Error) throw result;
      return result;
    }),
    randomBytes: (n: number) => new Uint8Array(n).fill(7),
    sha256,
    pending: createPendingVerifierStore(),
    // Same contract as AuthProvider.completeLogin (session.setTokens for 'authenticated').
    completeLogin: vi.fn(async (res: LoginResponse) => {
      if (res.status === 'mfa_required') return 'mfa_required' as const;
      tokensSet.push(res);
      return 'authenticated' as const;
    }),
  } satisfies OAuthDeps;
  return { deps, tokensSet };
}

describe('signInWithProvider', () => {
  const verifier = base64url(new Uint8Array(32).fill(7));
  const challenge = createHash('sha256').update(verifier).digest('base64url');

  it('success: opens the auth session with the challenge, exchanges the ticket, sets the session', async () => {
    const { deps, tokensSet } = setup({
      type: 'success',
      url: `${OAUTH_RETURN_URL}?ticket=${TICKET}`,
    });
    await expect(signInWithProvider('google', deps)).resolves.toEqual({ status: 'authenticated' });
    expect(deps.api.oauthStartUrl).toHaveBeenCalledWith('google', OAUTH_RETURN_URL, challenge);
    expect(deps.openAuthSession).toHaveBeenCalledWith(
      expect.stringContaining(`challenge=${challenge}`),
      'farmplus://oauth-callback',
    );
    expect(deps.api.oauthExchange).toHaveBeenCalledWith(TICKET, verifier);
    expect(tokensSet).toEqual([authenticated]);
    expect(await deps.pending.take()).toBeNull(); // verifier consumed
  });

  it.each(['cancel', 'dismiss'])('%s: nothing is exchanged, no message', async (type) => {
    const { deps } = setup({ type });
    await expect(signInWithProvider('facebook', deps)).resolves.toEqual({ status: 'cancelled' });
    expect(deps.api.oauthExchange).not.toHaveBeenCalled();
    expect(deps.completeLogin).not.toHaveBeenCalled();
  });

  it.each([
    ['account_exists', 'An account with this email already exists. Sign in with your password.'],
    ['account_suspended', oauthErrorMessage('account_suspended')],
    ['provider_error', oauthErrorMessage('provider_error')],
  ])('error=%s on the return URL → readable message, no exchange', async (code, message) => {
    const { deps } = setup({ type: 'success', url: `${OAUTH_RETURN_URL}?error=${code}` });
    await expect(signInWithProvider('google', deps)).resolves.toEqual({ status: 'error', message });
    expect(deps.api.oauthExchange).not.toHaveBeenCalled();
  });

  it('mfa_required: handed to the MFA step, no tokens set', async () => {
    const { deps, tokensSet } = setup(
      { type: 'success', url: `${OAUTH_RETURN_URL}?ticket=${TICKET}` },
      async () => ({ status: 'mfa_required', mfaToken: 'm'.repeat(40) }),
    );
    await expect(signInWithProvider('google', deps)).resolves.toEqual({ status: 'mfa_required' });
    expect(deps.completeLogin).toHaveBeenCalledWith({
      status: 'mfa_required',
      mfaToken: 'm'.repeat(40),
    });
    expect(tokensSet).toEqual([]);
  });

  it('ticket exchange failure → message, no session', async () => {
    const { deps, tokensSet } = setup(
      { type: 'success', url: `${OAUTH_RETURN_URL}?ticket=${TICKET}` },
      async () => {
        throw Object.assign(new Error('This sign-in has expired.'), {
          name: 'ApiClientError',
          status: 401,
          code: 'INVALID_TICKET',
        });
      },
    );
    await expect(signInWithProvider('google', deps)).resolves.toEqual({
      status: 'error',
      message: 'This sign-in has expired. Please try again.',
    });
    expect(tokensSet).toEqual([]);
  });

  it('exchange offline → connection message', async () => {
    const { deps } = setup(
      { type: 'success', url: `${OAUTH_RETURN_URL}?ticket=${TICKET}` },
      async () => {
        throw Object.assign(new Error('Unable to reach'), { name: 'ApiClientError' });
      },
    );
    const out = await signInWithProvider('google', deps);
    expect(out).toEqual({ status: 'error', message: expect.stringMatching(/connection/) });
  });

  it('auth session throws → generic error and the pending verifier is cleared', async () => {
    const { deps } = setup(new Error('no browser'));
    expect((await signInWithProvider('google', deps)).status).toBe('error');
    expect(await deps.pending.take()).toBeNull();
  });

  it('already completed by the deep-link screen → no second exchange', async () => {
    const { deps } = setup({ type: 'success', url: `${OAUTH_RETURN_URL}?ticket=${TICKET}` });
    deps.openAuthSession.mockImplementationOnce(async () => {
      await deps.pending.take(); // the Android deep-link fallback won the race
      return { type: 'success', url: `${OAUTH_RETURN_URL}?ticket=${TICKET}` };
    });
    await expect(signInWithProvider('google', deps)).resolves.toEqual({ status: 'cancelled' });
    expect(deps.api.oauthExchange).not.toHaveBeenCalled();
  });
});

describe('pending verifier store', () => {
  function fakeStore() {
    const data = new Map<string, string>();
    const store: SecureStoreLike = {
      WHEN_UNLOCKED_THIS_DEVICE_ONLY: 6,
      isAvailableAsync: async () => true,
      getItemAsync: async (k) => data.get(k) ?? null,
      setItemAsync: async (k, v) => void data.set(k, v),
      deleteItemAsync: async (k) => void data.delete(k),
    };
    return { store, data };
  }
  const v = 'v'.repeat(43);

  it('is single-use, also when asked twice at once', async () => {
    const { store } = fakeStore();
    const pending = createPendingVerifierStore(store);
    await pending.set(v);
    const results = await Promise.all([pending.take(), pending.take()]);
    expect(results.sort()).toEqual([null, v].sort());
  });

  it('survives a restart through the secure store, then is removed', async () => {
    const { store, data } = fakeStore();
    await createPendingVerifierStore(store).set(v);
    expect(data.has(PENDING_VERIFIER_KEY)).toBe(true);
    expect(await createPendingVerifierStore(store).take()).toBe(v); // "new process"
    expect(data.has(PENDING_VERIFIER_KEY)).toBe(false);
  });

  it('expires after 10 minutes', async () => {
    let t = 0;
    const pending = createPendingVerifierStore(undefined, () => t);
    await pending.set(v);
    t = 10 * 60_000 + 1;
    expect(await pending.take()).toBeNull();
  });
});
