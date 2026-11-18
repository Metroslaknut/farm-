import type { GrowthStandardSource, GrowthStatus } from '@farmplus/shared-types';
import { t, type KeyOf } from '@/i18n';
import type { StatusTone } from '@/theme';

/** Comparison status → badge tone. The badge also shows an icon and words, never colour alone. */
export const GROWTH_TONE: Record<GrowthStatus, StatusTone | 'neutral'> = {
  below: 'error',
  within: 'success',
  above: 'warning',
  no_standard: 'neutral',
  no_age: 'neutral',
};
const STATUS_KEYS: Record<GrowthStatus, KeyOf<'farms'>> = {
  below: 'growth.status.below',
  within: 'growth.status.within',
  above: 'growth.status.above',
  no_standard: 'growth.status.no_standard',
  no_age: 'growth.status.no_age',
};
export const growthStatusLabel = (s: GrowthStatus): string => t('farms', STATUS_KEYS[s]);

/** Where a criterion comes from, in the current language (a cited reference, or "system recommendation"). */
export const sourceLabel = (s: GrowthStandardSource): string =>
  s.kind === 'reference'
    ? t('farms', 'growth.sourceReference', { citation: s.citation ?? '' })
    : t('farms', 'growth.sourceSystem');

export interface MeasurementValues {
  weighedOn: string;
  weightKg: string;
  heightCm: string;
  lengthCm: string;
  method: string;
  bodyCondition: string;
  notes: string;
}

/**
 * Body for `POST /farms/:id/weights` (to be checked with `createWeightSchema`). Empty optional fields are omitted;
 * a number field that is not a number becomes NaN so the shared schema refuses it instead of silently dropping it.
 */
export function measurementBody(animalId: string, v: MeasurementValues): Record<string, unknown> {
  const num = (s: string) => Number(s.trim().replace(',', '.'));
  const optNum = (s: string) => (s.trim() === '' ? undefined : num(s));
  const optText = (s: string) => (s.trim() === '' ? undefined : s.trim());
  const body: Record<string, unknown> = {
    animalId,
    weighedOn: v.weighedOn.trim(),
    weightKg: v.weightKg.trim() === '' ? undefined : num(v.weightKg),
    method: v.method,
    heightCm: optNum(v.heightCm),
    lengthCm: optNum(v.lengthCm),
    bodyCondition: optText(v.bodyCondition),
    notes: optText(v.notes),
  };
  return Object.fromEntries(Object.entries(body).filter(([, x]) => x !== undefined));
}
