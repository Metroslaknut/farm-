import type { AuthTokens } from '@farmplus/shared-types';
import { forgetRecent } from '../lib/shared';

/**
 * Token handling for the browser.
 *  - access token: memory only (gone on reload, short-lived)
 *  - refresh token: sessionStorage (scoped to this tab, cleared when it closes).
 *    Trade-off: readable by injected scripts (XSS). An httpOnly cookie is the stronger option and is
 *    listed as a follow-up in docs/architecture/auth.md.
 */
const REFRESH_KEY = 'farmplus.refresh';
let accessToken: string | null = null;
const listeners = new Set<() => void>();

function readRefresh(): string | null {
  try {
    return sessionStorage.getItem(REFRESH_KEY);
  } catch {
    return null;
  }
}

export const tokenStore = {
  getAccess: (): string | null => accessToken,
  getRefresh: readRefresh,
  set(tokens: AuthTokens): void {
    // A different user may be signing in: nothing read for the previous session is reused.
    if (tokens.accessToken !== accessToken) forgetRecent();
    accessToken = tokens.accessToken;
    try {
      sessionStorage.setItem(REFRESH_KEY, tokens.refreshToken);
    } catch {
      /* storage unavailable: session lasts until reload */
    }
  },
  clear(): void {
    forgetRecent();
    accessToken = null;
    try {
      sessionStorage.removeItem(REFRESH_KEY);
    } catch {
      /* ignore */
    }
  },
  /** Fired when the session could not be refreshed and tokens were dropped. */
  onSessionLost(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  notifySessionLost(): void {
    listeners.forEach((l) => l());
  },
};
