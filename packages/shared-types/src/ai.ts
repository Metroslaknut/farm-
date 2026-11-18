/**
 * AI-assisted animal assessment (Part 15): DECISION SUPPORT for growth, readiness for sale, recorded costs and
 * price ranges. Numbers come from recorded data and authorised market data by deterministic calculation; an AI model
 * may only add a short plain-language explanation of those numbers. It never diagnoses, never publishes a listing and
 * never finalises a sale.
 */
import type { PublicAuthor } from './community';

export const ASSESSMENT_DISCLAIMER =
  'Decision support only. This is not veterinary diagnosis or professional advice. It uses only the records you entered and the market data shown, and it can be wrong or incomplete. You decide whether and at what price to sell.';

export const FACTOR_STATUSES = ['met', 'not_met', 'unknown', 'info'] as const;
export type FactorStatus = (typeof FACTOR_STATUSES)[number];

export interface ReadinessFactor {
  key: string;
  label: string;
  status: FactorStatus;
  /** What was measured, if anything (e.g. "412 kg", "18 months"). */
  value: string | null;
  /** What it was compared against (e.g. "at least 350 kg"). */
  threshold: string | null;
  /** `recorded_data`: a fact about the records. `configured_criteria`: compared with a rule an administrator configured. */
  basis: 'recorded_data' | 'configured_criteria';
  detail: string;
}

export const WARNING_SEVERITIES = ['info', 'caution', 'serious'] as const;
export interface DataQualityWarning {
  code: string;
  severity: (typeof WARNING_SEVERITIES)[number];
  message: string;
}

export interface PriceBasis {
  source: 'farmplus_sales' | 'imported_per_head' | 'imported_per_kg';
  label: string;
  /** Number of price observations behind the figures. */
  sampleSize: number;
  windowDays: number | null;
  p25Minor: number | null;
  medianMinor: number | null;
  p75Minor: number | null;
  minMinor: number | null;
  maxMinor: number | null;
  /** True if this basis produced the headline range. */
  used: boolean;
  /** Why it could not be used (too few samples, no recent weight…). */
  note: string | null;
  scope: string;
}

export interface EstimatedPriceRange {
  lowMinor: number;
  midMinor: number;
  highMinor: number;
  currency: 'THB';
  basis: PriceBasis['source'];
  basisLabel: string;
  sampleSize: number;
  /** In words: what the range is and what it is not adjusted for. */
  explanation: string;
}

export interface ProceedsLine {
  scenario: 'low' | 'mid' | 'high';
  priceMinor: number;
  /** Platform fee under the commission rules in force today (the real fee is fixed at checkout). */
  platformFeeMinor: number;
  netProceedsMinor: number;
  /** Net proceeds minus recorded cost: an indicative figure, NOT profit (unrecorded costs are not in it). */
  netOverRecordedCostMinor: number | null;
}

export interface CostSummary {
  /** Costs recorded against THIS animal. Farm-wide costs that were not assigned to it are not included. */
  recordedCostMinor: number;
  recordCount: number;
  byCategory: { category: string; amountMinor: number; count: number }[];
  firstExpenseOn: string | null;
  lastExpenseOn: string | null;
  daysOnFarm: number | null;
  recordedCostPerDayMinor: number | null;
  currency: 'THB';
  notes: string[];
}

export interface GrowthSummary {
  weightCount: number;
  firstWeighedOn: string | null;
  latestWeighedOn: string | null;
  firstKg: number | null;
  latestKg: number | null;
  daysSinceLatest: number | null;
  averageDailyGainG: number | null;
  /** Share of weights that are tape or visual estimates rather than a scale reading. */
  estimatedWeightShare: number | null;
}

export interface HealthSummary {
  recordCount: number;
  last90Days: {
    illness: number;
    treatment: number;
    vaccination: number;
    checkup: number;
    other: number;
  };
  latestRecordOn: string | null;
  /** The recorded end of a medicine withdrawal period, if one is still running. */
  withdrawalEndsOn: string | null;
  latestVaccinationOn: string | null;
  /** Counts and dates only: FARM+ does not interpret health records or diagnose. */
  note: string;
}

