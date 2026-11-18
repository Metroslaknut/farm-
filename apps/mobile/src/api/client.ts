import { createApiClient } from '@farmplus/api-client';
import { session } from '@/auth/session';
import { appConfig } from '@/config/env';

/**
 * The shared API client for the whole app: one base URL (config/env.ts), the in-memory access token attached to
 * authenticated calls, and one automatic refresh+retry on 401. Screens never build their own client.
 */
export const api = createApiClient({
  baseUrl: appConfig.apiBaseUrl ?? '',
  getAccessToken: session.getAccessToken,
  onUnauthorized: session.refresh,
});
