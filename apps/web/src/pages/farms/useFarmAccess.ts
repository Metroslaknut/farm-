import { ApiClientError } from '@farmplus/api-client';
import type { FarmDetail } from '@farmplus/shared-types';
import { api } from '../../api';
import { sharedRecent } from '../../lib/shared';
import { useAsync } from '../../lib/useAsync';

/** Loads the farm and what the signed-in user may do on it (the API still enforces every action). */
export function useFarm(farmId: string | undefined) {
  const state = useAsync(
    // The dashboard layout and the page read the same farm: one request serves both, and the pages opened soon
    // after (the page mounts only once the setup guard has its answer, when the layout's request may be done).
    // Without an id (the layout on a page that is not about one farm) there is nothing to read.
    async (): Promise<{ farm: FarmDetail } | { missing: true } | undefined> => {
      if (!farmId) return undefined;
      try {
        return await sharedRecent(`/farms/${farmId}`, () =>
          api.request<{ farm: FarmDetail }>('GET', `/farms/${farmId}`),
        );
      } catch (error) {
        // No such farm, or not one of yours (the API answers 404 for both), or not an id at all: nothing to retry.
        if (error instanceof ApiClientError && (error.status === 404 || error.status === 400))
          return { missing: true };
        throw error;
      }
    },
    [farmId],
  );
  const farm = state.data && 'farm' in state.data ? state.data.farm : undefined;
  const permissions = new Set<string>(farm?.access.permissions ?? []);
  return {
    ...state,
    farm,
    /** The farm in the address does not exist (or is not the user's). */
    missing: Boolean(state.data && 'missing' in state.data),
    can: (permission: string) => permissions.has(permission),
  };
}
