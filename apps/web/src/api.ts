import { createApiClient, type ApiClient } from '@farmplus/api-client';
import { forgetRecent } from './lib/shared';
import { tokenStore } from './auth/tokens';

const baseUrl = import.meta.env.VITE_API_BASE_URL ?? '';

/** Unauthenticated calls only (login, refresh). */
export const publicApi = createApiClient({ baseUrl });

let inflight: Promise<boolean> | null = null;

/** Exchange the refresh token for new tokens. Concurrent callers share one request (tokens are single-use). */
export function refreshSession(): Promise<boolean> {
  inflight ??= (async () => {
    const refreshToken = tokenStore.getRefresh();
    if (!refreshToken) return false;
    try {
      tokenStore.set(await publicApi.refresh(refreshToken));
      return true;
    } catch (error) {
      // Only a definitive rejection ends the session; a network error, 429 or 5xx keeps the refresh token.
      if (isRejection(error)) {
        tokenStore.clear();
        tokenStore.notifySessionLost();
      }
      return false;
    }
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}

/**
 * 400/401/403 from the API mean the token is invalid. Anything else — no status (never reached the server), 429 (rate
 * limited), 408 or a 5xx — is temporary and must not sign the user out.
 */
const REJECTED = new Set([400, 401, 403]);
function isRejection(error: unknown): boolean {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === 'number' && REJECTED.has(status);
}

const client = createApiClient({
  baseUrl,
  getAccessToken: tokenStore.getAccess,
  onUnauthorized: refreshSession,
});

export const api: ApiClient = {
  ...client,
  // Any change the user makes may affect what pages reuse for a few seconds (`sharedRecent`): drop it before the
  // change and again once it has settled, so nothing read in between is kept.
  request<T>(...args: Parameters<ApiClient['request']>): Promise<T> {
    if (args[0] === 'GET') return client.request<T>(...args);
    forgetRecent();
    return client.request<T>(...args).finally(forgetRecent);
  },
};

/** URL for a file the API serves itself (paths such as `/api/v1/animal-photos/…`); other URLs are returned unchanged. */
export const apiFileUrl = (url: string): string => (url.startsWith('/') ? `${baseUrl}${url}` : url);
