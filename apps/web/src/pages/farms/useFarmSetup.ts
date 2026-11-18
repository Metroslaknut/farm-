import type { FarmSetupDTO } from '@farmplus/shared-types';
import { api } from '../../api';
import { sharedRecent } from '../../lib/shared';
import { useAsync } from '../../lib/useAsync';

/** The signed-in user's onboarding state (`GET /farms/me`): derived by the API from their farm memberships. */
export function useFarmSetup() {
  // The layout, the setup guard and the index page all ask: one request serves them (and pages opened soon after).
  return useAsync(
    () => sharedRecent('/farms/me', () => api.request<FarmSetupDTO>('GET', '/farms/me')),
    [],
  );
}
