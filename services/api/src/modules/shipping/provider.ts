import type { ApiEnv } from '@farmplus/config/server';
import type { Destination, ListingDTO, TransportRequirement } from '@farmplus/shared-types';

/** A rate a configured provider returned. FARM+ never fabricates one: with no provider only the seller's own rules quote. */
export interface ProviderRate {
  id: string;
  label: string;
  priceMinor: number;
  estimatedDays?: { min: number; max: number } | undefined;
  requirements?: TransportRequirement[] | undefined;
}

export interface ShippingProvider {
  readonly name: string;
  /** Rates for moving a live animal to `destination`; an empty list means the provider cannot. */
  quote(input: {
    listing: Pick<ListingDTO, 'id' | 'animal'>;
    destination: Destination;
  }): Promise<ProviderRate[]>;
}

/** DEVELOPMENT / TEST stand-in (refused in production by the env schema). Its single rate is clearly labelled as a test rate. */
export class MockShippingProvider implements ShippingProvider {
  readonly name = 'mock';
  async quote(input: {
    listing: Pick<ListingDTO, 'id' | 'animal'>;
    destination: Destination;
  }): Promise<ProviderRate[]> {
    if (input.destination.province.toLowerCase() === 'nowhere') return [];
    return [
      {
        id: 'mock-courier',
        label: 'Mock courier (test rate)',
        priceMinor: 123_400,
        estimatedDays: { min: 2, max: 4 },
        requirements: ['livestock_vehicle'],
      },
    ];
  }
}

export function createShippingProvider(env: ApiEnv): ShippingProvider | null {
  return env.SHIPPING_PROVIDER === 'mock' ? new MockShippingProvider() : null;
}
