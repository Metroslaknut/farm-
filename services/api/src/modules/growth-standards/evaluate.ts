import type {
  AgeWindowStatus,
  GrowthEvaluation,
  GrowthMetric,
  GrowthStandardKind,
  GrowthStandardSource,
  MetricEvaluation,
} from '@farmplus/shared-types';
import type { GrowthStandardAttrs } from '../../models/growth-standard.model';

/**
 * Comparing measurements with growth criteria. Pure functions (no database), shared by the growth page and the farm
 * summary. Nothing here invents a value: no birth date → `no_age`, no matching criterion → `no_standard`.
 */
type Standard = Pick<
  GrowthStandardAttrs,
  | '_id'
  | 'breed'
  | 'sex'
  | 'kind'
  | 'ageFromDays'
  | 'ageToDays'
  | 'minWeightKg'
  | 'maxWeightKg'
  | 'minHeightCm'
  | 'maxHeightCm'
  | 'minLengthCm'
  | 'maxLengthCm'
  | 'source'
  | 'active'
>;
export interface AnimalFacts {
  breed?: string | null;
  sex: string;
  birthDate?: Date | null;
  birthDateEstimated?: boolean;
}
export interface Measurement {
  date: Date;
  weightKg: number;
  heightCm?: number | null;
  lengthCm?: number | null;
}

const DAY_MS = 86_400_000;

/** Whole days from birth to `date`; `undefined` without a birth date (never guessed). */
export const ageInDays = (animal: AnimalFacts, date: Date): number | undefined =>
  animal.birthDate ? Math.floor((date.getTime() - animal.birthDate.getTime()) / DAY_MS) : undefined;

/** How well a criterion fits the animal: exact breed beats "all breeds", exact sex beats "any". `null` = not applicable. */
function specificity(s: Standard, animal: AnimalFacts): number | null {
  if (!s.active) return null;
  if (s.breed !== null && s.breed !== animal.breed) return null;
  if (s.sex !== 'any' && s.sex !== animal.sex) return null;
  return (s.breed !== null ? 2 : 0) + (s.sex !== 'any' ? 1 : 0);
}

/** The criteria of one kind that apply to the animal, keeping only the most specific level that exists. */
export function applicable<S extends Standard>(
  standards: readonly S[],
  animal: AnimalFacts,
  kind: GrowthStandardKind,
): S[] {
  const scored = standards
    .filter((s) => s.kind === kind)
    .map((s) => ({ s, score: specificity(s, animal) }))
    .filter((x): x is { s: S; score: number } => x.score !== null);
  const best = Math.max(-1, ...scored.map((x) => x.score));
  return scored
    .filter((x) => x.score === best)
    .map((x) => x.s)
    .sort((a, b) => a.ageFromDays - b.ageFromDays);
}

const inRange = (s: Standard, age: number) => age >= s.ageFromDays && age < s.ageToDays;

export const sourceOf = (s: Standard): GrowthStandardSource => ({
  kind: s.source.kind,
  ...(s.source.citation ? { citation: s.source.citation } : {}),
  ...(s.source.note ? { note: s.source.note } : {}),
});

function metric(
  value: number | null | undefined,
  min: number | null,
  max: number | null,
): MetricEvaluation | undefined {
  if (value === null || value === undefined || (min === null && max === null)) return undefined;
  const status =
    min !== null && value < min ? 'below' : max !== null && value > max ? 'above' : 'within';
  return { status, value, ...(min !== null ? { min } : {}), ...(max !== null ? { max } : {}) };
}

/** One measurement against the most specific weight-for-age criterion covering the animal's age on that day. */
export function evaluateMeasurement(
  standards: readonly Standard[],
  animal: AnimalFacts,
  m: Measurement,
): { ageDays?: number; evaluation: GrowthEvaluation } {
  const ageEstimated = Boolean(animal.birthDateEstimated);
  const ageDays = ageInDays(animal, m.date);
  if (ageDays === undefined)
    return { evaluation: { status: 'no_age', ageEstimated: false, metrics: {} } };
  const standard = applicable(standards, animal, 'weight_for_age').find((s) => inRange(s, ageDays));
  if (!standard)
    return { ageDays, evaluation: { status: 'no_standard', ageEstimated, metrics: {} } };
  const metrics: Partial<Record<GrowthMetric, MetricEvaluation>> = {};
  const w = metric(m.weightKg, standard.minWeightKg, standard.maxWeightKg);
  const h = metric(m.heightCm, standard.minHeightCm, standard.maxHeightCm);
  const l = metric(m.lengthCm, standard.minLengthCm, standard.maxLengthCm);
  if (w) metrics.weight = w;
  if (h) metrics.height = h;
  if (l) metrics.length = l;
  const statuses = Object.values(metrics).map((x) => x.status);
  return {
    ageDays,
    evaluation: {
      // The criterion covers this age but none of its bounds were measured → nothing to compare.
      status: statuses.includes('below')
        ? 'below'
        : statuses.includes('above')
          ? 'above'
          : statuses.length
            ? 'within'
            : 'no_standard',
      standardId: String(standard._id),
      source: sourceOf(standard),
      ageEstimated,
      metrics,
    },
  };
}

/** Where the animal is today relative to its breeding or sale age window (`undefined` = no criterion configured). */
export function ageWindow(
  standards: readonly Standard[],
  animal: AnimalFacts,
  kind: 'breeding_age' | 'sale_age',
  today: Date,
): AgeWindowStatus | undefined {
  const windows = applicable(standards, animal, kind);
  if (windows.length === 0) return undefined;
  const age = ageInDays(animal, today);
  const pick =
    age === undefined
      ? windows[0]!
      : (windows.find((s) => inRange(s, age)) ??
        windows.find((s) => s.ageFromDays > age) ??
        windows[windows.length - 1]!);
  return {
    standard: {
      id: String(pick._id),
      ageFromDays: pick.ageFromDays,
      ageToDays: pick.ageToDays,
      source: sourceOf(pick),
    },
    status:
      age === undefined
        ? 'no_age'
        : age < pick.ageFromDays
          ? 'before'
          : age >= pick.ageToDays
            ? 'after'
            : 'within',
    ageEstimated: Boolean(animal.birthDateEstimated),
  };
}
