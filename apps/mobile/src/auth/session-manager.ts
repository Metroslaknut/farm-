import type { AuthTokens } from '@farmplus/shared-types';
import type { TokenStorage } from './token-storage';

export interface SessionManager {
  getAccessToken(): string | null;
  /** Persist a fresh login/refresh result. */
  setTokens(tokens: AuthTokens): Promise<void>;
  /** Try to turn the stored refresh token into a session (app launch). */
  restore(): Promise<boolean>;
  /** Single-flight refresh: concurrent callers share one request (refresh tokens are single-use). */
  refresh(): Promise<boolean>;
  clear(): Promise<void>;
  onSessionLost(listener: () => void): () => void;
}

export interface SessionDeps {
  storage: TokenStorage;
  /** Exchange a refresh token for new tokens. Must throw when rejected. */
  exchange: (refreshToken: string) => Promise<AuthTokens>;
}

export function createSessionManager({ storage, exchange }: SessionDeps): SessionManager {
  let accessToken: string | null = null;
  let inflight: Promise<boolean> | null = null;
  const listeners = new Set<() => void>();

  const manager: SessionManager = {
    getAccessToken: () => accessToken,

    async setTokens(tokens) {
      accessToken = tokens.accessToken;
      await storage.setRefreshToken(tokens.refreshToken);
    },

    async clear() {
      accessToken = null;
      await storage.clear();
    },

    refresh() {
      inflight ??= (async () => {
        const refreshToken = await storage.getRefreshToken();
        if (!refreshToken) return false;
        try {
          await manager.setTokens(await exchange(refreshToken));
          return true;
        } catch (error) {
          // Only a definitive rejection ends the session. A network failure keeps the stored token
          // so the user is not signed out just because they were offline.
          if (isRejection(error)) {
            await manager.clear();
            listeners.forEach((l) => l());
          }
          return false;
        }
      })().finally(() => {
        inflight = null;
      });
      return inflight;
    },

    restore: () => manager.refresh(),

    onSessionLost(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return manager;
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
