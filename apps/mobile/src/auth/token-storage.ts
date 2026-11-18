/** Where the refresh token lives between launches. The access token is never persisted. */
export interface TokenStorage {
  /** True if tokens survive an app restart (false for the in-memory fallback). */
  readonly persistent: boolean;
  getRefreshToken(): Promise<string | null>;
  setRefreshToken(token: string): Promise<void>;
  clear(): Promise<void>;
}

/** Minimal surface of expo-secure-store that we use (lets tests inject a fake). */
export interface SecureStoreLike {
  isAvailableAsync(): Promise<boolean>;
  getItemAsync(key: string, options?: object): Promise<string | null>;
  setItemAsync(key: string, value: string, options?: object): Promise<void>;
  deleteItemAsync(key: string, options?: object): Promise<void>;
  /** iOS: only readable while unlocked, never migrated to another device or backup. */
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: number;
}

export const REFRESH_TOKEN_KEY = 'farmplus.refresh_token';

export function createMemoryTokenStorage(): TokenStorage {
  let token: string | null = null;
  return {
    persistent: false,
    getRefreshToken: async () => token,
    setRefreshToken: async (value) => void (token = value),
    clear: async () => void (token = null),
  };
}

/**
 * Hardware-backed storage: iOS Keychain / Android Keystore (via EncryptedSharedPreferences).
 * Never AsyncStorage or plain files. If the platform has no secure store (Expo web), fall back to memory only —
 * the user signs in again next launch rather than leaving a token in readable storage.
 */
export async function createSecureTokenStorage(store: SecureStoreLike): Promise<TokenStorage> {
  if (!(await store.isAvailableAsync().catch(() => false))) return createMemoryTokenStorage();
  const options = { keychainAccessible: store.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
  return {
    persistent: true,
    // A keystore read can fail (corrupted/after restore): treat as "no session" instead of crashing.
    getRefreshToken: () => store.getItemAsync(REFRESH_TOKEN_KEY, options).catch(() => null),
    setRefreshToken: (token) => store.setItemAsync(REFRESH_TOKEN_KEY, token, options),
    clear: () => store.deleteItemAsync(REFRESH_TOKEN_KEY, options).catch(() => undefined),
  };
}
