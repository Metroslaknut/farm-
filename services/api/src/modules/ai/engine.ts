import type {
  Confidence,
  CostSummary,
  CriteriaRules,
  DataQualityWarning,
  EstimatedPriceRange,
  GrowthSummary,
  HealthSummary,
  PriceBasis,
  ProceedsLine,
  ReadinessFactor,
  Recommendation,
} from '@farmplus/shared-types';

/**
 * The deterministic assessment engine. Pure: records and market statistics in, an assessment out. Every number in an
 * assessment is produced here, never by a model. Nothing is invented: where data or criteria are missing the result says
 * so (`unknown`, `null`, a warning) instead of guessing.
 */
export const ENGINE_VERSION = 'farmplus-assessment/1.0.0';
const DAY = 86_400_000;
const days = (a: Date, b: Date) => Math.floor((a.getTime() - b.getTime()) / DAY);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const round1 = (n: number) => Math.round(n * 10) / 10;

export interface EngineInput {
  now: Date;
  animal: {
    status: string;
    sex: string;
    typeKey: string;
    typeName: string;
    birthDate: Date | null;
    birthDateEstimated: boolean;
    acquisitionDate: Date | null;
    originKind: string;
  };
  weights: { on: Date; kg: number; method: string }[];
  /** null = the requester may not read health records. */
  health:
    { type: string; on: Date; outcome: string | null; withdrawalEndsOn: Date | null }[] | null;
  /** null = the requester may not read expenses. */
  expenses: { category: string; on: Date; amountMinor: number }[] | null;
  farmWideExpenseCount: number | null;
  criteria: {
    key: string;
    version: number;
    validated: boolean;
    validationReference: string | null;
    source: string;
    rules: CriteriaRules;
  } | null;
  settings: { weightFreshDays: number; minMarketSamples: number };
  market: PriceBasis[];
  hasOpenListing: boolean;
  /** Platform fee for a sale at this price under the commission rules in force (read-only; the real fee is fixed at checkout). */
  fee: (priceMinor: number) => number;
}

export interface EngineResult {
  readinessScore: number | null;
  readinessScoreNote: string;
  readinessFactors: ReadinessFactor[];
  readinessCounts: { met: number; notMet: number; unknown: number };
  estimatedPriceRange: EstimatedPriceRange | null;
  priceBases: PriceBasis[];
  expectedProceeds: ProceedsLine[];
  costSummary: CostSummary | null;
  growth: GrowthSummary;
  health: HealthSummary | null;
  dataQualityWarnings: DataQualityWarning[];
  confidence: Confidence;
  recommendations: Omit<Recommendation, 'id' | 'dismissed' | 'dismissedAt' | 'dismissedBy'>[];
  ageDays: number | null;
}

// ---------------------------------------------------------------------------
export function summarizeGrowth(weights: EngineInput['weights'], now: Date): GrowthSummary {
  const w = [...weights].sort((a, b) => a.on.getTime() - b.on.getTime());
  if (w.length === 0)
    return {
      weightCount: 0,
      firstWeighedOn: null,
      latestWeighedOn: null,
      firstKg: null,
      latestKg: null,
      daysSinceLatest: null,
      averageDailyGainG: null,
      estimatedWeightShare: null,
    };
  const first = w[0]!;
  const last = w[w.length - 1]!;
  const span = days(last.on, first.on);
  // Average daily gain needs two readings at least a week apart: closer than that it is mostly measurement noise.
  const adg = w.length >= 2 && span >= 7 ? Math.round(((last.kg - first.kg) / span) * 1000) : null;
  const estimated = w.filter((x) => x.method !== 'scale').length;
  return {
    weightCount: w.length,
    firstWeighedOn: iso(first.on),
    latestWeighedOn: iso(last.on),
    firstKg: first.kg,
    latestKg: last.kg,
    daysSinceLatest: Math.max(0, days(now, last.on)),
    averageDailyGainG: adg,
    estimatedWeightShare: round1(estimated / w.length),
  };
}

