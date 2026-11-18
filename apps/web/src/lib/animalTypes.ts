import type { AnimalTypeSummary } from '@farmplus/shared-types';
import { api } from '../api';
import { sharedRecent } from './shared';

/**
 * The animal type catalog (`GET /animal-types`) that most farm pages read: one request serves the pages opened
 * within a minute of each other (see `sharedRecent`). No abort signal: other pages may be waiting on it.
 */
export const loadAnimalTypes = (): Promise<{ animalTypes: AnimalTypeSummary[] }> =>
  sharedRecent(
    '/animal-types',
    () => api.request<{ animalTypes: AnimalTypeSummary[] }>('GET', '/animal-types'),
    // The catalog changes only when an admin edits it.
    60_000,
  );
