import { describe, expect, it, vi } from 'vitest';
import { createSessionManager } from '../src/auth/session-manager';
import {
  REFRESH_TOKEN_KEY,
  createMemoryTokenStorage,
  createSecureTokenStorage,
  type SecureStoreLike,
} from '../src/auth/token-storage';

function fakeStore(overrides: Partial<SecureStoreLike> = {}) {
  const data = new Map<string, string>();
  const calls: { fn: string; key: string; options?: object }[] = [];
  const store: SecureStoreLike = {
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 6,
    isAvailableAsync: async () => true,
    getItemAsync: async (key, options) => (
      calls.push({ fn: 'get', key, ...(options ? { options } : {}) }),
      data.get(key) ?? null
    ),
    setItemAsync: async (key, value, options) =>
      void (calls.push({ fn: 'set', key, ...(options ? { options } : {}) }), data.set(key, value)),
    deleteItemAsync: async (key, options) =>
      void (calls.push({ fn: 'delete', key, ...(options ? { options } : {}) }), data.delete(key)),
    ...overrides,
  };
  return { store, data, calls };
}
const tokens = (n: number) => ({
  tokenType: 'Bearer' as const,
  accessToken: `access-${n}`,
  refreshToken: `refresh-${n}`,
  expiresIn: 900,
});

describe('secure token storage', () => {
  it('stores the refresh token in the secure store, device-only, under a namespaced key', async () => {
    const { store, data, calls } = fakeStore();
    const storage = await createSecureTokenStorage(store);
    expect(storage.persistent).toBe(true);
    await storage.setRefreshToken('r1');
    expect(data.get(REFRESH_TOKEN_KEY)).toBe('r1');
    expect(await storage.getRefreshToken()).toBe('r1');
    for (const call of calls) expect(call.options).toEqual({ keychainAccessible: 6 }); // WHEN_UNLOCKED_THIS_DEVICE_ONLY
    await storage.clear();
    expect(await storage.getRefreshToken()).toBeNull();
  });

  it('falls back to memory-only where no secure store exists (never a plain persistent store)', async () => {
    const { store, data } = fakeStore({ isAvailableAsync: async () => false });
    const storage = await createSecureTokenStorage(store);
    expect(storage.persistent).toBe(false);
    await storage.setRefreshToken('r1');
    expect(await storage.getRefreshToken()).toBe('r1');
    expect(data.size).toBe(0);
  });

  it('a failing keystore read means "signed out", not a crash', async () => {
    const { store } = fakeStore({
      getItemAsync: async () => {
        throw new Error('keystore corrupted');
      },
    });
    const storage = await createSecureTokenStorage(store);
    await expect(storage.getRefreshToken()).resolves.toBeNull();
  });

  it('survives isAvailableAsync throwing', async () => {
    const { store } = fakeStore({
      isAvailableAsync: async () => {
        throw new Error('boom');
      },
    });
    expect((await createSecureTokenStorage(store)).persistent).toBe(false);
  });
});

describe('session manager', () => {
  const setup = (exchange = vi.fn(async (t: string) => tokens(Number(t.split('-')[1]) + 1))) => {
    const storage = createMemoryTokenStorage();
    const session = createSessionManager({ storage, exchange });
    return { storage, session, exchange };
  };

  it('keeps the access token in memory only; only the refresh token is persisted', async () => {
    const { storage, session } = setup();
    await session.setTokens(tokens(1));
    expect(session.getAccessToken()).toBe('access-1');
    expect(await storage.getRefreshToken()).toBe('refresh-1');
    expect(JSON.stringify(storage)).not.toContain('access-1');
  });

  it('restore() turns a stored refresh token into a session and rotates it', async () => {
    const { storage, session, exchange } = setup();
    await storage.setRefreshToken('refresh-1');
    expect(await session.restore()).toBe(true);
    expect(exchange).toHaveBeenCalledWith('refresh-1');
    expect(session.getAccessToken()).toBe('access-2');
    expect(await storage.getRefreshToken()).toBe('refresh-2'); // single-use token replaced
  });

  it('restore() is false with nothing stored (no network call)', async () => {
    const { session, exchange } = setup();
    expect(await session.restore()).toBe(false);
    expect(exchange).not.toHaveBeenCalled();
  });

  it('concurrent refreshes share ONE request (refresh tokens are single-use)', async () => {
    const { storage, session, exchange } = setup();
    await storage.setRefreshToken('refresh-1');
    const results = await Promise.all([session.refresh(), session.refresh(), session.refresh()]);
    expect(results).toEqual([true, true, true]);
    expect(exchange).toHaveBeenCalledTimes(1);
  });

  it('a server rejection (4xx) ends the session: tokens wiped, listeners notified', async () => {
    const reject = vi.fn(async () => {
      throw Object.assign(new Error('invalid'), { status: 401 });
    });
    const { storage, session } = setup(reject);
    await storage.setRefreshToken('refresh-1');
    await session.setTokens(tokens(1));
    const lost = vi.fn();
    session.onSessionLost(lost);
    expect(await session.refresh()).toBe(false);
    expect(session.getAccessToken()).toBeNull();
    expect(await storage.getRefreshToken()).toBeNull();
    expect(lost).toHaveBeenCalledTimes(1);
  });

  it('being offline does NOT sign the user out (token kept for the next attempt)', async () => {
    const offline = vi.fn(async () => {
      throw new Error('Unable to reach the FARM+ API');
    }); // no status
    const { storage, session } = setup(offline);
    await storage.setRefreshToken('refresh-1');
    const lost = vi.fn();
    session.onSessionLost(lost);
    expect(await session.refresh()).toBe(false);
    expect(await storage.getRefreshToken()).toBe('refresh-1');
    expect(lost).not.toHaveBeenCalled();
  });

  it('a server error (5xx) also keeps the token', async () => {
    const down = vi.fn(async () => {
      throw Object.assign(new Error('bad gateway'), { status: 502 });
    });
    const { storage, session } = setup(down);
    await storage.setRefreshToken('refresh-1');
    await session.refresh();
    expect(await storage.getRefreshToken()).toBe('refresh-1');
  });

  it('clear() (sign out) wipes both tokens', async () => {
    const { storage, session } = setup();
    await session.setTokens(tokens(1));
    await session.clear();
    expect(session.getAccessToken()).toBeNull();
    expect(await storage.getRefreshToken()).toBeNull();
  });

  it('a later refresh works after an earlier one finished', async () => {
    const { storage, session, exchange } = setup();
    await storage.setRefreshToken('refresh-1');
    await session.refresh();
    await session.refresh();
    expect(exchange).toHaveBeenCalledTimes(2);
    expect(exchange).toHaveBeenLastCalledWith('refresh-2');
  });
});
