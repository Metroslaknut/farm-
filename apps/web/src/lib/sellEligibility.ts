import type { SellEligibilityDTO } from '@farmplus/shared-types';
import { api } from '../api';
import { sharedRecent } from './shared';
import { useAsync } from './useAsync';

/**
 * Whether the signed-in user may create listings/products (`GET /marketplace/sell-eligibility`, the rule the API
 * enforces on create). `false` only when the API says so: while loading, or if the check itself fails, the form stays
 * usable and the API still decides. `check = false` (e.g. editing an existing item) skips the request.
 */
export function useCanSell(check = true): boolean {
  const { data } = useAsync(
    () =>
      check
        ? sharedRecent('/marketplace/sell-eligibility', () =>
            api.request<SellEligibilityDTO>('GET', '/marketplace/sell-eligibility'),
          )
        : Promise.resolve(undefined),
    [check],
  );
  return data?.canSell !== false;
}
