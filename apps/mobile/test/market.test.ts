import { describe, expect, it } from 'vitest';
import { formatBaht, parseBahtToMinor } from '@farmplus/shared-utils';
import { createOfferSchema, listingSearchSchema } from '@farmplus/validation';

describe('money', () => {
  it('formats and parses without floating point', () => {
    expect(formatBaht(4_500_050)).toBe('฿45,000.50');
    expect(parseBahtToMinor('45,000.5')).toBe(4_500_050);
    expect(parseBahtToMinor('19.99')).toBe(1999);
    for (const bad of ['', 'x', '-1', '0', '1.234', '1e3'])
      expect(parseBahtToMinor(bad)).toBeUndefined();
  });
});

describe('offer and search validation (same schemas as the API)', () => {
  it('only accepts positive whole satang in THB', () => {
    expect(createOfferSchema.safeParse({ amountMinor: 4_500_000 }).success).toBe(true);
    for (const bad of [
      { amountMinor: 10.5 },
      { amountMinor: 0 },
      { amountMinor: -1 },
      { amountMinor: '5' },
      { amountMinor: 100, currency: 'USD' },
      { amountMinor: 100, extra: 1 },
    ])
      expect(createOfferSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
  });
  it('rejects an inverted price range and unknown sorts', () => {
    expect(
      listingSearchSchema.safeParse({ minPriceMinor: '500', maxPriceMinor: '100' }).success,
    ).toBe(false);
    expect(listingSearchSchema.safeParse({ sort: 'random' }).success).toBe(false);
    expect(listingSearchSchema.safeParse({ sort: 'price_asc', limit: '5' }).success).toBe(true);
  });
});
