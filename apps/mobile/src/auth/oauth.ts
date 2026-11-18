import type { OAuthProviderId } from '@farmplus/api-client';
import type { LoginResponse } from '@farmplus/shared-types';
import { t } from '@/i18n';
import { errorText } from '@/lib/messages';
import type { SecureStoreLike } from './token-storage';

/**
 * Social sign-in (Google / Facebook) — pure logic, no Expo imports, so it is unit-tested in Node.
 * The Expo bindings (expo-crypto, expo-web-browser) live in oauth-native.ts.
 *
 * Flow: random verifier → challenge = base64url(SHA-256(verifier)) → in-app auth session on the API's start URL →
 * the API redirects to farmplus://oauth-callback?ticket=… (or ?error=…) → exchange ticket + verifier for a session.
 */

export const OAUTH_RETURN_URL = 'farmplus://oauth-callback';
export const OAUTH_PROVIDERS: readonly OAuthProviderId[] = ['google', 'facebook'];

/** Error codes the API puts on the return URL (never any detail). */
export type OAuthErrorCode =
  'cancelled' | 'provider_error' | 'account_exists' | 'account_suspended' | 'account_deactivated';

/** Message keys (auth catalog) per error code; resolved when shown, in the current language. */
const ERROR_MESSAGES = {
  cancelled: 'oauth.cancelled',
  provider_error: 'oauth.providerError',
  account_exists: 'oauth.accountExists',
  account_suspended: 'oauth.accountSuspended',
  account_deactivated: 'oauth.accountDeactivated',
} as const satisfies Record<OAuthErrorCode, string>;
const genericError = () => t('auth', 'oauth.generic');

export function oauthErrorMessage(code: string): string {
  const key = (ERROR_MESSAGES as Record<string, (typeof ERROR_MESSAGES)[OAuthErrorCode]>)[code];
  return key ? t('auth', key) : genericError();
}

/** RFC 4648 §5 base64url without padding. */
export function base64url(bytes: Uint8Array): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]!;
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    out += alphabet[b0 >> 2]!;
    out += alphabet[((b0 & 0x03) << 4) | ((b1 ?? 0) >> 4)]!;
    if (b1 !== undefined) out += alphabet[((b1 & 0x0f) << 2) | ((b2 ?? 0) >> 6)]!;
    if (b2 !== undefined) out += alphabet[b2 & 0x3f]!;
  }
  return out;
}

/** 32 random bytes → a 43-character base64url verifier. */
export function createVerifier(randomBytes: (count: number) => Uint8Array): string {
  return base64url(randomBytes(32));
}

/** SHA-256 of some bytes (expo-crypto `digest` in the app, WebCrypto in tests). */
export type Sha256 = (data: Uint8Array<ArrayBuffer>) => Promise<ArrayBuffer | Uint8Array>;

/** base64url(SHA-256(verifier as UTF-8)) — identical to Node's createHash('sha256').update(v).digest('base64url'). */
export async function challengeFor(verifier: string, sha256: Sha256): Promise<string> {
  const hash = await sha256(new TextEncoder().encode(verifier));
  return base64url(hash instanceof Uint8Array ? hash : new Uint8Array(hash));
}

export type OAuthCallback = { ticket: string } | { error: string };