function summarizeHealth(health: NonNullable<EngineInput['health']>, now: Date): HealthSummary {
  const recent = health.filter((h) => days(now, h.on) <= 90 && days(now, h.on) >= 0);
  const count = (t: string) => recent.filter((h) => h.type === t).length;
  const sorted = [...health].sort((a, b) => b.on.getTime() - a.on.getTime());
  const running = health
    .filter((h) => h.withdrawalEndsOn && h.withdrawalEndsOn > now)
    .map((h) => h.withdrawalEndsOn!)
    .sort((a, b) => b.getTime() - a.getTime())[0];
  const vacc = health
    .filter((h) => h.type === 'vaccination')
    .sort((a, b) => b.on.getTime() - a.on.getTime())[0];
  return {
    recordCount: health.length,
    last90Days: {
      illness: count('illness'),
      treatment: count('treatment'),
      vaccination: count('vaccination'),
      checkup: count('checkup'),
      other: count('other') + count('recovery'),
    },
    latestRecordOn: sorted[0] ? iso(sorted[0].on) : null,
    withdrawalEndsOn: running ? iso(running) : null,
    latestVaccinationOn: vacc ? iso(vacc.on) : null,
    note: 'Counts and dates of what was recorded. FARM+ does not interpret health records or diagnose; ask a veterinarian about the animal’s health.',
  };
}

function summarizeCosts(input: EngineInput): CostSummary | null {
  if (!input.expenses) return null;
  const byCat = new Map<string, { amountMinor: number; count: number }>();
  for (const e of input.expenses) {
    const c = byCat.get(e.category) ?? { amountMinor: 0, count: 0 };
    c.amountMinor += e.amountMinor;
    c.count++;
    byCat.set(e.category, c);
  }
  const sorted = [...input.expenses].sort((a, b) => a.on.getTime() - b.on.getTime());
  const total = input.expenses.reduce((a, e) => a + e.amountMinor, 0);
  const since =
    input.animal.acquisitionDate ??
    (input.animal.originKind === 'born_on_farm' ? input.animal.birthDate : null);
  const daysOnFarm = since ? Math.max(1, days(input.now, since)) : null;
  const notes = [
    'Only costs recorded against this animal are counted. Farm-wide costs (shared feed, labour, equipment) that were not assigned to it are not included.',
  ];
  if (input.animal.originKind === 'purchased')
    notes.push(
      'The purchase price is not included unless you recorded it as an expense for this animal.',
    );
  if (input.expenses.length === 0)
    notes.push(
      'No costs are recorded for this animal, so its cost of ownership is UNKNOWN (not zero).',
    );
  return {
    recordedCostMinor: total,
    recordCount: input.expenses.length,
    byCategory: [...byCat.entries()]
      .map(([category, v]) => ({ category, ...v }))
      .sort((a, b) => b.amountMinor - a.amountMinor),
    firstExpenseOn: sorted[0] ? iso(sorted[0].on) : null,
    lastExpenseOn: sorted[sorted.length - 1] ? iso(sorted[sorted.length - 1]!.on) : null,
    daysOnFarm,
    recordedCostPerDayMinor: daysOnFarm && total > 0 ? Math.round(total / daysOnFarm) : null,
    currency: 'THB',
    notes,
  };
}

