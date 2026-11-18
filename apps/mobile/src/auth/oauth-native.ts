import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import * as WebBrowser from 'expo-web-browser';
import { publicApi } from '@/api/public';
import { createPendingVerifierStore, type OAuthDeps } from './oauth';

/** The app-wide pending verifier (memory + secure store, never AsyncStorage). */
export const pendingVerifier = createPendingVerifierStore(SecureStore);

/** Expo bindings for the pure OAuth flow in oauth.ts; `completeLogin` comes from the AuthProvider. */
export function nativeOAuthDeps(completeLogin: OAuthDeps['completeLogin']): OAuthDeps {
  return {
    api: publicApi,
    openAuthSession: (url, redirectUrl) => WebBrowser.openAuthSessionAsync(url, redirectUrl),
    randomBytes: (count) => Crypto.getRandomBytes(count),
    sha256: (data) => Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, data),
    pending: pendingVerifier,
    completeLogin,
  };
}