export interface Confidence {
  level: 'low' | 'medium' | 'high';
  /** A data-completeness indicator, not a statistical confidence interval. */
  basis: 'data_completeness';
  explanation: string;
  reasons: string[];
}

export interface Recommendation {
  id: string;
  code: string;
  text: string;
  dismissed: boolean;
  dismissedAt: string | null;
  dismissedBy: PublicAuthor | null;
}

export const AI_STATUSES = ['not_requested', 'ok', 'rejected', 'failed', 'skipped'] as const;
export interface AiNarrative {
  /** `ok`: produced and validated. `rejected`: output failed validation and was discarded. */
  status: (typeof AI_STATUSES)[number];
  provider: string | null;
  model: string | null;
  summary: string | null;
  observations: string[];
  questionsForOwner: string[];
  /** Why there is no narrative (budget, provider down, rejected output…). */
  reason: string | null;
  label: string;
}

export type ReviewDecision = 'accepted' | 'dismissed';
export interface AssessmentReview {
  status: 'pending' | ReviewDecision;
  reviewedBy: PublicAuthor | null;
  reviewedAt: string | null;
  note: string | null;
}

export interface AssessmentDTO {
  id: string;
  animalId: string;
  animalCode: string;
  farmId: string;
  assessmentDate: string;
  animalType: { key: string; name: string };
  sex: string;
  /** Present only when the criteria for this animal type carry a validated scoring method; otherwise null. */
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
  recommendations: Recommendation[];
  narrative: AiNarrative;
  /** e.g. `farmplus-assessment/1.0.0 · criteria:cattle@v2 · ai:anthropic:claude-sonnet-5-5`. */
  modelVersion: string;
  criteria: { key: string; version: number; validated: boolean; source: string } | null;
  review: AssessmentReview;
  requestedBy: PublicAuthor;
  disclaimer: string;
}

export interface AssessmentListItem {
  id: string;
  animalId: string;
  animalCode: string;
  assessmentDate: string;
  readinessScore: number | null;
  priceRange: { lowMinor: number; highMinor: number } | null;
  confidence: Confidence['level'];
  warningCount: number;
  review: AssessmentReview['status'];
  modelVersion: string;
}

// ---------------------------------------------------------------------------
// Administration: criteria, market data, usage
// ---------------------------------------------------------------------------
export interface CriteriaRules {
  minAgeDays?: number | null;
  minWeightKg?: number | null;
  targetWeightKg?: { min: number; max: number } | null;
  minAverageDailyGainG?: number | null;
  weightFreshDays?: number | null;
  healthClearDays?: number | null;
  vaccinationWithinDays?: number | null;
}
export interface CriteriaDTO {
  id: string;
  animalTypeKey: string;
  animalTypeName: string;
  version: number;
  active: boolean;
  rules: CriteriaRules;
  /** Where these numbers come from (a guideline, a veterinarian, the farm's own policy). Required: FARM+ ships none. */
  source: string;
  /** True only after the scoring method was validated; only then are readiness scores produced. */
  validated: boolean;
  validationReference: string | null;
  createdAt: string;
  createdBy: PublicAuthor | null;
}

export interface MarketPointDTO {
  id: string;
  animalTypeKey: string;
  kind: 'per_head' | 'per_kg';
  priceMinor: number;
  sex: string | null;
  observedOn: string;
  region: string | null;
  source: string;
  /** The statement that FARM+ may use this data (licence, permission). */
  authorization: string;
  active: boolean;
}

export interface AiUsageSummary {
  days: number;
  provider: string;
  configured: boolean;
  totals: {
    calls: number;
    ok: number;
    errors: number;
    rejected: number;
    skipped: number;
    inputTokens: number;
    outputTokens: number;
    estimatedCostMicros: number;
    errorRate: number | null;
    p95LatencyMs: number | null;
  };
  byDay: {
    day: string;
    calls: number;
    errors: number;
    rejected: number;
    inputTokens: number;
    outputTokens: number;
    estimatedCostMicros: number;
  }[];
  byErrorCode: { code: string; count: number }[];
  budget: { dailyLimit: number; usedToday: number };
  /** Cost is computed from the per-million-token rates configured in settings (0 until set). */
  costRatesConfigured: boolean;
}