/** Parse farmplus://oauth-callback?ticket=…|error=… (also exp://…/--/oauth-callback). Null when it is not one. */
export function parseOAuthCallback(url: string | null | undefined): OAuthCallback | null {
  if (!url) return null;
  const match =
    /^(?:farmplus:\/\/|exp(?:\+[a-z0-9-]+)?:\/\/[^/]+\/--\/)\/*oauth-callback\/?(?:\?([^#]*))?(?:#.*)?$/i.exec(
      url.trim(),
    );
  if (!match) return null;
  return callbackFromParams(new URLSearchParams(match[1] ?? ''));
}

/** The callback from already-split query parameters; unknown error codes become provider_error. */
export function callbackFromParams(params: {
  get(name: string): string | null | undefined;
}): OAuthCallback {
  const ticket = params.get('ticket');
  if (ticket && /^[A-Za-z0-9_-]{20,200}$/.test(ticket)) return { ticket };
  const error = params.get('error');
  return { error: error && error in ERROR_MESSAGES ? error : 'provider_error' };
}

// ---- pending verifier (kept while the auth session is open, so the Android deep-link fallback can finish the flow)

export interface PendingVerifierStore {
  set(verifier: string): Promise<void>;
  /** Returns and forgets the verifier (single use). Null when none or expired. */
  take(): Promise<string | null>;
  clear(): Promise<void>;
}

export const PENDING_VERIFIER_KEY = 'farmplus.oauth_verifier';
const PENDING_TTL_MS = 10 * 60_000;

/** Memory first; mirrored to the secure store (if given) so it survives Android killing the app behind the browser. */
export function createPendingVerifierStore(
  store?: SecureStoreLike,
  now: () => number = Date.now,
): PendingVerifierStore {
  let memory: { verifier: string; at: number } | null = null;
  let queue: Promise<unknown> = Promise.resolve();
  const options = store ? { keychainAccessible: store.WHEN_UNLOCKED_THIS_DEVICE_ONLY } : undefined;
  const fresh = (v: { verifier: string; at: number } | null) =>
    v && now() - v.at < PENDING_TTL_MS && /^[A-Za-z0-9_-]{43,128}$/.test(v.verifier) ? v : null;
  const clear = async () => {
    memory = null;
    await store?.deleteItemAsync(PENDING_VERIFIER_KEY, options).catch(() => undefined);
  };
  return {
    async set(verifier) {
      memory = { verifier, at: now() };
      await store
        ?.setItemAsync(PENDING_VERIFIER_KEY, JSON.stringify(memory), options)
        .catch(() => undefined);
    },
    take() {
      // Serialised: the auth-session result and the deep-link screen may ask at the same moment; only one gets it.
      const run = queue.then(takeNow);
      queue = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    },
    clear,
  };
  async function takeNow(): Promise<string | null> {
    let entry = memory;
    if (!entry && store) {
      const raw = await store.getItemAsync(PENDING_VERIFIER_KEY, options).catch(() => null);
      try {
        entry = raw ? (JSON.parse(raw) as { verifier: string; at: number }) : null;
      } catch {
        entry = null;
      }
    }
    await clear();
    return fresh(entry)?.verifier ?? null;
  }
}

// ---- orchestration

export type OAuthOutcome =
  | { status: 'authenticated' }
  | { status: 'mfa_required' }
  | { status: 'cancelled' }
  | { status: 'error'; message: string };

export interface OAuthDeps {
  api: {
    oauthStartUrl(provider: OAuthProviderId, returnTo: string, challenge: string): string;
    oauthExchange(ticket: string, verifier: string): Promise<LoginResponse>;
  };
  /** expo-web-browser openAuthSessionAsync. */
  openAuthSession(url: string, redirectUrl: string): Promise<{ type: string; url?: string }>;
  randomBytes(count: number): Uint8Array;
  sha256: Sha256;
  pending: PendingVerifierStore;
  /** Hand a login result to the session (the same path as the password login). */
  completeLogin(res: LoginResponse): Promise<'authenticated' | 'mfa_required'>;
}

function errorMessageOf(e: unknown): string {
  const err = e as { name?: string; status?: number; message?: string } | null;
  if (err?.name === 'ApiClientError' && err.status === undefined) return t('auth', 'oauth.offline');
  if (err?.status === 401) return t('auth', 'oauth.expired');
  // The server explains a refusal (suspended…): its message in English, by error code in Thai.
  if (err?.status === 403 && err.message) return errorText(e);
  return genericError();
}

/** Exchange a callback (ticket or error) for a session. Shared by the auth-session path and the deep-link fallback. */
export async function completeOAuthCallback(
  callback: OAuthCallback,
  verifier: string,
  deps: Pick<OAuthDeps, 'api' | 'completeLogin'>,
): Promise<OAuthOutcome> {
  if ('error' in callback) return { status: 'error', message: oauthErrorMessage(callback.error) };
  try {
    const res = await deps.api.oauthExchange(callback.ticket, verifier);
    return { status: await deps.completeLogin(res) };
  } catch (e) {
    return { status: 'error', message: errorMessageOf(e) };
  }
}

export async function signInWithProvider(
  provider: OAuthProviderId,
  deps: OAuthDeps,
): Promise<OAuthOutcome> {
  const verifier = createVerifier(deps.randomBytes);
  const challenge = await challengeFor(verifier, deps.sha256);
  await deps.pending.set(verifier);
  let result: { type: string; url?: string };
  try {
    result = await deps.openAuthSession(
      deps.api.oauthStartUrl(provider, OAUTH_RETURN_URL, challenge),
      OAUTH_RETURN_URL,
    );
  } catch {
    await deps.pending.clear();
    return { status: 'error', message: genericError() };
  }
  if (result.type !== 'success') {
    // 'cancel' / 'dismiss': the user closed the sheet. On Android the redirect may still arrive as a deep link
    // (app/oauth-callback.tsx), so the pending verifier is kept for it there; it expires on its own.
    if (result.type === 'cancel' || result.type === 'dismiss') return { status: 'cancelled' };
    await deps.pending.clear();
    return { status: 'cancelled' };
  }
  // Consume the verifier: whichever path (this one or the deep link) gets it first finishes the flow.
  const pendingVerifier = await deps.pending.take();
  if (!pendingVerifier) return { status: 'cancelled' }; // already completed by the deep-link screen
  const callback = parseOAuthCallback(result.url);
  if (!callback) return { status: 'error', message: genericError() };
  return completeOAuthCallback(callback, pendingVerifier, deps);
}

/** Only the providers this app knows how to draw, in a stable order. */
export function supportedProviders(list: readonly string[]): OAuthProviderId[] {
  return OAUTH_PROVIDERS.filter((p) => list.includes(p));
}