// ---------------------------------------------------------------------------
function readinessFactors(
  input: EngineInput,
  growth: GrowthSummary,
  health: HealthSummary | null,
): ReadinessFactor[] {
  const { animal, criteria, now } = input;
  const r = criteria?.rules ?? {};
  const f: ReadinessFactor[] = [];
  const add = (x: ReadinessFactor) => f.push(x);
  const ageDays = animal.birthDate ? days(now, animal.birthDate) : null;
  const freshDays = r.weightFreshDays ?? input.settings.weightFreshDays;

  const sellable = animal.status === 'active' || animal.status === 'for_sale';
  add({
    key: 'animal_status',
    label: 'Animal is on the farm and available',
    status: sellable ? 'met' : 'not_met',
    value: animal.status.replace(/_/g, ' '),
    threshold: 'active or for sale',
    basis: 'recorded_data',
    detail: sellable
      ? 'The record shows the animal is still yours to sell.'
      : 'The record says this animal is not on the farm or is already sold.',
  });
  add({
    key: 'not_listed',
    label: 'Not already in an open listing',
    status: input.hasOpenListing ? 'info' : 'met',
    value: input.hasOpenListing ? 'a listing exists' : 'none',
    threshold: null,
    basis: 'recorded_data',
    detail: input.hasOpenListing
      ? 'This animal already has an open marketplace listing.'
      : 'No open marketplace listing for this animal.',
  });
  add({
    key: 'recent_weight',
    label: 'A recent weight is recorded',
    status:
      growth.weightCount === 0
        ? 'unknown'
        : growth.daysSinceLatest! <= freshDays
          ? 'met'
          : 'not_met',
    value: growth.daysSinceLatest === null ? null : `${growth.daysSinceLatest} days ago`,
    threshold: `within ${freshDays} days`,
    basis: criteria && r.weightFreshDays ? 'configured_criteria' : 'recorded_data',
    detail:
      growth.weightCount === 0
        ? 'No weight is recorded, so growth and weight-based readiness cannot be judged.'
        : growth.daysSinceLatest! <= freshDays
          ? 'The latest weight is recent enough to rely on.'
          : 'The latest weight is old: weigh the animal again before relying on weight figures.',
  });
  add({
    key: 'growth_trend',
    label: 'Average daily gain from recorded weights',
    status:
      growth.averageDailyGainG === null
        ? 'unknown'
        : r.minAverageDailyGainG != null
          ? growth.averageDailyGainG >= r.minAverageDailyGainG
            ? 'met'
            : 'not_met'
          : 'info',
    value: growth.averageDailyGainG === null ? null : `${growth.averageDailyGainG} g/day`,
    threshold: r.minAverageDailyGainG != null ? `at least ${r.minAverageDailyGainG} g/day` : null,
    basis: r.minAverageDailyGainG != null ? 'configured_criteria' : 'recorded_data',
    detail:
      growth.averageDailyGainG === null
        ? 'Needs at least two weights recorded a week or more apart.'
        : 'Calculated from the first and latest recorded weights.',
  });

  if (criteria) {
    if (r.minAgeDays != null)
      add({
        key: 'min_age',
        label: 'Minimum age',
        status: ageDays === null ? 'unknown' : ageDays >= r.minAgeDays ? 'met' : 'not_met',
        value: ageDays === null ? null : `${Math.floor(ageDays / 30.4)} months`,
        threshold: `at least ${Math.round(r.minAgeDays / 30.4)} months`,
        basis: 'configured_criteria',
        detail:
          ageDays === null
            ? 'No birth date is recorded.'
            : animal.birthDateEstimated
              ? 'Based on an estimated birth date.'
              : 'Based on the recorded birth date.',
      });
    if (r.minWeightKg != null)
      add({
        key: 'min_weight',
        label: 'Minimum weight',
        status:
          growth.latestKg === null
            ? 'unknown'
            : growth.latestKg >= r.minWeightKg
              ? 'met'
              : 'not_met',
        value: growth.latestKg === null ? null : `${growth.latestKg} kg`,
        threshold: `at least ${r.minWeightKg} kg`,
        basis: 'configured_criteria',
        detail: 'Compared with the latest recorded weight.',
      });
    if (r.targetWeightKg)
      add({
        key: 'target_weight',
        label: 'Within the target weight range',
        status:
          growth.latestKg === null
            ? 'unknown'
            : growth.latestKg >= r.targetWeightKg.min && growth.latestKg <= r.targetWeightKg.max
              ? 'met'
              : 'not_met',
        value: growth.latestKg === null ? null : `${growth.latestKg} kg`,
        threshold: `${r.targetWeightKg.min}–${r.targetWeightKg.max} kg`,
        basis: 'configured_criteria',
        detail: 'Compared with the latest recorded weight.',
      });
  }

  // Health facts: only what was recorded, never an interpretation.
  if (health) {
    const running = health.withdrawalEndsOn;
    add({
      key: 'withdrawal_period',
      label: 'No medicine withdrawal period still running',
      status: running ? 'not_met' : 'met',
      value: running ? `ends ${running}` : 'none recorded',
      threshold: null,
      basis: 'recorded_data',
      detail: running
        ? 'A medicine withdrawal period you recorded has not ended yet.'
        : 'No running withdrawal period is recorded. If you gave medicine and did not record it, this cannot be known.',
    });
    if (criteria && r.healthClearDays != null) {
      const recentIssue = input.health!.some(
        (h) =>
          (h.type === 'illness' || h.type === 'treatment') &&
          days(now, h.on) <= r.healthClearDays! &&
          days(now, h.on) >= 0,
      );
      add({
        key: 'health_clear',
        label: 'No illness or treatment recorded recently',
        status: recentIssue ? 'not_met' : 'met',
        value: recentIssue ? 'a record exists' : 'none recorded',
        threshold: `none in the last ${r.healthClearDays} days`,
        basis: 'configured_criteria',
        detail: 'Based only on the records you entered; it is not a health check.',
      });
    }
    if (criteria && r.vaccinationWithinDays != null)
      add({
        key: 'vaccination_current',
        label: 'A vaccination is recorded recently',
        status:
          health.latestVaccinationOn &&
          days(now, new Date(health.latestVaccinationOn)) <= r.vaccinationWithinDays
            ? 'met'
            : health.recordCount === 0
              ? 'unknown'
              : 'not_met',
        value: health.latestVaccinationOn ?? 'none recorded',
        threshold: `within ${r.vaccinationWithinDays} days`,
        basis: 'configured_criteria',
        detail: 'Based only on the vaccination records you entered.',
      });
  } else {
    add({
      key: 'health_records',
      label: 'Health records',
      status: 'unknown',
      value: null,
      threshold: null,
      basis: 'recorded_data',
      detail: 'You do not have permission to read health records, so they were not considered.',
    });
  }
  return f;
}

