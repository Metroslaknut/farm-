/* eslint-disable @typescript-eslint/no-explicit-any -- response bodies are inspected loosely in tests */
import { Types } from 'mongoose';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { apiEnvSchema, parseEnv } from '@farmplus/config/server';
import {
  AiAssessment,
  AiCriteria,
  AiMarketPrice,
  AiUsageLog,
  AuditLog,
  CommissionRule,
  FarmExpense,
  HealthRecord,
  Listing,
  Order,
  Setting,
  WeightRecord,
  Animal,
} from '../src/models';
import {
  ENGINE_VERSION,
  computeAssessment,
  quantile,
  summarizeGrowth,
  type EngineInput,
} from '../src/modules/ai/engine';
import { validateNarrative } from '../src/modules/ai/narrative';
import { AiProviderError, AnthropicProvider } from '../src/modules/ai/provider';
import { createApp } from '../src/app';
import {
  addFarmMember,
  createStaff,
  createUser,
  login,
  makeFarm,
  mkAnimal,
  register,
  startHarness,
  typeIdOf,
  type Session,
  type TestHarness,
} from './helpers';
import { API } from './orders-helpers';
import { Role, UserRole } from '../src/models';

let h: TestHarness;
let admin: Awaited<ReturnType<typeof createStaff>>;
let buffalo: string;

beforeAll(async () => {
  h = await startHarness();
  admin = await createStaff(h.app, ['super_admin']);
  buffalo = await typeIdOf(h.app, await createUser(h.app), 'buffalo');
});
afterAll(async () => {
  await h.stop();
});
afterEach(async () => {
  h.ai!.mode = 'grounded';
  h.ai!.failWith = null;
  await Setting.deleteMany({ key: { $regex: '^ai\\.|orders\\.platformFeeBps' } });
  await AiCriteria.deleteMany({});
  await AiMarketPrice.deleteMany({});
  await Order.collection.deleteMany({});
  await CommissionRule.updateMany({}, { $set: { active: false } });
});

// ---------------------------------------------------------------------------
const NOW = new Date('2026-06-15T00:00:00Z');
const d = (daysAgo: number) => new Date(NOW.getTime() - daysAgo * 86_400_000);
const input = (over: Partial<EngineInput> = {}): EngineInput => ({
  now: NOW,
  animal: {
    status: 'active',
    sex: 'female',
    typeKey: 'buffalo',
    typeName: 'Buffalo',
    birthDate: d(900),
    birthDateEstimated: false,
    acquisitionDate: null,
    originKind: 'born_on_farm',
  },
  weights: [],
  health: [],
  expenses: [],
  farmWideExpenseCount: 0,
  criteria: null,
  settings: { weightFreshDays: 30, minMarketSamples: 5 },
  market: [],
  hasOpenListing: false,
  fee: () => 0,
  ...over,
});
const basis = (over: Record<string, unknown> = {}) => ({
  source: 'farmplus_sales' as const,
  label: 'Completed FARM+ sales',
  sampleSize: 6,
  windowDays: 180,
  p25Minor: 3_275_000,
  medianMinor: 3_650_000,
  p75Minor: 3_950_000,
  minMinor: null,
  maxMinor: null,
  used: false,
  note: null,
  scope: 'Buffalo, female, other farms',
  ...over,
});
const rules = { minAgeDays: 700, minWeightKg: 350, minAverageDailyGainG: 400 };
const criteria = (over: Record<string, unknown> = {}) => ({
  key: 'buffalo',
  version: 1,
  validated: false,
  validationReference: null,
  source: 'Farm policy 2026',
  rules,
  ...over,
});
const w = (daysAgo: number, kg: number, method = 'scale') => ({ on: d(daysAgo), kg, method });

