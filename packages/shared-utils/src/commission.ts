/**
 * Commission maths. Pure and integer-only so the same inputs always give the same fee, on any machine.
 * (Basis points: 100 bps = 1 %. All amounts are integer satang.)
 */
export interface CommissionRuleLike {
  id: string;
  name: string;
  version: number;
  feeBps: number;
  minFeeMinor?: number | null | undefined;
  maxFeeMinor?: number | null | undefined;
  priceMinMinor?: number | null | undefined;
  priceMaxMinor?: number | null | undefined;
  categories: readonly string[];
  startsAt: Date;
  endsAt?: Date | null | undefined;
  priority: number;
  active: boolean;
}

export interface CommissionBreakdown {
  baseMinor: number;
  feeBps: number;
  rawFeeMinor: number;
  minFeeMinor: number | null;
  maxFeeMinor: number | null;
  feeMinor: number;
  clamp: 'min' | 'max' | 'base' | null;
}

/** floor(base × bps / 10 000), then the rule's minimum, then its maximum, and never more than the price itself. */
export function calculateCommission(
  baseMinor: number,
  feeBps: number,
  bounds: { minFeeMinor?: number | null | undefined; maxFeeMinor?: number | null | undefined } = {},
): CommissionBreakdown {
  if (!Number.isSafeInteger(baseMinor) || baseMinor < 0)
    throw new RangeError('base must be a non-negative safe integer');
  if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > 10_000)
    throw new RangeError('feeBps must be an integer between 0 and 10000');
  const min = bounds.minFeeMinor ?? null;
  const max = bounds.maxFeeMinor ?? null;
  if (min !== null && max !== null && min > max)
    throw new RangeError('minimum fee exceeds maximum fee');
  // Exact integer arithmetic: `baseMinor * feeBps` can exceed 2^53 for very large amounts, where floats silently lose digits.
  const rawFeeMinor = Number((BigInt(baseMinor) * BigInt(feeBps)) / 10_000n);
  let fee = rawFeeMinor;
  let clamp: CommissionBreakdown['clamp'] = null;
  if (min !== null && fee < min) {
    fee = min;
    clamp = 'min';
  }
  if (max !== null && fee > max) {
    fee = max;
    clamp = 'max';
  }
  if (fee > baseMinor) {
    fee = baseMinor;
    clamp = 'base';
  }
  return {
    baseMinor,
    feeBps,
    rawFeeMinor,
    minFeeMinor: min,
    maxFeeMinor: max,
    feeMinor: fee,
    clamp,
  };
}

export function ruleMatches(
  rule: CommissionRuleLike,
  input: { priceMinor: number; categoryKey?: string | null | undefined; at: Date },
): boolean {
  if (!rule.active) return false;
  if (input.at < rule.startsAt) return false;
  if (rule.endsAt && input.at >= rule.endsAt) return false;
  if (rule.priceMinMinor != null && input.priceMinor < rule.priceMinMinor) return false;
  if (rule.priceMaxMinor != null && input.priceMinor > rule.priceMaxMinor) return false;
  if (
    rule.categories.length > 0 &&
    (!input.categoryKey || !rule.categories.includes(input.categoryKey))
  )
    return false;
  return true;
}

/**
 * Conflict resolution: the matching rule with the HIGHEST priority wins. Equal-priority rules whose scopes overlap are
 * refused when saved, so ties cannot normally exist; if legacy data has one anyway the lowest id wins (stable).
 */
export function selectCommissionRule<R extends CommissionRuleLike>(
  rules: readonly R[],
  input: { priceMinor: number; categoryKey?: string | null | undefined; at: Date },
): R | null {
  const matching = rules.filter((r) => ruleMatches(r, input));
  matching.sort((a, b) => b.priority - a.priority || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return matching[0] ?? null;
}

const overlaps = (aMin: number, aMax: number, bMin: number, bMax: number) =>
  aMin <= bMax && bMin <= aMax;

/** True when some price/category/time could match both rules (used to refuse equal-priority conflicts). */
export function rulesOverlap(a: CommissionRuleLike, b: CommissionRuleLike): boolean {
  const inf = Number.POSITIVE_INFINITY;
  if (
    !overlaps(
      a.startsAt.getTime(),
      a.endsAt?.getTime() ?? inf,
      b.startsAt.getTime(),
      b.endsAt?.getTime() ?? inf,
    )
  )
    return false;
  // endsAt is exclusive: rules that merely touch do not overlap.
  if (a.endsAt && a.endsAt.getTime() <= b.startsAt.getTime()) return false;
  if (b.endsAt && b.endsAt.getTime() <= a.startsAt.getTime()) return false;
  if (
    !overlaps(
      a.priceMinMinor ?? 0,
      a.priceMaxMinor ?? inf,
      b.priceMinMinor ?? 0,
      b.priceMaxMinor ?? inf,
    )
  )
    return false;
  if (
    a.categories.length > 0 &&
    b.categories.length > 0 &&
    !a.categories.some((c) => b.categories.includes(c))
  )
    return false;
  return true;
}
