import type { FarmSetupDTO } from '@farmplus/shared-types';
import type { Href } from 'expo-router';

/** Where the My Farm tab must send the user first (`null` = nowhere): setup cannot be skipped while required. */
export function farmSetupRedirect(setup: Pick<FarmSetupDTO, 'status'>): Href | null {
  return setup.status === 'farm_setup_required' ? '/farm/new?setup=1' : null;
}
