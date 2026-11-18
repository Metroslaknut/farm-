import type { OAuthProviderId } from '@farmplus/api-client';
import { publicApi } from '../api';

/**
 * Social sign-in (Google / Facebook), browser side.
 *
 * Before leaving for the provider we generate a random verifier and send only its SHA-256 (the challenge). The verifier
 * stays in this tab's sessionStorage; the return page trades the one-time ticket together with the verifier, so a
 * ticket that leaks from the address bar (history, referrer) is useless on its own.
 */
const STORAGE_KEY = 'farmplus.oauth';

export const OAUTH_CALLBACK_PATH = '/farms/oauth-callback';

interface PendingSocialSignIn {
  verifier: string;
  next?: string;
}

export function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** 32 random bytes → 43 base64url characters. */
export function createVerifier(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}

/** base64url(SHA-256(verifier)) — 43 characters. */
export async function challengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

/** Only same-site paths are ever followed after sign-in (never `//host` or a full URL). */
export function safeNext(next: string | undefined | null): string | undefined {
  return next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\')
    ? next
    : undefined;
}

/** Leaving the app for the provider (a seam so tests can observe it). */
export const browserNavigation = {
  assign(url: string): void {
    window.location.assign(url);
  },
};

/** Remember the verifier (and where to go afterwards), then leave for the provider via the API. */
export async function startSocialSignIn(provider: OAuthProviderId, next?: string): Promise<void> {
  const verifier = createVerifier();
  const challenge = await challengeFor(verifier);
  const pending: PendingSocialSignIn = { verifier };
  const target = safeNext(next);
  if (target) pending.next = target;
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(pending));
  browserNavigation.assign(
    publicApi.oauthStartUrl(provider, `${window.location.origin}${OAUTH_CALLBACK_PATH}`, challenge),
  );
}

/** Read and forget the pending sign-in (one use only). */
export function takePendingSocialSignIn(): PendingSocialSignIn | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    sessionStorage.removeItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PendingSocialSignIn>;
    if (typeof parsed.verifier !== 'string') return null;
    const next = safeNext(parsed.next);
    return next ? { verifier: parsed.verifier, next } : { verifier: parsed.verifier };
  } catch {
    return null;
  }
}
