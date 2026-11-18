import { createApiClient } from '@farmplus/api-client';
import { appConfig } from '@/config/env';

/** Unauthenticated calls only (health, login, register, refresh). Same config as the authenticated client. */
export const publicApi = createApiClient({ baseUrl: appConfig.apiBaseUrl ?? '' });
