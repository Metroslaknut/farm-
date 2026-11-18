import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { resolveApiBaseUrl, type ApiUrlResult } from './api-url';

/**
 * Runtime configuration. Only `EXPO_PUBLIC_*` variables exist in the app bundle — they are readable by anyone
 * who has the app, so they must never hold secrets (JWT/DB/payment keys stay on the server).
 */
const resolved: ApiUrlResult = resolveApiBaseUrl({
  configured: process.env.EXPO_PUBLIC_API_BASE_URL,
  platform: Platform.OS,
  hostUri: Constants.expoConfig?.hostUri,
  isDev: __DEV__,
});

export const appConfig = {
  apiBaseUrl: resolved.ok ? resolved.url : null,
  /** Set when the app cannot talk to an API at all; the root layout shows a blocking message. */
  configError: resolved.ok ? null : resolved.reason,
} as const;
