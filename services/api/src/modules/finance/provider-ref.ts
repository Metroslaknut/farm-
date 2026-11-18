/**
 * Filter for "the record the provider calls `ref`". The unique index on `(provider, providerRef)` is PARTIAL (only
 * documents whose providerRef is a string, so unsent attempts with `null` do not collide). MongoDB uses a partial index
 * only if the query itself implies its filter, and a bare equality does not — the `$type` below does. Without it every
 * payment, refund and payout callback would scan the whole collection (found by the query-plan audit).
 */
export const byProviderRef = (provider: string, ref: string) => ({
  provider,
  providerRef: { $eq: ref, $type: 'string' as const },
});
