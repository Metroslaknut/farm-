import { describe, expect, it } from 'vitest';
import type { AnimalDetail } from '@farmplus/shared-types';
import {
  createAnimalSchema,
  createWeightSchema,
  estimatedBirthDate,
  updateAnimalSchema,
} from '@farmplus/validation';
import { setLocale } from '../src/i18n/locale';
import { EMPTY_ANIMAL, createBody, patchBody, valuesOf } from '../src/lib/animal-form';
import { GROWTH_TONE, growthStatusLabel, measurementBody, sourceLabel } from '../src/lib/growth';

const T = '0123456789abcdef01234567';
const detail: AnimalDetail = {
  id: 'a1',
  farmId: 'f1',
  animalCode: 'A-1',
  animalType: { id: T, key: 'buffalo', name: 'Buffalo' },
  breed: 'swamp',
  name: 'Daeng',
  sex: 'female',
  birthDate: '2024-01-10',
  birthDateEstimated: false,
  currentStatus: 'active',
  archived: false,
  origin: { kind: 'born_on_farm' },
  offspringCount: 0,
  media: [],
  color: 'Grey',
  notes: 'Calm',
  createdAt: '2024-01-10T00:00:00Z',
  updatedAt: '2024-01-10T00:00:00Z',
};

describe('estimated age → estimated birth date (shared with web)', () => {
  it('subtracts years and months from the Thai date, clamping the day of month', () => {
    expect(estimatedBirthDate(2, 3, '2026-11-07')).toBe('2024-08-07');
    expect(estimatedBirthDate(0, 3, '2026-05-31')).toBe('2026-02-28');
    expect(estimatedBirthDate(0, 3, '2024-05-31')).toBe('2024-02-29');
    expect(estimatedBirthDate(1, 0, '2026-01-15')).toBe('2025-01-15');
  });
  it('refuses nonsense instead of guessing', () => {
    for (const [y, m] of [
      [0, 0],
      [-1, 2],
      [1, 12],
      [1.5, 0],
      [Number.NaN, 1],
      [61, 0],
    ] as const)
      expect(estimatedBirthDate(y, m, '2026-11-07'), `${y}/${m}`).toBeNull();
  });
});

describe('animal form (register and edit share one form)', () => {
  it('register: empty optional fields are omitted and the body passes the shared schema', () => {
    const body = createBody({
      ...EMPTY_ANIMAL,
      animalTypeId: T,
      sex: 'male',
      color: '  Black  ',
      birthDate: '2024-02-01',
      birthDateEstimated: true,
    });
    expect(body).toEqual({
      animalTypeId: T,
      sex: 'male',
      birthDate: '2024-02-01',
      birthDateEstimated: true,
      origin: { kind: 'born_on_farm' },
      currentStatus: 'active',
      color: 'Black',
    });
    expect(createAnimalSchema.safeParse(body).success).toBe(true);
  });

  it('edit: sends only what changed, null to clear, never the identity', () => {
    const base = valuesOf(detail);
    expect(patchBody(base, base)).toEqual({});
    const diff = patchBody(base, {
      ...base,
      color: '',
      name: 'Daeng 2',
      currentStatus: 'for_sale',
    });
    expect(diff).toEqual({ color: null, name: 'Daeng 2', currentStatus: 'for_sale' });
    expect(updateAnimalSchema.safeParse(diff).success).toBe(true);
    const tampered = patchBody(base, { ...base, animalCode: 'X-9', animalTypeId: 'other' });
    expect(tampered).toEqual({});
    // Nothing changed → the shared schema refuses an empty update (no pointless request).
    expect(updateAnimalSchema.safeParse({}).success).toBe(false);
  });
});

describe('growth entry and labels', () => {
  const values = {
    weighedOn: '2026-11-01',
    weightKg: '320,5',
    heightCm: '',
    lengthCm: '140',
    method: 'scale',
    bodyCondition: ' Good coat ',
    notes: '',
  };
  it('builds a measurement the shared schema accepts (comma decimals allowed, empty fields omitted)', () => {
    const body = measurementBody(T, values);
    expect(body).toEqual({
      animalId: T,
      weighedOn: '2026-11-01',
      weightKg: 320.5,
      method: 'scale',
      lengthCm: 140,
      bodyCondition: 'Good coat',
    });
    expect(createWeightSchema.safeParse(body).success).toBe(true);
  });
  it('a typo in a number is refused, not dropped', () => {
    const parsed = createWeightSchema.safeParse(measurementBody(T, { ...values, heightCm: '1o0' }));
    expect(parsed.success).toBe(false);
    expect(
      createWeightSchema.safeParse(measurementBody(T, { ...values, weightKg: '' })).success,
    ).toBe(false);
  });
  it('status is never colour alone, and the source is always named', () => {
    setLocale('en');
    expect(growthStatusLabel('below')).toBe('▼ Below');
    expect(GROWTH_TONE.below).toBe('error');
    expect(sourceLabel({ kind: 'system_recommendation' })).toBe(
      'System recommendation (not an academic standard)',
    );
    expect(sourceLabel({ kind: 'reference', citation: 'DLD 2024' })).toBe('Source: DLD 2024');
    setLocale('th');
    expect(growthStatusLabel('above')).toBe('▲ สูงกว่าเกณฑ์');
    expect(sourceLabel({ kind: 'system_recommendation' })).toContain('ไม่ใช่มาตรฐานทางวิชาการ');
    setLocale('en');
  });
});