describe('engine: growth, factors and honesty about missing data', () => {
  it('quantiles use the standard interpolation', () => {
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(quantile([10], 0.9)).toBe(10);
    expect(quantile([1, 2, 3, 4, 5], 0.25)).toBe(2);
    expect(() => quantile([], 0.5)).toThrow();
  });

  it('with no data at all it invents nothing: no price, no cost, no score — only disclosed gaps and low confidence', () => {
    const r = computeAssessment(input({ expenses: [], health: [] }));
    expect(r.estimatedPriceRange).toBeNull();
    expect(r.expectedProceeds).toEqual([]);
    expect(r.readinessScore).toBeNull();
    expect(r.growth).toMatchObject({ weightCount: 0, latestKg: null, averageDailyGainG: null });
    const codes = r.dataQualityWarnings.map((x) => x.code);
    expect(codes).toEqual(
      expect.arrayContaining([
        'no_weight_records',
        'no_market_data',
        'no_criteria',
        'no_cost_records',
      ]),
    );
    expect(r.costSummary).toMatchObject({ recordedCostMinor: 0, recordCount: 0 });
    expect(r.costSummary!.notes.join(' ')).toContain('UNKNOWN (not zero)');
    expect(r.confidence.level).toBe('low');
    expect(r.confidence.explanation).toContain('not a statistical probability');
    expect(r.readinessFactors.find((f) => f.key === 'recent_weight')?.status).toBe('unknown');
    expect(r.readinessScoreNote).toContain('No readiness criteria');
  });

  it('growth: average daily gain needs two weights at least a week apart; estimated weights are flagged', () => {
    expect(summarizeGrowth([w(100, 300), w(0, 400)], NOW)).toMatchObject({
      weightCount: 2,
      firstKg: 300,
      latestKg: 400,
      averageDailyGainG: 1000,
      daysSinceLatest: 0,
      estimatedWeightShare: 0,
    });
    expect(summarizeGrowth([w(3, 300), w(0, 310)], NOW).averageDailyGainG).toBeNull();
    expect(summarizeGrowth([w(10, 300)], NOW).averageDailyGainG).toBeNull();
    expect(
      summarizeGrowth([w(10, 300, 'tape_estimate'), w(5, 310, 'visual_estimate'), w(0, 320)], NOW)
        .estimatedWeightShare,
    ).toBe(0.7);
    // unsorted input is handled
    expect(summarizeGrowth([w(0, 400), w(100, 300)], NOW).firstKg).toBe(300);
    const r = computeAssessment(
      input({ weights: [w(80, 300, 'tape_estimate'), w(40, 330, 'tape_estimate'), w(45, 400)] }),
    );
    expect(r.dataQualityWarnings.map((x) => x.code)).toContain('estimated_weights');
  });

  it('a stale weight is flagged and recommended for re-weighing; the freshness window can come from the criteria', () => {
    const stale = computeAssessment(input({ weights: [w(90, 300), w(60, 330)] }));
    expect(stale.dataQualityWarnings.map((x) => x.code)).toContain('stale_weight');
    expect(stale.readinessFactors.find((f) => f.key === 'recent_weight')).toMatchObject({
      status: 'not_met',
      threshold: 'within 30 days',
    });
    expect(stale.recommendations.map((x) => x.code)).toContain('record_weight');
    const lenient = computeAssessment(
      input({
        weights: [w(90, 300), w(60, 330)],
        criteria: criteria({ rules: { weightFreshDays: 120 } }),
      }),
    );
    expect(lenient.readinessFactors.find((f) => f.key === 'recent_weight')?.status).toBe('met');
  });

  it('criteria-based factors compare with the configured rules and say which rule they used', () => {
    const r = computeAssessment(input({ weights: [w(100, 300), w(0, 420)], criteria: criteria() }));
    const f = Object.fromEntries(r.readinessFactors.map((x) => [x.key, x]));
    expect(f['min_age']).toMatchObject({
      status: 'met',
      basis: 'configured_criteria',
      threshold: 'at least 23 months',
    });
    expect(f['min_weight']).toMatchObject({
      status: 'met',
      value: '420 kg',
      threshold: 'at least 350 kg',
    });
    expect(f['growth_trend']).toMatchObject({
      status: 'met',
      value: '1200 g/day',
      threshold: 'at least 400 g/day',
    });
    expect(f['animal_status']).toMatchObject({ status: 'met', basis: 'recorded_data' });
    const young = computeAssessment(
      input({
        animal: { ...input().animal, birthDate: d(300) },
        weights: [w(100, 300), w(0, 320)],
        criteria: criteria(),
      }),
    );
    expect(young.readinessFactors.find((x) => x.key === 'min_age')?.status).toBe('not_met');
    expect(young.readinessFactors.find((x) => x.key === 'min_weight')?.status).toBe('not_met');
    expect(young.readinessCounts.notMet).toBeGreaterThanOrEqual(2);
    const noBirth = computeAssessment(
      input({
        animal: { ...input().animal, birthDate: null },
        criteria: criteria({ rules: { minAgeDays: 700 } }),
      }),
    );
    expect(noBirth.readinessFactors.find((x) => x.key === 'min_age')).toMatchObject({
      status: 'unknown',
      value: null,
    });
    expect(noBirth.dataQualityWarnings.map((x) => x.code)).toContain('birth_date_missing');
  });

  it('a readiness SCORE exists only for validated criteria, only when every rule could be evaluated, and is the share of rules met', () => {
    const ok = [w(100, 300), w(0, 420)];
    expect(
      computeAssessment(input({ weights: ok, criteria: criteria({ validated: false }) }))
        .readinessScore,
    ).toBeNull();
    expect(
      computeAssessment(input({ weights: ok, criteria: criteria({ validated: false }) }))
        .readinessScoreNote,
    ).toContain('not been validated');
    expect(computeAssessment(input({ weights: ok })).readinessScore).toBeNull();
    const v = criteria({ validated: true, validationReference: 'Review 2026-03' });
    expect(computeAssessment(input({ weights: ok, criteria: v })).readinessScore).toBe(100);
    // 3 criteria, weight 380 kg misses min weight 400: 2 of 3 = 66.7
    const partial = computeAssessment(
      input({
        weights: [w(100, 300), w(0, 380)],
        criteria: criteria({
          validated: true,
          validationReference: 'Review',
          rules: { minAgeDays: 700, minWeightKg: 400, minAverageDailyGainG: 400 },
        }),
      }),
    );
    expect(partial.readinessScore).toBe(66.7);
    expect(partial.readinessScoreNote).toContain('Review');
    // a criterion that cannot be evaluated withholds the score rather than guessing
    expect(computeAssessment(input({ weights: [], criteria: v })).readinessScore).toBeNull();
    expect(computeAssessment(input({ weights: [], criteria: v })).readinessScoreNote).toContain(
      'could not be evaluated',
    );
  });

  it('health facts are counts and dates only; a running withdrawal period blocks and is recommended against selling; unauthorised reads are disclosed', () => {
    const r = computeAssessment(
      input({
        health: [
          { type: 'illness', on: d(20), outcome: 'recovered', withdrawalEndsOn: null },
          {
            type: 'treatment',
            on: d(10),
            outcome: null,
            withdrawalEndsOn: new Date(NOW.getTime() + 5 * 86_400_000),
          },
          { type: 'vaccination', on: d(200), outcome: null, withdrawalEndsOn: null },
        ],
      }),
    );
    expect(r.health).toMatchObject({
      recordCount: 3,
      last90Days: { illness: 1, treatment: 1, vaccination: 0 },
      withdrawalEndsOn: '2026-06-20',
      latestVaccinationOn: '2025-11-27',
    });
    expect(r.health!.note).toContain('does not interpret health records');
    expect(r.readinessFactors.find((f) => f.key === 'withdrawal_period')?.status).toBe('not_met');
    expect(r.dataQualityWarnings.find((x) => x.code === 'withdrawal_running')?.severity).toBe(
      'serious',
    );
    expect(r.recommendations.map((x) => x.code)).toContain('wait_withdrawal');
    const none = computeAssessment(input({ health: null }));
    expect(none.health).toBeNull();
    expect(none.readinessFactors.find((f) => f.key === 'health_records')?.status).toBe('unknown');
    expect(none.dataQualityWarnings.map((x) => x.code)).toContain('health_not_authorized');
    const clear = computeAssessment(
      input({
        health: [{ type: 'illness', on: d(10), outcome: null, withdrawalEndsOn: null }],
        criteria: criteria({ rules: { healthClearDays: 30, vaccinationWithinDays: 365 } }),
      }),
    );
    expect(clear.readinessFactors.find((f) => f.key === 'health_clear')?.status).toBe('not_met');
    expect(clear.readinessFactors.find((f) => f.key === 'vaccination_current')?.status).toBe(
      'not_met',
    );
  });

  it('costs: only costs recorded against the animal; unknown is not zero; unauthorised reads are omitted; per-day uses days on farm', () => {
    const r = computeAssessment(
      input({
        expenses: [
          { category: 'feed', on: d(100), amountMinor: 500_000 },
          { category: 'feed', on: d(50), amountMinor: 300_000 },
          { category: 'veterinary', on: d(20), amountMinor: 200_000 },
        ],
        farmWideExpenseCount: 4,
        animal: { ...input().animal, birthDate: d(400) },
      }),
    );
    expect(r.costSummary).toMatchObject({
      recordedCostMinor: 1_000_000,
      recordCount: 3,
      firstExpenseOn: '2026-03-07',
      lastExpenseOn: '2026-05-26',
      daysOnFarm: 400,
      recordedCostPerDayMinor: 2500,
    });
    expect(r.costSummary!.byCategory).toEqual([
      { category: 'feed', amountMinor: 800_000, count: 2 },
      { category: 'veterinary', amountMinor: 200_000, count: 1 },
    ]);
    expect(r.dataQualityWarnings.map((x) => x.code)).toEqual(
      expect.arrayContaining(['farm_wide_costs_excluded']),
    );
    expect(r.dataQualityWarnings.map((x) => x.code)).not.toContain('no_cost_records');
    const purchased = computeAssessment(
      input({
        animal: { ...input().animal, originKind: 'purchased', acquisitionDate: d(100) },
        expenses: [{ category: 'feed', on: d(10), amountMinor: 1000 }],
      }),
    );
    expect(purchased.costSummary!.notes.join(' ')).toContain('purchase price is not included');
    expect(purchased.costSummary!.daysOnFarm).toBe(100);
    const hidden = computeAssessment(input({ expenses: null, farmWideExpenseCount: null }));
    expect(hidden.costSummary).toBeNull();
    expect(hidden.dataQualityWarnings.map((x) => x.code)).toContain('cost_not_authorized');
  });
});

describe('engine: price ranges and proceeds come only from supportable data', () => {
  it('a range needs at least the configured number of observations; below it there is none and the gap is disclosed', () => {
    const few = computeAssessment(
      input({ weights: [w(10, 400)], market: [basis({ sampleSize: 4 })] }),
    );
    expect(few.estimatedPriceRange).toBeNull();
    expect(few.priceBases[0]).toMatchObject({
      used: false,
      note: expect.stringContaining('Only 4'),
    });
    expect(
      few.dataQualityWarnings.find((x) => x.code === 'insufficient_market_data')?.message,
    ).toContain('at least 5');
    const enough = computeAssessment(
      input({ weights: [w(10, 400)], market: [basis({ sampleSize: 5 })] }),
    );
    expect(enough.estimatedPriceRange).toMatchObject({
      lowMinor: 3_275_000,
      midMinor: 3_650_000,
      highMinor: 3_950_000,
      basis: 'farmplus_sales',
      sampleSize: 5,
    });
    expect(enough.estimatedPriceRange!.explanation).toContain('NOT adjusted');
  });

  it('prefers platform sales, then imported per-animal prices, then per-kg prices (which need a recent weight); sources are never blended', () => {
    const imported = basis({
      source: 'imported_per_head',
      label: 'Imported (per animal)',
      p25Minor: 100,
      medianMinor: 200,
      p75Minor: 300,
    });
    const r1 = computeAssessment(input({ market: [basis({ sampleSize: 2 }), imported] }));
    expect(r1.estimatedPriceRange).toMatchObject({ basis: 'imported_per_head', midMinor: 200 });
    expect(r1.priceBases.map((b) => b.used)).toEqual([false, true]);
    const perKg = basis({
      source: 'imported_per_kg',
      label: 'Imported (per kg)',
      p25Minor: 10_000,
      medianMinor: 12_000,
      p75Minor: 14_000,
    });
    const noWeight = computeAssessment(input({ market: [perKg] }));
    expect(noWeight.estimatedPriceRange).toBeNull();
    expect(noWeight.priceBases[0]!.note).toContain('recent recorded weight');
    const stale = computeAssessment(input({ weights: [w(200, 400)], market: [perKg] }));
    expect(stale.estimatedPriceRange).toBeNull();
    const fresh = computeAssessment(input({ weights: [w(5, 400)], market: [perKg] }));
    expect(fresh.estimatedPriceRange).toMatchObject({
      basis: 'imported_per_kg',
      lowMinor: 4_000_000,
      midMinor: 4_800_000,
      highMinor: 5_600_000,
    });
    expect(fresh.estimatedPriceRange!.explanation).toContain(
      'multiplied by the latest recorded weight (400 kg)',
    );
  });

  it('proceeds subtract the platform fee at each price, and "net over recorded cost" is withheld when no cost is recorded (and is not called profit)', () => {
    const fee = (p: number) => Math.floor((p * 500) / 10_000);
    const withCost = computeAssessment(
      input({
        weights: [w(5, 400)],
        market: [basis()],
        fee,
        expenses: [{ category: 'feed', on: d(30), amountMinor: 1_000_000 }],
      }),
    );
    expect(
      withCost.expectedProceeds.map((p) => [
        p.scenario,
        p.priceMinor,
        p.platformFeeMinor,
        p.netProceedsMinor,
        p.netOverRecordedCostMinor,
      ]),
    ).toEqual([
      ['low', 3_275_000, 163_750, 3_111_250, 2_111_250],
      ['mid', 3_650_000, 182_500, 3_467_500, 2_467_500],
      ['high', 3_950_000, 197_500, 3_752_500, 2_752_500],
    ]);
    const noCost = computeAssessment(input({ weights: [w(5, 400)], market: [basis()], fee }));
    expect(noCost.expectedProceeds.every((p) => p.netOverRecordedCostMinor === null)).toBe(true);
    const hidden = computeAssessment(
      input({ weights: [w(5, 400)], market: [basis()], fee, expenses: null }),
    );
    expect(hidden.expectedProceeds.every((p) => p.netOverRecordedCostMinor === null)).toBe(true);
    expect(
      computeAssessment(input({ weights: [w(5, 400)], market: [basis()], fee: (p) => p * 2 }))
        .expectedProceeds[0]!.netProceedsMinor,
    ).toBe(0); // the fee can never exceed the price
  });

  it('is deterministic: the same inputs give the same assessment every time', () => {
    const i = input({
      weights: [w(100, 300), w(0, 420)],
      criteria: criteria(),
      market: [basis()],
      expenses: [{ category: 'feed', on: d(10), amountMinor: 123_456 }],
    });
    expect(computeAssessment(i)).toEqual(computeAssessment(i));
  });

  it('confidence is a data-completeness level with reasons: low without weights/price/criteria, medium with unvalidated criteria or old data, high only with complete recent data and validated criteria', () => {
    expect(computeAssessment(input()).confidence.level).toBe('low');
    const unvalidated = computeAssessment(
      input({
        weights: [w(100, 300), w(0, 420)],
        criteria: criteria(),
        market: [basis()],
        expenses: [{ category: 'feed', on: d(1), amountMinor: 1 }],
      }),
    );
    expect(unvalidated.confidence.level).toBe('medium');
    expect(unvalidated.confidence.reasons.join(' ')).toContain('not validated');
    const complete = computeAssessment(
      input({
        weights: [w(100, 300), w(0, 420)],
        criteria: criteria({ validated: true, validationReference: 'Review' }),
        market: [basis()],
        expenses: [{ category: 'feed', on: d(1), amountMinor: 1 }],
      }),
    );
    expect(complete.confidence.level).toBe('high');
    const old = computeAssessment(
      input({
        weights: [w(200, 300), w(100, 420)],
        criteria: criteria({ validated: true, validationReference: 'Review' }),
        market: [basis()],
        expenses: [{ category: 'feed', on: d(1), amountMinor: 1 }],
      }),
    );
    expect(old.confidence.level).toBe('medium');
  });

  it('every assessment tells the owner the decision is theirs and never offers an automatic action', () => {
    const r = computeAssessment(input({ weights: [w(5, 400)], market: [basis()] }));
    expect(r.recommendations.at(-1)).toMatchObject({ code: 'owner_decides' });
    expect(r.recommendations.map((x) => x.text).join(' ')).toContain(
      'will not list or sell this animal for you',
    );
  });
});

