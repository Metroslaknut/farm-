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
    () =>
      farmId
        ? sharedRecent(`/farms/${farmId}`, () =>
            api.request<{ farm: FarmDetail }>('GET', `/farms/${farmId}`),
          )
        : Promise.resolve(undefined),
    [farmId],
  );
  const permissions = new Set<string>(state.data?.farm.access.permissions ?? []);
  return {
    ...state,
    farm: state.data?.farm,
    can: (permission: string) => permissions.has(permission),
  };
}