// ---------------------------------------------------------------------------
export function computeAssessment(input: EngineInput): EngineResult {
  const { animal, criteria, settings, now } = input;
  const growth = summarizeGrowth(input.weights, now);
  const health = input.health ? summarizeHealth(input.health, now) : null;
  const factors = readinessFactors(input, growth, health);
  const costSummary = summarizeCosts(input);
  const ageDays = animal.birthDate ? Math.max(0, days(now, animal.birthDate)) : null;

  // ---- readiness counts and score
  const counted = factors.filter((x) => x.status !== 'info');
  const readinessCounts = {
    met: counted.filter((x) => x.status === 'met').length,
    notMet: counted.filter((x) => x.status === 'not_met').length,
    unknown: counted.filter((x) => x.status === 'unknown').length,
  };
  const criterionFactors = factors.filter(
    (x) => x.basis === 'configured_criteria' && x.status !== 'info',
  );
  let readinessScore: number | null = null;
  let readinessScoreNote: string;
  if (!criteria)
    readinessScoreNote = `No readiness criteria are configured for ${animal.typeName}, so there is no score. The factors below are facts about the records.`;
  else if (!criteria.validated)
    readinessScoreNote = `The criteria for ${animal.typeName} (version ${criteria.version}) have not been validated as a scoring method, so no score is given. The factors are compared with the configured rules only.`;
  else if (criterionFactors.length === 0)
    readinessScoreNote =
      'The validated criteria contain no rule that could be evaluated, so no score is given.';
  else if (criterionFactors.some((x) => x.status === 'unknown'))
    readinessScoreNote = `A score is not given because ${criterionFactors.filter((x) => x.status === 'unknown').length} criteria could not be evaluated from the recorded data.`;
  else {
    readinessScore = round1(
      (100 * criterionFactors.filter((x) => x.status === 'met').length) / criterionFactors.length,
    );
    readinessScoreNote = `Share of the ${criterionFactors.length} configured criteria met (equal weights), using validated criteria v${criteria.version} (${criteria.validationReference}).`;
  }

  // ---- price range: first basis with enough samples (per-kg bases also need a recent weight)
  const priceBases = input.market.map((b) => ({ ...b, used: false, note: null as string | null }));
  const latestKg = growth.latestKg;
  const weightFresh =
    growth.daysSinceLatest !== null &&
    growth.daysSinceLatest <= (criteria?.rules.weightFreshDays ?? settings.weightFreshDays);
  let range: EstimatedPriceRange | null = null;
  for (const b of priceBases) {
    if (range) break;
    if (b.sampleSize < settings.minMarketSamples) {
      b.note = `Only ${b.sampleSize} price observation(s); at least ${settings.minMarketSamples} are needed.`;
      continue;
    }
    if (b.p25Minor === null || b.medianMinor === null || b.p75Minor === null) continue;
    let lo = b.p25Minor;
    let mid = b.medianMinor;
    let hi = b.p75Minor;
    if (b.source === 'imported_per_kg') {
      if (latestKg === null || !weightFresh) {
        b.note =
          'Needs a recent recorded weight to turn a per-kilogram price into a price for this animal.';
        continue;
      }
      lo = Math.round(lo * latestKg);
      mid = Math.round(mid * latestKg);
      hi = Math.round(hi * latestKg);
    }
    b.used = true;
    range = {
      lowMinor: lo,
      midMinor: mid,
      highMinor: hi,
      currency: 'THB',
      basis: b.source,
      basisLabel: b.label,
      sampleSize: b.sampleSize,
      explanation: `The middle half of ${b.sampleSize} observed prices (${b.scope}${b.windowDays ? `, last ${b.windowDays} days` : ''}), with the median in the middle.${b.source === 'imported_per_kg' ? ` Per-kilogram prices were multiplied by the latest recorded weight (${latestKg} kg).` : ''} It is NOT adjusted for this animal's age, condition, breed or location, and a buyer may pay less or more.`,
    };
  }

  // ---- expected proceeds
  const expectedProceeds: ProceedsLine[] = range
    ? (
        [
          ['low', range.lowMinor],
          ['mid', range.midMinor],
          ['high', range.highMinor],
        ] as const
      ).map(([scenario, price]) => {
        const fee = Math.min(input.fee(price), price);
        const net = price - fee;
        return {
          scenario,
          priceMinor: price,
          platformFeeMinor: fee,
          netProceedsMinor: net,
          netOverRecordedCostMinor:
            costSummary && costSummary.recordCount > 0 ? net - costSummary.recordedCostMinor : null,
        };
      })
    : [];

  // ---- warnings
  const w: DataQualityWarning[] = [];
  const warn = (code: string, severity: DataQualityWarning['severity'], message: string) =>
    w.push({ code, severity, message });
  if (!['active', 'for_sale'].includes(animal.status))
    warn(
      'animal_not_available',
      'serious',
      `This animal is recorded as "${animal.status.replace(/_/g, ' ')}", so a sale assessment may not make sense.`,
    );
  if (growth.weightCount === 0)
    warn(
      'no_weight_records',
      'serious',
      'No weights are recorded: growth, weight-based readiness and per-kilogram prices cannot be assessed.',
    );
  else {
    if (growth.weightCount === 1)
      warn(
        'single_weight',
        'caution',
        'Only one weight is recorded, so growth rate cannot be calculated.',
      );
    else if (growth.averageDailyGainG === null)
      warn(
        'weights_too_close',
        'caution',
        'The recorded weights are less than a week apart, so growth rate is not reliable.',
      );
    if (!weightFresh)
      warn('stale_weight', 'caution', `The latest weight is ${growth.daysSinceLatest} days old.`);
    if ((growth.estimatedWeightShare ?? 0) > 0.5)
      warn(
        'estimated_weights',
        'caution',
        'Most weights are tape or visual estimates rather than scale readings.',
      );
  }
  if (!animal.birthDate)
    warn('birth_date_missing', 'caution', 'No birth date is recorded, so age cannot be used.');
  else if (animal.birthDateEstimated)
    warn('birth_date_estimated', 'info', 'The birth date is an estimate.');
  if (!input.health)
    warn(
      'health_not_authorized',
      'info',
      'Health records were not considered (no permission to read them).',
    );
  else if (input.health.length === 0)
    warn(
      'no_health_records',
      'info',
      'No health records exist for this animal. That is not evidence the animal is healthy.',
    );
  if (health?.withdrawalEndsOn)
    warn(
      'withdrawal_running',
      'serious',
      `A medicine withdrawal period you recorded runs until ${health.withdrawalEndsOn}.`,
    );
  if (!input.expenses)
    warn(
      'cost_not_authorized',
      'info',
      'Costs were not considered (no permission to read expenses).',
    );
  else if (input.expenses.length === 0)
    warn(
      'no_cost_records',
      'caution',
      'No costs are recorded for this animal: its cost of ownership is unknown, not zero.',
    );
  if (input.expenses && (input.farmWideExpenseCount ?? 0) > 0)
    warn(
      'farm_wide_costs_excluded',
      'info',
      `${input.farmWideExpenseCount} farm-wide expense record(s) are not assigned to any animal and are not included in this animal's cost.`,
    );
  if (!criteria)
    warn(
      'no_criteria',
      'caution',
      `No readiness criteria are configured for ${animal.typeName}: readiness is described by facts only.`,
    );
  else if (!criteria.validated)
    warn(
      'criteria_unvalidated',
      'info',
      'The configured criteria are not validated as a scoring method, so no score is given.',
    );
  if (!range) {
    if (priceBases.length === 0)
      warn(
        'no_market_data',
        'caution',
        `There is no authorised market data for ${animal.typeName}, so no price range is suggested.`,
      );
    else
      warn(
        'insufficient_market_data',
        'caution',
        `There is not enough market data to suggest a reliable price range (${priceBases.map((b) => `${b.label}: ${b.sampleSize} observation(s)`).join('; ')}; at least ${settings.minMarketSamples} needed).`,
      );
  } else
    warn(
      'market_not_adjusted',
      'info',
      'The price range is not adjusted for age, condition, breed or location.',
    );

  // ---- confidence: a data-completeness indicator (documented as such)
  const reasons: string[] = [];
  let level: Confidence['level'] = 'high';
  const lower = (to: Confidence['level'], why: string) => {
    reasons.push(why);
    if (to === 'low' || (to === 'medium' && level === 'high')) level = to;
  };
  if (growth.weightCount === 0) lower('low', 'no weights are recorded');
  if (!['active', 'for_sale'].includes(animal.status))
    lower('low', 'the animal is not recorded as available');
  if (!range) lower('low', 'no reliable price range could be suggested');
  if (!criteria) lower('low', `no readiness criteria are configured for ${animal.typeName}`);
  else if (!criteria.validated) lower('medium', 'the readiness criteria are not validated');
  if (
    w.some(
      (x) =>
        x.severity === 'caution' &&
        ![
          'no_criteria',
          'no_market_data',
          'insufficient_market_data',
          'no_weight_records',
        ].includes(x.code),
    )
  )
    lower('medium', 'some recorded data is missing, old or approximate');
  if (reasons.length === 0) reasons.push('the recorded data is reasonably complete and recent');
  const confidence: Confidence = {
    level,
    basis: 'data_completeness',
    reasons,
    explanation: `${level === 'high' ? 'Higher' : level === 'medium' ? 'Moderate' : 'Low'} confidence — an indicator of how complete the data is, not a statistical probability: ${reasons.join('; ')}. Prices are estimates from past observations and real offers can differ.`,
  };

  // ---- recommendations (suggestions for the owner; nothing is done automatically)
  const rec: EngineResult['recommendations'] = [];
  if (growth.weightCount === 0 || !weightFresh)
    rec.push({
      code: 'record_weight',
      text:
        growth.weightCount === 0
          ? 'Weigh the animal and record it: weight is needed for growth and price estimates.'
          : `Record a new weight: the latest is ${growth.daysSinceLatest} days old.`,
    });
  if (!animal.birthDate)
    rec.push({
      code: 'record_birth_date',
      text: 'Record the birth date (or an estimate) so age can be considered.',
    });
  if (input.expenses && input.expenses.length === 0)
    rec.push({
      code: 'record_costs',
      text: 'Record the costs of keeping this animal (feed, vaccines, vet) to see its cost of ownership.',
    });
  if (health?.withdrawalEndsOn)
    rec.push({
      code: 'wait_withdrawal',
      text: `Do not sell for consumption before the recorded withdrawal period ends (${health.withdrawalEndsOn}); ask your veterinarian if unsure.`,
    });
  if (range)
    rec.push({
      code: 'compare_price_range',
      text: 'Compare this range with current local prices and offers before choosing an asking price.',
    });
  rec.push({
    code: 'owner_decides',
    text: 'The decision to sell, and the price, is yours. FARM+ will not list or sell this animal for you; you can create a listing yourself.',
  });

  return {
    readinessScore,
    readinessScoreNote,
    readinessFactors: factors,
    readinessCounts,
    estimatedPriceRange: range,
    priceBases,
    expectedProceeds,
    costSummary,
    growth,
    health,
    dataQualityWarnings: w,
    confidence,
    recommendations: rec,
    ageDays,
  };
}

/** Linear-interpolated quantile of a sorted array (the standard "type 7" definition). */
export function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) throw new RangeError('empty sample');
  if (sorted.length === 1) return sorted[0]!;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}