// ---------------------------------------------------------------------------
describe('AI narrative validation: invalid output is rejected safely', () => {
  const facts = {
    priceRangeBaht: { low: 32750, middle: 36500, high: 39500 },
    growth: { latestWeightKg: 420 },
    note: 'value 1200 g/day',
  };
  const good = {
    summary: 'The recorded weight is 420 kg and the price range runs from 32,750 to 39,500 baht.',
    observations: ['Gain was 1200 g/day.'],
    questionsForOwner: ['Is anything missing?'],
  };
  const terms = 'diagnos, prescri, treat, cure, guarantee';
  const check = (raw: unknown, f = facts) =>
    validateNarrative(typeof raw === 'string' ? raw : JSON.stringify(raw), f, terms);

  it('accepts grounded, schema-valid output (also when wrapped in a code fence)', () => {
    expect(check(good).ok).toBe(true);
    expect(check('```json\n' + JSON.stringify(good) + '\n```').ok).toBe(true);
  });
  it('rejects everything else with a specific code', () => {
    const code = (raw: unknown, f = facts) => {
      const c = check(raw, f);
      return c.ok ? 'OK' : c.code;
    };
    expect(code('Here you go: great animal')).toBe('AI_OUTPUT_NOT_JSON');
    expect(code('{"summary": "x"')).toBe('AI_OUTPUT_NOT_JSON');
    expect(code('[]')).toBe('AI_OUTPUT_SCHEMA');
    expect(code({ ...good, extra: 1 })).toBe('AI_OUTPUT_SCHEMA');
    expect(code({ ...good, summary: 'short' })).toBe('AI_OUTPUT_SCHEMA');
    expect(code({ ...good, observations: Array.from({ length: 7 }, () => 'something') })).toBe(
      'AI_OUTPUT_SCHEMA',
    );
    expect(code({ ...good, summary: 'x'.repeat(2000) })).toBe('AI_OUTPUT_SCHEMA');
    expect(code('x'.repeat(9000))).toBe('AI_OUTPUT_TOO_LONG');
    expect(code({ ...good, summary: 'Cattle like this usually sell for 987,654 baht.' })).toBe(
      'AI_OUTPUT_UNGROUNDED_NUMBER',
    );
    expect(code({ ...good, observations: ['The animal weighs 999 kg.'] })).toBe(
      'AI_OUTPUT_UNGROUNDED_NUMBER',
    );
    expect(code({ ...good, summary: 'This points to a diagnosis of parasites in the herd.' })).toBe(
      'AI_OUTPUT_BLOCKED_TERM',
    );
    expect(code({ ...good, summary: 'Treatment would help with this growth rate.' })).toBe(
      'AI_OUTPUT_BLOCKED_TERM',
    ); // stem match
    expect(code({ ...good, summary: 'I guarantee a sale at 36,500 baht.' })).toBe(
      'AI_OUTPUT_BLOCKED_TERM',
    );
    expect(code({ ...good, summary: 'More at https://example.test/prices for details.' })).toBe(
      'AI_OUTPUT_LINK_OR_MARKUP',
    );
    expect(code({ ...good, summary: 'See [prices](http://x.test) for the range.' })).toBe(
      'AI_OUTPUT_LINK_OR_MARKUP',
    );
    expect(code({ ...good, summary: '<b>Great</b> animal with a 420 kg weight' })).toBe(
      'AI_OUTPUT_LINK_OR_MARKUP',
    );
    expect(code({ ...good, summary: 'Weight 420 kg\u0007 recorded here.' })).toBe(
      'AI_OUTPUT_CONTROL_CHARS',
    );
  });
  it('numbers are checked against the facts the model was given (and small counting numbers are allowed)', () => {
    expect(
      check({ ...good, summary: 'There are 3 points to note about the 420 kg weight.' }).ok,
    ).toBe(true);
    expect(check({ ...good, summary: 'Prices from 32750 to 39500 baht.' }).ok).toBe(true);
    expect(check({ ...good, summary: 'Prices near 40,000 baht.' }).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe('Anthropic adapter (against a fake HTTP endpoint)', () => {
  const KEY = 'sk-ant-test-key-1234567890abcdef';
  const okBody = {
    content: [{ type: 'text', text: '{"summary":"ok ok ok ok ok"}' }],
    usage: { input_tokens: 120, output_tokens: 45 },
    model: 'claude-sonnet-5-5',
  };
  const fake = (status: number, body: unknown, seen: { url?: string; init?: RequestInit }[] = []) =>
    (async (url: string, init: RequestInit) => {
      seen.push({ url, init });
      return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
    }) as unknown as typeof fetch;
  const req = { system: 'sys', user: 'facts', maxTokens: 300, timeoutMs: 2000 };

  it('sends the documented request, keeps the key in the header only, and parses text and token usage', async () => {
    const seen: { url?: string; init?: RequestInit }[] = [];
    const p = new AnthropicProvider({
      apiKey: KEY,
      model: 'claude-sonnet-5-5',
      fetch: fake(200, okBody, seen),
    });
    const res = await p.complete(req);
    expect(res).toEqual({
      text: '{"summary":"ok ok ok ok ok"}',
      inputTokens: 120,
      outputTokens: 45,
      model: 'claude-sonnet-5-5',
    });
    expect(seen[0]!.url).toBe('https://api.anthropic.com/v1/messages');
    const headers = seen[0]!.init!.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe(KEY);
    expect(headers['anthropic-version']).toBe('2023-06-01');
    const body = JSON.parse(String(seen[0]!.init!.body));
    expect(body).toEqual({
      model: 'claude-sonnet-5-5',
      max_tokens: 300,
      system: 'sys',
      messages: [{ role: 'user', content: 'facts' }],
    });
    expect(JSON.stringify(body)).not.toContain(KEY);
    const custom = new AnthropicProvider({
      apiKey: KEY,
      model: 'm',
      baseUrl: 'https://gateway.example.test/',
      fetch: fake(200, okBody, seen),
    });
    await custom.complete(req);
    expect(seen[1]!.url).toBe('https://gateway.example.test/v1/messages');
  });

  it('maps failures to safe error codes whose messages never contain the key or the response body', async () => {
    const run = async (status: number, body: unknown = { error: { message: `leak ${KEY}` } }) => {
      const p = new AnthropicProvider({ apiKey: KEY, model: 'm', fetch: fake(status, body) });
      try {
        await p.complete(req);
        return 'no error';
      } catch (e) {
        expect(e).toBeInstanceOf(AiProviderError);
        expect(String((e as Error).message)).not.toContain(KEY);
        expect(String((e as Error).message)).not.toContain('leak');
        return (e as AiProviderError).code;
      }
    };
    expect(await run(401)).toBe('auth');
    expect(await run(403)).toBe('auth');
    expect(await run(429)).toBe('rate_limited');
    expect(await run(500)).toBe('unavailable');
    expect(await run(529)).toBe('unavailable');
    expect(await run(400)).toBe('bad_response');
    expect(await run(200, 'not json')).toBe('bad_response');
    expect(await run(200, { content: [] })).toBe('bad_response');
    expect(await run(200, { content: [{ type: 'tool_use' }] })).toBe('bad_response');
    const down = new AnthropicProvider({
      apiKey: KEY,
      model: 'm',
      fetch: (async () => {
        throw new TypeError('connect ECONNREFUSED');
      }) as unknown as typeof fetch,
    });
    await expect(down.complete(req)).rejects.toMatchObject({ code: 'unavailable' });
    const slow = new AnthropicProvider({
      apiKey: KEY,
      model: 'm',
      fetch: ((_u: string, init: RequestInit) =>
        new Promise((_res, rej) =>
          init.signal!.addEventListener('abort', () => rej(new Error('aborted'))),
        )) as unknown as typeof fetch,
    });
    await expect(slow.complete({ ...req, timeoutMs: 20 })).rejects.toMatchObject({
      code: 'timeout',
    });
  });

  it('the environment requires a key for the real provider and refuses the mock in production', () => {
    const base = {
      NODE_ENV: 'development',
      MONGODB_URI: 'mongodb://x/y',
      JWT_ACCESS_SECRET: 'a'.repeat(40),
      MFA_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
    };
    expect(() => parseEnv(apiEnvSchema, { ...base, AI_PROVIDER: 'anthropic' })).toThrow(
      /AI_API_KEY/,
    );
    expect(() =>
      parseEnv(apiEnvSchema, { ...base, AI_PROVIDER: 'anthropic', AI_API_KEY: 'short' }),
    ).toThrow();
    expect(
      parseEnv(apiEnvSchema, { ...base, AI_PROVIDER: 'anthropic', AI_API_KEY: KEY }).AI_MODEL,
    ).toBe('claude-sonnet-5-5');
    expect(parseEnv(apiEnvSchema, base).AI_PROVIDER).toBe('none');
  });
});

// ---------------------------------------------------------------------------
// Integration
// ---------------------------------------------------------------------------
async function ownerWithAnimal(over: Record<string, unknown> = {}) {
  const { id, email } = await register(h.app);
  for (const key of ['farm_owner', 'seller'])
    await UserRole.create({ userId: id, roleId: (await Role.findOne({ key }))!._id });
  const owner = await login(h.app, email);
  const farmId = await makeFarm(h.app, owner, 'Assess Farm');
  const animal = await mkAnimal(h.app, owner, farmId, {
    animalTypeId: buffalo,
    sex: 'female',
    breed: 'swamp',
    name: 'Bua Secret Name',
    birthDate: '2024-01-15',
    notes: 'private note about the owner',
    ...over,
  });
  return { owner, farmId, animalId: animal.id, userId: id };
}
const addWeight = (
  farmId: string,
  animalId: string,
  user: string,
  daysAgo: number,
  kg: number,
  method = 'scale',
) =>
  WeightRecord.create({
    farmId,
    animalId,
    createdBy: user,
    weighedOn: new Date(Date.now() - daysAgo * 86_400_000),
    weightKg: kg,
    method,
  } as never);
const addExpense = (
  farmId: string,
  animalId: string | null,
  user: string,
  daysAgo: number,
  amountMinor: number,
  category = 'feed',
) =>
  FarmExpense.create({
    farmId,
    animalId,
    createdBy: user,
    expenseDate: new Date(Date.now() - daysAgo * 86_400_000),
    amountMinor,
    category,
    description: 'Secret supplier invoice',
    supplier: 'Private Supplier Co',
  } as never);
let sn = 0;
/** A completed (DELIVERED) FARM+ animal sale of another farm. */
const sale = (
  priceMinor: number,
  o: { sex?: string; typeKey?: string; daysAgo?: number; farmId?: Types.ObjectId } = {},
) =>
  Order.collection.insertOne({
    orderNo: `TEST-${++sn}`,
    kind: 'animal',
    status: 'DELIVERED',
    farmId: o.farmId ?? new Types.ObjectId(),
    deliveredAt: new Date(Date.now() - (o.daysAgo ?? 10) * 86_400_000),
    items: [
      {
        type: 'animal',
        unitPriceMinor: priceMinor,
        animal: { animalTypeKey: o.typeKey ?? 'buffalo', sex: o.sex ?? 'female' },
      },
    ],
  } as never);
const SALES = [3_000_000, 3_200_000, 3_500_000, 3_800_000, 4_000_000, 4_500_000];
const run = (s: Session, farmId: string, animalId: string, body: object = {}) =>
  request(h.app)
    .post(`${API}/farms/${farmId}/animals/${animalId}/assessments`)
    .set(s.auth)
    .send(body);
const generic = (s: Session, m: 'get' | 'post', path: string, body?: object) =>
  request(h.app)[m](`${API}${path}`).set(s.auth).send(body);

describe('assessments (end to end)', () => {
  it('an animal with no records still gets an honest assessment: gaps disclosed, nothing invented, fully traceable', async () => {
    const o = await ownerWithAnimal();
    const res = await run(o.owner, o.farmId, o.animalId, { includeAiExplanation: false });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const a = res.body.assessment;
    expect(a).toMatchObject({
      animalId: o.animalId,
      animalType: { key: 'buffalo' },
      sex: 'female',
      readinessScore: null,
      estimatedPriceRange: null,
      expectedProceeds: [],
      confidence: { level: 'low', basis: 'data_completeness' },
      narrative: { status: 'not_requested' },
      review: { status: 'pending' },
    });
    expect(a.dataQualityWarnings.map((x: any) => x.code)).toEqual(
      expect.arrayContaining([
        'no_weight_records',
        'no_market_data',
        'no_criteria',
        'no_cost_records',
      ]),
    );
    expect(a.modelVersion).toBe(ENGINE_VERSION);
    expect(a.disclaimer).toContain('not veterinary diagnosis');
    expect(a.assessmentDate).toBeTruthy();
    expect(a.requestedBy.id).toBe(o.userId);
    // stored and listed: history
    const list = await generic(
      o.owner,
      'get',
      `/farms/${o.farmId}/animals/${o.animalId}/assessments`,
    );
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0]).toMatchObject({
      id: a.id,
      review: 'pending',
      confidence: 'low',
      priceRange: null,
    });
    expect(
      (await generic(o.owner, 'get', `/farms/${o.farmId}/assessments/${a.id}`)).body.assessment.id,
    ).toBe(a.id);
    expect(res.headers['cache-control'] ?? '').not.toContain('public');
  });

  it('with records and market data it produces a traceable range, proceeds after the platform fee, costs and growth', async () => {
    await CommissionRule.create({
      name: 'Buffalo 5%',
      feeBps: 500,
      categories: ['buffalo'],
      startsAt: new Date('2020-01-01'),
      priority: 50,
      active: true,
      version: 1,
      createdBy: new Types.ObjectId(),
      updatedBy: new Types.ObjectId(),
    });
    for (const p of SALES) await sale(p);
    await sale(9_900_000, { sex: 'male' }); // wrong sex: not counted
    await sale(9_900_000, { typeKey: 'cattle' }); // wrong type: not counted
    await sale(9_900_000, { daysAgo: 400 }); // outside the window: not counted
    const o = await ownerWithAnimal();
    await sale(9_900_000, { farmId: new Types.ObjectId(o.farmId) }); // the owner's own farm: not counted
    await addWeight(o.farmId, o.animalId, o.userId, 120, 300);
    await addWeight(o.farmId, o.animalId, o.userId, 5, 420);
    await addExpense(o.farmId, o.animalId, o.userId, 90, 500_000);
    await addExpense(o.farmId, o.animalId, o.userId, 30, 250_000, 'veterinary');
    await addExpense(o.farmId, null, o.userId, 30, 999_999); // farm-wide: not included
    const a = (await run(o.owner, o.farmId, o.animalId, { includeAiExplanation: false })).body
      .assessment;
    expect(a.estimatedPriceRange).toMatchObject({
      lowMinor: 3_275_000,
      midMinor: 3_650_000,
      highMinor: 3_950_000,
      basis: 'farmplus_sales',
      sampleSize: 6,
    });
    expect(a.priceBases[0]).toMatchObject({
      sampleSize: 6,
      used: true,
      minMinor: null,
      maxMinor: null,
    }); // extremes of individual sales are never exposed
    expect(
      a.expectedProceeds.map((p: any) => [
        p.scenario,
        p.platformFeeMinor,
        p.netProceedsMinor,
        p.netOverRecordedCostMinor,
      ]),
    ).toEqual([
      ['low', 163_750, 3_111_250, 2_361_250],
      ['mid', 182_500, 3_467_500, 2_717_500],
      ['high', 197_500, 3_752_500, 3_002_500],
    ]);
    expect(a.costSummary).toMatchObject({ recordedCostMinor: 750_000, recordCount: 2 });
    expect(a.dataQualityWarnings.map((x: any) => x.code)).toContain('farm_wide_costs_excluded');
    expect(a.growth).toMatchObject({ weightCount: 2, latestKg: 420, averageDailyGainG: 1043 });
    // traceability: the stored inputs reproduce the stored growth figures
    const doc = (await AiAssessment.findById(a.id))!;
    const inputs = doc.inputs as any;
    const rebuilt = summarizeGrowth(
      inputs.weights.map(([on, kg, method]: [string, number, string]) => ({
        on: new Date(on),
        kg,
        method,
      })),
      new Date(inputs.asOf),
    );
    expect(rebuilt.averageDailyGainG).toBe(a.growth.averageDailyGainG);
    expect(inputs.market[0]).toMatchObject({
      source: 'farmplus_sales',
      sampleSize: 6,
      p25Minor: 3_275_000,
      used: true,
    });
    expect(doc.engineVersion).toBe(ENGINE_VERSION);
    expect(inputs.settings).toMatchObject({ minMarketSamples: 5, marketWindowDays: 180 });
  });

  it('real completed marketplace sales qualify as market data (the query matches what the order flow stores)', async () => {
    const { createWorld } = await import('./commerce-fixtures');
    const w = await createWorld(h);
    const d = await w.deal({ delivery: false, price: 4_100_000 });
    const order = await w.pickup(d);
    const { payOrder } = await import('./finance-helpers');
    await payOrder(h, d.buyer, order);
    await w.complete(d, order);
    expect((await Order.findById(order.id))?.status).toBe('DELIVERED');
    const o = await ownerWithAnimal();
    await Setting.updateOne(
      { key: 'ai.minMarketSamples' },
      { $set: { value: 1 } },
      { upsert: true },
    );
    const a = (await run(o.owner, o.farmId, o.animalId, { includeAiExplanation: false })).body
      .assessment;
    expect(
      a.priceBases.find((b: any) => b.source === 'farmplus_sales')?.sampleSize,
    ).toBeGreaterThanOrEqual(1);
    expect(a.estimatedPriceRange).not.toBeNull();
  });

  it('too few market observations: no range, the shortfall is disclosed, confidence low — and imported authorised data can fill the gap', async () => {
    for (const p of SALES.slice(0, 4)) await sale(p);
    const o = await ownerWithAnimal();
    await addWeight(o.farmId, o.animalId, o.userId, 5, 400);
    const a = (await run(o.owner, o.farmId, o.animalId, { includeAiExplanation: false })).body
      .assessment;
    expect(a.estimatedPriceRange).toBeNull();
    expect(
      a.dataQualityWarnings.find((x: any) => x.code === 'insufficient_market_data').message,
    ).toContain('4 observation');
    expect(a.confidence.level).toBe('low');
    // an administrator imports prices with a source and an authorisation; they are used separately, never blended with the sales
    for (const p of [3_000_000, 3_300_000, 3_600_000, 3_900_000, 4_200_000]) {
      const r = await generic(admin, 'post', '/admin/ai/market-data', {
        animalTypeKey: 'buffalo',
        kind: 'per_head',
        priceMinor: p,
        observedOn: new Date(Date.now() - 20 * 86_400_000).toISOString().slice(0, 10),
        source: 'Provincial livestock market report',
        authorization: 'Published under an open-data licence',
      });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
    }
    const b = (await run(o.owner, o.farmId, o.animalId, { includeAiExplanation: false })).body
      .assessment;
    expect(b.estimatedPriceRange).toMatchObject({
      basis: 'imported_per_head',
      lowMinor: 3_300_000,
      midMinor: 3_600_000,
      highMinor: 3_900_000,
      sampleSize: 5,
    });
    expect(b.priceBases.map((x: any) => [x.source, x.sampleSize, x.used])).toEqual([
      ['farmplus_sales', 4, false],
      ['imported_per_head', 5, true],
    ]);
  });
});

// ---------------------------------------------------------------------------
describe('criteria are administrator-supplied, sourced, versioned and gate the score', () => {
  const body = (over: Record<string, unknown> = {}) => ({
    animalTypeKey: 'buffalo',
    rules: { minAgeDays: 700, minWeightKg: 350 },
    source: 'Farm cooperative policy 2026',
    ...over,
  });
  const post = (b: object, who: Session = admin) => generic(who, 'post', '/admin/ai/criteria', b);

  it('only animal-type managers can read or change them; a source is mandatory; "validated" needs a reference; bad rules are refused', async () => {
    const mod = await createStaff(h.app, ['moderator']);
    for (const who of [await createUser(h.app), mod]) {
      expect((await generic(who, 'get', '/admin/ai/criteria')).status).toBe(403);
      expect((await post(body(), who)).status).toBe(403);
    }
    expect((await request(h.app).get(`${API}/admin/ai/criteria`)).status).toBe(401);
    const bad = async (over: Record<string, unknown>, path: string) => {
      const r = await post(body(over));
      expect(r.status, JSON.stringify(over)).toBe(400);
      expect(JSON.stringify(r.body.error.details)).toContain(path);
    };
    await bad({ source: '' }, 'source');
    await bad({ rules: {} }, 'rules');
    await bad({ rules: { minWeightKg: -5 } }, 'minWeightKg');
    await bad({ rules: { targetWeightKg: { min: 500, max: 400 } } }, 'targetWeightKg');
    await bad({ validated: true }, 'validationReference');
    await bad({ animalTypeKey: 'Bad Key' }, 'animalTypeKey');
    await bad({ owner: 'me' }, 'owner');
    expect((await post(body({ animalTypeKey: 'unicorn' }))).status).toBe(400);
  });

  it('a change is a new version; old versions stay; each assessment records the version it used; the score appears only once validated', async () => {
    const o = await ownerWithAnimal();
    await addWeight(o.farmId, o.animalId, o.userId, 100, 300);
    await addWeight(o.farmId, o.animalId, o.userId, 2, 420);
    const noCriteria = (await run(o.owner, o.farmId, o.animalId, { includeAiExplanation: false }))
      .body.assessment;
    expect(noCriteria).toMatchObject({ criteria: null, readinessScore: null });
    const v1 = (await post(body())).body.criteria;
    expect(v1).toMatchObject({
      version: 1,
      active: true,
      validated: false,
      animalTypeKey: 'buffalo',
    });
    const a1 = (await run(o.owner, o.farmId, o.animalId, { includeAiExplanation: false })).body
      .assessment;
    expect(a1.criteria).toMatchObject({
      key: 'buffalo',
      version: 1,
      validated: false,
      source: 'Farm cooperative policy 2026',
    });
    expect(a1.readinessScore).toBeNull();
    expect(a1.modelVersion).toContain('criteria:buffalo@v1 (unvalidated)');
    expect(a1.readinessFactors.find((f: any) => f.key === 'min_weight')).toMatchObject({
      status: 'met',
      basis: 'configured_criteria',
    });
    const v2 = (
      await post(
        body({
          validated: true,
          validationReference: 'Validation study 2026-04',
          rules: { minAgeDays: 700, minWeightKg: 500 },
        }),
      )
    ).body.criteria;
    expect(v2).toMatchObject({
      version: 2,
      validated: true,
      validationReference: 'Validation study 2026-04',
    });
    const all = (await generic(admin, 'get', '/admin/ai/criteria')).body.criteria.filter(
      (c: any) => c.animalTypeKey === 'buffalo',
    );
    expect(all.map((c: any) => [c.version, c.active])).toEqual([
      [2, true],
      [1, false],
    ]);
    const a2 = (await run(o.owner, o.farmId, o.animalId, { includeAiExplanation: false })).body
      .assessment;
    expect(a2.criteria.version).toBe(2);
    expect(a2.readinessScore).toBe(50); // age met, 420 kg below the 500 kg minimum
    expect(a2.readinessScoreNote).toContain('Validation study 2026-04');
    // the earlier assessment is untouched by the new version
    const again = (await generic(o.owner, 'get', `/farms/${o.farmId}/assessments/${a1.id}`)).body
      .assessment;
    expect(again.criteria.version).toBe(1);
    expect(again.readinessScore).toBeNull();
    expect(await AiCriteria.countDocuments({ animalTypeKey: 'buffalo', active: true })).toBe(1);
  });
});

describe('access control and data scope', () => {
  it('only members of the farm can assess or read; other farms and strangers get 404; the farm id is part of every lookup', async () => {
    const a = await ownerWithAnimal();
    const b = await ownerWithAnimal();
    const asm = (await run(a.owner, a.farmId, a.animalId, { includeAiExplanation: false })).body
      .assessment;
    const stranger = await createUser(h.app);
    expect((await run(stranger, a.farmId, a.animalId)).status).toBe(404);
    expect(
      (await generic(stranger, 'get', `/farms/${a.farmId}/assessments/${asm.id}`)).status,
    ).toBe(404);
    expect((await generic(stranger, 'get', `/farms/${a.farmId}/assessments`)).status).toBe(404);
    // farm B cannot reach farm A's animal or assessment, even knowing the ids
    expect((await run(b.owner, b.farmId, a.animalId)).status).toBe(404);
    expect((await generic(b.owner, 'get', `/farms/${b.farmId}/assessments/${asm.id}`)).status).toBe(
      404,
    );
    expect(
      (
        await generic(b.owner, 'post', `/farms/${b.farmId}/assessments/${asm.id}/review`, {
          decision: 'dismissed',
        })
      ).status,
    ).toBe(404);
    expect(
      (await generic(b.owner, 'get', `/farms/${b.farmId}/animals/${a.animalId}/assessments`)).body
        .items ?? [],
    ).toHaveLength(0);
    expect(
      (
        await request(h.app)
          .post(`${API}/farms/${a.farmId}/animals/${a.animalId}/assessments`)
          .send({})
      ).status,
    ).toBe(401);
    expect((await run(a.owner, a.farmId, new Types.ObjectId().toString())).status).toBe(404);
    expect((await run(a.owner, a.farmId, 'not-an-id')).status).toBe(404);
  });

  it('members without expense permission get an assessment without costs (and are told); only owners/managers may review', async () => {
    const o = await ownerWithAnimal();
    await addWeight(o.farmId, o.animalId, o.userId, 5, 400);
    await addExpense(o.farmId, o.animalId, o.userId, 10, 123_456);
    const worker = await createUser(h.app);
    const viewer = await createUser(h.app);
    const manager = await createUser(h.app);
    await addFarmMember(h.app, o.owner, o.farmId, worker, 'worker');
    await addFarmMember(h.app, o.owner, o.farmId, viewer, 'viewer');
    await addFarmMember(h.app, o.owner, o.farmId, manager, 'manager');
    const w = (await run(worker, o.farmId, o.animalId, { includeAiExplanation: false })).body
      .assessment;
    expect(w.costSummary).toBeNull();
    expect(w.dataQualityWarnings.map((x: any) => x.code)).toContain('cost_not_authorized');
    expect(JSON.stringify(w)).not.toContain('123456');
    expect(JSON.stringify((await AiAssessment.findById(w.id))!.inputs)).not.toContain('123456');
    const own = (await run(o.owner, o.farmId, o.animalId, { includeAiExplanation: false })).body
      .assessment;
    expect(own.costSummary.recordedCostMinor).toBe(123_456);
    // viewers can read but not review
    expect((await generic(viewer, 'get', `/farms/${o.farmId}/assessments/${own.id}`)).status).toBe(
      200,
    );
    for (const who of [worker, viewer]) {
      expect(
        (
          await generic(who, 'post', `/farms/${o.farmId}/assessments/${own.id}/review`, {
            decision: 'accepted',
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await generic(
            who,
            'post',
            `/farms/${o.farmId}/assessments/${own.id}/recommendations/${own.recommendations[0].id}/dismiss`,
          )
        ).status,
      ).toBe(403);
    }
    expect(
      (
        await generic(manager, 'post', `/farms/${o.farmId}/assessments/${own.id}/review`, {
          decision: 'accepted',
        })
      ).status,
    ).toBe(200);
    // platform staff (farms.read) may read an assessment but cannot run one, and cannot review
    expect((await generic(admin, 'get', `/farms/${o.farmId}/assessments/${own.id}`)).status).toBe(
      200,
    );
    const staffRun = await run(admin, o.farmId, o.animalId);
    expect(staffRun.status).toBe(403);
    expect(staffRun.body.error.code).toBe('MEMBERS_ONLY');
    expect(
      (
        await generic(admin, 'post', `/farms/${o.farmId}/assessments/${own.id}/review`, {
          decision: 'dismissed',
        })
      ).status,
    ).toBe(403);
  });

  it('an archived animal is refused; a sold animal is assessed with a serious warning', async () => {
    const o = await ownerWithAnimal();
    await Animal.updateOne({ _id: o.animalId }, { $set: { currentStatus: 'sold' } });
    const a = (await run(o.owner, o.farmId, o.animalId, { includeAiExplanation: false })).body
      .assessment;
    expect(a.dataQualityWarnings.find((x: any) => x.code === 'animal_not_available').severity).toBe(
      'serious',
    );
    expect(a.readinessFactors.find((f: any) => f.key === 'animal_status').status).toBe('not_met');
    await Animal.updateOne({ _id: o.animalId }, { $set: { archivedAt: new Date() } });
    expect((await run(o.owner, o.farmId, o.animalId)).status).toBe(409);
  });
});

describe('health records', () => {
  it('feed counts and a running withdrawal period into the assessment — as recorded facts, never as a diagnosis', async () => {
    const o = await ownerWithAnimal();
    await addWeight(o.farmId, o.animalId, o.userId, 5, 400);
    await HealthRecord.create({
      farmId: o.farmId,
      animalId: o.animalId,
      createdBy: o.userId,
      type: 'treatment',
      recordedOn: new Date(Date.now() - 3 * 86_400_000),
      title: 'Secret private treatment title',
      symptoms: 'private symptoms text',
      medication: { name: 'Private Drug' },
      withdrawalEndsOn: new Date(Date.now() + 10 * 86_400_000),
    } as never);
    const a = (await run(o.owner, o.farmId, o.animalId)).body.assessment;
    expect(a.health).toMatchObject({ recordCount: 1, last90Days: { treatment: 1 } });
    expect(a.health.withdrawalEndsOn).toBeTruthy();
    expect(a.readinessFactors.find((f: any) => f.key === 'withdrawal_period').status).toBe(
      'not_met',
    );
    expect(a.dataQualityWarnings.find((x: any) => x.code === 'withdrawal_running').severity).toBe(
      'serious',
    );
    // free-text health details never reach the AI or the stored inputs
    const sent = `${h.ai!.lastRequest!.system}${h.ai!.lastRequest!.user}`;
    const stored = JSON.stringify((await AiAssessment.findById(a.id))!.inputs);
    for (const secret of [
      'Secret private treatment title',
      'private symptoms text',
      'Private Drug',
    ]) {
      expect(sent).not.toContain(secret);
      expect(stored).not.toContain(secret);
      expect(JSON.stringify(a)).not.toContain(secret);
    }
  });
});

describe('the owner stays in control', () => {
  it('review and dismissal are recorded decisions: assessments are immutable, nothing is listed or sold, the animal is untouched', async () => {
    const o = await ownerWithAnimal();
    for (const p of SALES) await sale(p);
    await addWeight(o.farmId, o.animalId, o.userId, 5, 400);
    const listings = await Listing.countDocuments();
    const orders = await Order.countDocuments();
    const before = await Animal.findById(o.animalId).lean();
    const a = (await run(o.owner, o.farmId, o.animalId, { includeAiExplanation: false })).body
      .assessment;
    expect(a.estimatedPriceRange).not.toBeNull();
    const snapshot = JSON.stringify((await AiAssessment.findById(a.id).lean())!.result);
    const rev = await generic(o.owner, 'post', `/farms/${o.farmId}/assessments/${a.id}/review`, {
      decision: 'accepted',
      note: 'Will think about it',
    });
    expect(rev.status, JSON.stringify(rev.body)).toBe(200);
    expect(rev.body.assessment.review).toMatchObject({
      status: 'accepted',
      note: 'Will think about it',
      reviewedBy: { id: o.userId },
    });
    expect(rev.body.assessment.review.reviewedAt).toBeTruthy();
    const dis = await generic(o.owner, 'post', `/farms/${o.farmId}/assessments/${a.id}/review`, {
      decision: 'dismissed',
    });
    expect(dis.body.assessment.review.status).toBe('dismissed');
    expect((await AiAssessment.findById(a.id))!.review.history).toHaveLength(2); // every decision is kept
    const rid = a.recommendations[0].id;
    const one = await generic(
      o.owner,
      'post',
      `/farms/${o.farmId}/assessments/${a.id}/recommendations/${rid}/dismiss`,
    );
    expect(one.body.assessment.recommendations.find((r: any) => r.id === rid)).toMatchObject({
      dismissed: true,
      dismissedBy: { id: o.userId },
    });
    expect(
      (
        await generic(
          o.owner,
          'post',
          `/farms/${o.farmId}/assessments/${a.id}/recommendations/nope/dismiss`,
        )
      ).status,
    ).toBe(404);
    // the calculated content never changes
    expect(JSON.stringify((await AiAssessment.findById(a.id).lean())!.result)).toBe(snapshot);
    for (const m of ['patch', 'put', 'delete'] as const)
      expect(
        (
          await request(h.app)
            [m](`${API}/farms/${o.farmId}/assessments/${a.id}`)
            .set(o.owner.auth)
            .send({ result: {} })
        ).status,
      ).toBe(404);
    // …and nothing was published, sold or changed
    expect(await Listing.countDocuments()).toBe(listings);
    expect(await Order.countDocuments()).toBe(orders);
    expect(await Animal.findById(o.animalId).lean()).toEqual(before);
    for (const bad of [
      { decision: 'maybe' },
      {},
      { decision: 'accepted', price: 1 },
      { decision: 'accepted', note: 'x'.repeat(600) },
    ])
      expect(
        (await generic(o.owner, 'post', `/farms/${o.farmId}/assessments/${a.id}/review`, bad))
          .status,
        JSON.stringify(bad),
      ).toBe(400);
  });

  it('lists the farm’s assessments, filterable by review status, newest first', async () => {
    const o = await ownerWithAnimal();
    const ids: string[] = [];
    for (let i = 0; i < 3; i++)
      ids.push(
        (await run(o.owner, o.farmId, o.animalId, { includeAiExplanation: false })).body.assessment
          .id,
      );
    await generic(o.owner, 'post', `/farms/${o.farmId}/assessments/${ids[0]}/review`, {
      decision: 'dismissed',
    });
    const all = (await generic(o.owner, 'get', `/farms/${o.farmId}/assessments`)).body;
    expect(all.total).toBe(3);
    expect(all.items.map((x: any) => x.id)).toEqual([...ids].reverse());
    const pending = (await generic(o.owner, 'get', `/farms/${o.farmId}/assessments?status=pending`))
      .body;
    expect(pending.items.map((x: any) => x.id)).toEqual([ids[2], ids[1]]);
    expect(
      (await generic(o.owner, 'get', `/farms/${o.farmId}/assessments?pageSize=1&page=2`)).body
        .items,
    ).toHaveLength(1);
    expect(
      (await generic(o.owner, 'get', `/farms/${o.farmId}/assessments?pageSize=500`)).status,
    ).toBe(400);
  });
});

// ---------------------------------------------------------------------------
describe('the AI explanation: grounded, minimised, optional and never trusted', () => {
  it('a valid explanation is labelled as AI-generated, recorded in the model version, and the model was given facts only — no names, notes, suppliers or identifiers', async () => {
    const o = await ownerWithAnimal();
    for (const p of SALES) await sale(p);
    await addWeight(o.farmId, o.animalId, o.userId, 100, 300);
    await addWeight(o.farmId, o.animalId, o.userId, 5, 420);
    await addExpense(o.farmId, o.animalId, o.userId, 20, 250_000);
    const calls0 = h.ai!.calls;
    const a = (await run(o.owner, o.farmId, o.animalId)).body.assessment;
    expect(h.ai!.calls - calls0).toBe(1);
    expect(a.narrative).toMatchObject({ status: 'ok', provider: 'mock', model: 'mock-model-1' });
    expect(a.narrative.summary).toBeTruthy();
    expect(a.narrative.label).toContain('AI-generated');
    expect(a.modelVersion).toBe(`${ENGINE_VERSION} · ai:mock:mock-model-1`);
    const sent = h.ai!.lastRequest!;
    const everything = `${sent.system}\n${sent.user}`;
    for (const secret of [
      'Bua Secret Name',
      'private note',
      'Secret supplier',
      'Private Supplier',
      'Assess Farm',
      o.userId,
      o.farmId,
      o.animalId,
      '@example.test',
    ])
      expect(everything, secret).not.toContain(secret);
    expect(sent.user).toContain('3650'); // …but it does get the figures it is meant to explain, in baht
    expect(sent.system).toContain('ONLY the facts');
    expect(sent.maxTokens).toBe(h.env.AI_MAX_OUTPUT_TOKENS);
    // what was sent is recorded with the assessment (auditability), and holds no personal data either
    const stored = JSON.stringify((await AiAssessment.findById(a.id))!.inputs);
    expect(stored).toContain('aiFactsSent');
    for (const secret of [
      'Bua Secret Name',
      'private note',
      'Secret supplier',
      'Private Supplier',
      'Assess Farm',
    ])
      expect(stored, secret).not.toContain(secret);
  });

  it('invalid model output is rejected safely: not shown, not stored, the figures are unaffected, and the rejection is logged with its reason', async () => {
    const o = await ownerWithAnimal();
    await addWeight(o.farmId, o.animalId, o.userId, 5, 420);
    const expectations: [string, string][] = [
      ['not_json', 'AI_OUTPUT_NOT_JSON'],
      ['invented_number', 'AI_OUTPUT_UNGROUNDED_NUMBER'],
      ['diagnosis', 'AI_OUTPUT_BLOCKED_TERM'],
      ['oversize', 'AI_OUTPUT_SCHEMA'],
      ['extra_field', 'AI_OUTPUT_SCHEMA'],
      ['link', 'AI_OUTPUT_LINK_OR_MARKUP'],
    ];
    const baseline = (await run(o.owner, o.farmId, o.animalId, { includeAiExplanation: false }))
      .body.assessment;
    for (const [mode, code] of expectations) {
      h.ai!.mode = mode as never;
      const a = (await run(o.owner, o.farmId, o.animalId)).body.assessment;
      expect(a.narrative, mode).toMatchObject({
        status: 'rejected',
        summary: null,
        observations: [],
        questionsForOwner: [],
      });
      expect(a.narrative.reason).toContain(code);
      expect(a.modelVersion).toBe(ENGINE_VERSION); // no AI in the version: it contributed nothing
      expect(JSON.stringify(await AiAssessment.findById(a.id).lean())).not.toMatch(
        /987654|antibiotic|example\.test\/prices/,
      );
      expect(a.growth).toEqual(baseline.growth);
      expect(a.confidence).toEqual(baseline.confidence);
      const row = await AiUsageLog.findOne({ assessmentId: a.id });
      expect(row, mode).toMatchObject({ status: 'rejected', errorCode: code });
    }
    h.ai!.mode = 'fenced_json';
    expect((await run(o.owner, o.farmId, o.animalId)).body.assessment.narrative.status).toBe('ok');
  });

  it('a provider failure never breaks the assessment: it is created without an explanation and the error is logged by code', async () => {
    const o = await ownerWithAnimal();
    for (const code of [
      'timeout',
      'rate_limited',
      'auth',
      'unavailable',
      'bad_response',
    ] as const) {
      h.ai!.failWith = code;
      const res = await run(o.owner, o.farmId, o.animalId);
      expect(res.status, code).toBe(201);
      expect(res.body.assessment.narrative).toMatchObject({ status: 'failed', summary: null });
      expect(res.body.assessment.narrative.reason).toContain('figures are unaffected');
      expect(res.body.assessment.estimatedPriceRange).toBeNull(); // (no market data in this test) — the engine result stands on its own
      expect(await AiUsageLog.findOne({ assessmentId: res.body.assessment.id })).toMatchObject({
        status: 'error',
        errorCode: code,
      });
    }
  });

  it('is optional: not requested → no call; no provider configured → skipped with a reason; switched off in settings → skipped', async () => {
    const o = await ownerWithAnimal();
    const c0 = h.ai!.calls;
    expect(
      (await run(o.owner, o.farmId, o.animalId, { includeAiExplanation: false })).body.assessment
        .narrative.status,
    ).toBe('not_requested');
    expect(h.ai!.calls).toBe(c0);
    const noAi = createApp(
      { ...h.env, AI_PROVIDER: 'none' },
      { video: h.video, payments: h.payments, ai: null },
    );
    const r = await request(noAi)
      .post(`${API}/farms/${o.farmId}/animals/${o.animalId}/assessments`)
      .set(o.owner.auth)
      .send({});
    expect(r.status).toBe(201);
    expect(r.body.assessment.narrative).toMatchObject({
      status: 'skipped',
      reason: expect.stringContaining('No AI provider'),
    });
    await Setting.updateOne(
      { key: 'ai.narrativeEnabled' },
      { $set: { value: false } },
      { upsert: true },
    );
    const off = (await run(o.owner, o.farmId, o.animalId)).body.assessment;
    expect(off.narrative).toMatchObject({ status: 'skipped' });
    expect(h.ai!.calls).toBe(c0);
  });

  it('usage is budgeted: per-user and platform daily limits skip the explanation (the assessment still runs) and the skip is logged', async () => {
    const o = await ownerWithAnimal();
    await AiUsageLog.deleteMany({});
    await Setting.updateOne(
      { key: 'ai.perUserDailyNarratives' },
      { $set: { value: 2 } },
      { upsert: true },
    );
    const statuses: string[] = [];
    for (let i = 0; i < 4; i++)
      statuses.push((await run(o.owner, o.farmId, o.animalId)).body.assessment.narrative.status);
    expect(statuses).toEqual(['ok', 'ok', 'skipped', 'skipped']);
    expect(await AiUsageLog.countDocuments({ status: 'skipped', errorCode: 'budget_user' })).toBe(
      2,
    );
    await Setting.updateOne({ key: 'ai.perUserDailyNarratives' }, { $set: { value: 100 } });
    await Setting.updateOne(
      { key: 'ai.dailyNarrativeLimit' },
      { $set: { value: 2 } },
      { upsert: true },
    );
    const other = await ownerWithAnimal();
    const blocked = (await run(other.owner, other.farmId, other.animalId)).body.assessment;
    expect(blocked.narrative).toMatchObject({
      status: 'skipped',
      reason: expect.stringContaining('daily AI budget'),
    });
  });

  it('the API key never leaves the server: not in responses, audit logs, usage rows or stored assessments', async () => {
    const KEY = 'sk-ant-test-key-1234567890abcdef';
    const sent: { headers: Record<string, string>; body: string }[] = [];
    const fakeFetch = (async (_u: string, init: RequestInit) => {
      sent.push({ headers: init.headers as Record<string, string>, body: String(init.body) });
      return new Response(
        JSON.stringify({
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                summary: 'A plain reading of the recorded facts only.',
                observations: ['Based on your records.'],
                questionsForOwner: [],
              }),
            },
          ],
          usage: { input_tokens: 200, output_tokens: 60 },
          model: 'claude-sonnet-5-5',
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;
    const app = createApp(h.env, {
      video: h.video,
      payments: h.payments,
      ai: new AnthropicProvider({ apiKey: KEY, model: 'claude-sonnet-5-5', fetch: fakeFetch }),
    });
    const o = await ownerWithAnimal();
    const res = await request(app)
      .post(`${API}/farms/${o.farmId}/animals/${o.animalId}/assessments`)
      .set(o.owner.auth)
      .send({});
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.assessment.narrative).toMatchObject({
      status: 'ok',
      provider: 'anthropic',
      model: 'claude-sonnet-5-5',
    });
    expect(res.body.assessment.modelVersion).toContain('ai:anthropic:claude-sonnet-5-5');
    expect(sent[0]!.headers['x-api-key']).toBe(KEY);
    expect(sent[0]!.body).not.toContain(KEY);
    const dump =
      JSON.stringify(res.body) +
      JSON.stringify(await AuditLog.find().lean()) +
      JSON.stringify(await AiUsageLog.find().lean()) +
      JSON.stringify(await AiAssessment.find().lean());
    expect(dump).not.toContain(KEY);
    const usage = await generic(admin, 'get', '/admin/ai/usage');
    expect(JSON.stringify(usage.body)).not.toContain(KEY);
  });
});

// ---------------------------------------------------------------------------
describe('monitoring AI usage, cost and errors', () => {
  it('reports calls, outcomes, tokens, configured-rate cost, error codes, latency and budget — to authorised staff only', async () => {
    const o = await ownerWithAnimal();
    await AiUsageLog.deleteMany({});
    await Setting.updateOne(
      { key: 'ai.inputCostPerMillionMicros' },
      { $set: { value: 3_000_000 } },
      { upsert: true },
    ); // 3 baht per million input tokens
    await Setting.updateOne(
      { key: 'ai.outputCostPerMillionMicros' },
      { $set: { value: 15_000_000 } },
      { upsert: true },
    );
    await run(o.owner, o.farmId, o.animalId);
    h.ai!.mode = 'invented_number';
    await run(o.owner, o.farmId, o.animalId);
    h.ai!.mode = 'grounded';
    h.ai!.failWith = 'timeout';
    await run(o.owner, o.farmId, o.animalId);
    h.ai!.failWith = null;
    const res = await generic(admin, 'get', '/admin/ai/usage?days=7');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const u = res.body.usage;
    expect(u).toMatchObject({
      days: 7,
      provider: 'mock',
      configured: true,
      costRatesConfigured: true,
    });
    expect(u.totals).toMatchObject({ calls: 3, ok: 1, errors: 1, rejected: 1, skipped: 0 });
    expect(u.totals.inputTokens).toBeGreaterThan(0);
    expect(u.totals.outputTokens).toBeGreaterThan(0);
    expect(u.totals.estimatedCostMicros).toBeGreaterThan(0);
    expect(u.totals.errorRate).toBeCloseTo(2 / 3, 2);
    expect(u.totals.p95LatencyMs).not.toBeNull();
    expect(u.byErrorCode.map((c: any) => c.code).sort()).toEqual([
      'AI_OUTPUT_UNGROUNDED_NUMBER',
      'timeout',
    ]);
    expect(u.byDay).toHaveLength(1);
    expect(u.byDay[0]).toMatchObject({ calls: 3, errors: 1, rejected: 1 });
    expect(u.budget).toMatchObject({ dailyLimit: 300, usedToday: 3 });
    // rows hold metadata only, never prompts or outputs
    const row = JSON.stringify(await AiUsageLog.findOne().lean());
    expect(row).not.toMatch(/summary|facts|observations|prompt/i);
    // staff with reports.read can see it; others cannot
    const finance = await createStaff(h.app, ['finance_admin']); // has reports.read
    expect((await generic(finance, 'get', '/admin/ai/usage')).status).toBe(200);
    expect((await generic(await createUser(h.app), 'get', '/admin/ai/usage')).status).toBe(403);
    expect((await request(h.app).get(`${API}/admin/ai/usage`)).status).toBe(401);
    expect((await generic(admin, 'get', '/admin/ai/usage?days=500')).status).toBe(400);
  });

  it('cost shows as not configured until rates are set; the audit log records every assessment with its model version and AI outcome', async () => {
    const o = await ownerWithAnimal();
    await AiUsageLog.deleteMany({});
    await run(o.owner, o.farmId, o.animalId);
    const u = (await generic(admin, 'get', '/admin/ai/usage')).body.usage;
    expect(u.costRatesConfigured).toBe(false);
    expect(u.totals.estimatedCostMicros).toBe(0);
    const audit = await AuditLog.findOne({
      action: 'ai.assessment_created',
      targetId: o.animalId,
    }).sort({ createdAt: -1 });
    expect(audit?.metadata).toMatchObject({
      modelVersion: expect.stringContaining(ENGINE_VERSION),
      ai: 'ok',
      confidence: expect.any(String),
    });
    expect(audit?.actorId?.toString()).toBe(o.userId);
  });
});

describe('market data administration', () => {
  it('needs a source and an authorisation statement, refuses future dates and unknown types, and can be switched off (and then no longer counts)', async () => {
    const good = {
      animalTypeKey: 'buffalo',
      kind: 'per_head',
      priceMinor: 3_500_000,
      observedOn: '2026-01-10',
      source: 'Market report',
      authorization: 'Licensed for use',
    };
    const post = (b: object, who: Session = admin) =>
      generic(who, 'post', '/admin/ai/market-data', b);
    expect((await post(good, await createUser(h.app))).status).toBe(403);
    for (const bad of [
      { ...good, source: '' },
      { ...good, authorization: '' },
      { ...good, priceMinor: 0 },
      { ...good, priceMinor: 10.5 },
      { ...good, observedOn: 'yesterday' },
      { ...good, kind: 'per_litre' },
      { ...good, animalTypeKey: 'unicorn' },
      { ...good, observedOn: '2999-01-01' },
    ])
      expect((await post(bad)).status, JSON.stringify(bad)).toBe(400);
    const made = await post(good);
    expect(made.status).toBe(201);
    expect(made.body.point).toMatchObject({
      source: 'Market report',
      authorization: 'Licensed for use',
      active: true,
    });
    expect(
      (await generic(admin, 'get', '/admin/ai/market-data?animalTypeKey=buffalo')).body.items,
    ).toHaveLength(1);
    const off = await generic(
      admin,
      'post',
      `/admin/ai/market-data/${made.body.point.id}/deactivate`,
      { reason: 'Licence ended' },
    );
    expect(off.body.point.active).toBe(false);
    expect(await AiMarketPrice.countDocuments({ active: true })).toBe(0);
  });
});
