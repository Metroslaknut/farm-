import * as SecureStore from 'expo-secure-store';
import { publicApi } from '@/api/public';
import { createSessionManager, type SessionManager } from './session-manager';
import {
  createMemoryTokenStorage,
  createSecureTokenStorage,
  type TokenStorage,
} from './token-storage';

// The secure store is probed asynchronously; until it answers, a memory store serves (nothing is persisted early).
let storage: TokenStorage = createMemoryTokenStorage();
const ready = createSecureTokenStorage(SecureStore).then((s) => void (storage = s));

/** The app-wide session. Everything (API client, AuthProvider) shares this one instance. */
export const session: SessionManager = createSessionManager({
  storage: {
    get persistent() {
      return storage.persistent;
    },
    getRefreshToken: async () => {
      await ready;
      return storage.getRefreshToken();
    },
    setRefreshToken: async (token) => {
      await ready;
      await storage.setRefreshToken(token);
    },
    clear: async () => {
      await ready;
      await storage.clear();
    },
  },
  exchange: (refreshToken) => publicApi.refresh(refreshToken),
});
