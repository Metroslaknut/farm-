import { z } from 'zod';
import {
  BREEDING_METHODS,
  BREEDING_STATUSES,
  EXPENSE_CATEGORIES,
  FEEDING_KINDS,
  FEED_CATEGORIES,
  HEALTH_OUTCOMES,
  HEALTH_SEVERITIES,
  HEALTH_TYPES,
  HISTORY_EVENT_TYPES,
  ANIMAL_SEXES,
  PRESCRIBED_BY,
  QUANTITY_UNITS,
  STATED_BY,
  WEIGH_METHODS,
  GROWTH_SOURCE_KINDS,
  GROWTH_STANDARD_KINDS,
  GROWTH_STANDARD_SEXES,
} from '@farmplus/shared-types';
import { thaiToday } from './dates';
import { addMediaSchema, animalCodeSchema } from './farms';
import { listQuerySchema } from './auth';

const objectId = z.string().regex(/^[0-9a-f]{24}$/, 'Invalid id');
const text = (max: number) => z.string().trim().max(max);
const optionalText = (max: number) => text(max).optional();
const dateOnly = z.iso.date();
const today = () => thaiToday();
const notInFuture = (label: string) =>
  dateOnly.refine((v) => v <= today(), `${label} cannot be in the future`);
const twoDecimals = (v: number) => Math.round(v * 100) / 100 === v;
const issue = (ctx: z.RefinementCtx, path: (string | number)[], message: string) =>
  ctx.addIssue({ code: 'custom', path, message });

const attachments = z.array(addMediaSchema).max(10).default([]);
const quantity = z
  .object({
    amount: z.number().positive('Must be greater than 0').max(1_000_000),
    unit: z.enum(QUANTITY_UNITS),
  })
  .strict();

// ---------------------------------------------------------------------------
// Shared envelope for corrections and voiding
// ---------------------------------------------------------------------------
const reason = text(300).min(3, 'A reason of at least 3 characters is required');

/**
 * A correction names the fields to change (null clears an optional field) and WHY. The server merges the changes
 * into the current record and re-validates the whole result with the kind's create schema, so a correction can
 * never produce a record that creation would have refused.
 */
export const correctionSchema = z
  .object({ reason, changes: z.record(z.string().max(40), z.unknown()) })
  .strict()
  .refine((v) => Object.keys(v.changes).length > 0, {
    message: 'No changes given',
    path: ['changes'],
  });

export const voidSchema = z.object({ reason }).strict();

export const recordListBase = listQuerySchema.extend({
  from: dateOnly.optional(),
  to: dateOnly.optional(),
  includeVoided: z.enum(['true', 'false']).default('false'),
  order: z.enum(['asc', 'desc']).default('desc'),
});

// ---------------------------------------------------------------------------
// Health — records what a person reports. No diagnosis, no advice.
// ---------------------------------------------------------------------------
const medication = z
  .object({
    name: text(120).min(1),
    dosage: optionalText(80),
    route: optionalText(40),
    batchNumber: optionalText(60),
  })
  .strict();
const vaccine = z
  .object({
    name: text(120).min(1),
    batchNumber: optionalText(60),
    manufacturer: optionalText(120),
  })
  .strict();
const veterinarian = z
  .object({ name: text(120).min(1), licenseNo: optionalText(60), clinic: optionalText(120) })
  .strict();

export const createHealthSchema = z
  .object({
    animalId: objectId,
    type: z.enum(HEALTH_TYPES),
    recordedOn: notInFuture('The date'),
    title: text(120).min(2, 'At least 2 characters'),
    symptoms: optionalText(1000),
    condition: optionalText(120),
    conditionStatedBy: z.enum(STATED_BY).optional(),
    severity: z.enum(HEALTH_SEVERITIES).optional(),
    medication: medication.optional(),
    prescribedBy: z.enum(PRESCRIBED_BY).optional(),
    veterinarian: veterinarian.optional(),
    withdrawalEndsOn: dateOnly.optional(),
    vaccine: vaccine.optional(),
    nextDueOn: dateOnly.optional(),
    relatedRecordId: objectId.optional(),
    outcome: z.enum(HEALTH_OUTCOMES).optional(),
    notes: optionalText(2000),
    attachments,
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.type === 'vaccination' && !v.vaccine) issue(ctx, ['vaccine', 'name'], 'Name the vaccine');
    if (v.type === 'recovery' && !v.outcome) issue(ctx, ['outcome'], 'Record the outcome');
    if (v.outcome && v.type !== 'recovery')
      issue(ctx, ['outcome'], 'The outcome belongs to a recovery record');
    if (v.vaccine && v.type !== 'vaccination')
      issue(ctx, ['vaccine', 'name'], 'Vaccine details belong to a vaccination record');
    // Provenance: a condition or a medication is only ever recorded together with WHO said so.
    if (v.condition && !v.conditionStatedBy)
      issue(ctx, ['conditionStatedBy'], 'Say who stated this condition');
    if (v.conditionStatedBy && !v.condition)
      issue(ctx, ['condition'], 'Enter the condition, or clear “stated by”');
    if (v.medication && !v.prescribedBy)
      issue(ctx, ['prescribedBy'], 'Say who prescribed or recommended this medication');
    if (v.prescribedBy && !v.medication)
      issue(ctx, ['medication', 'name'], 'Enter the medication, or clear “prescribed by”');
    if (v.nextDueOn && v.nextDueOn < v.recordedOn)
      issue(ctx, ['nextDueOn'], 'Cannot be before the record date');
    if (v.withdrawalEndsOn && v.withdrawalEndsOn < v.recordedOn)
      issue(ctx, ['withdrawalEndsOn'], 'Cannot be before the record date');
  });

export const healthListQuerySchema = recordListBase.extend({
  animalId: objectId.optional(),
  type: z.enum(HEALTH_TYPES).optional(),
  sortBy: z.enum(['recordedOn', 'createdAt']).default('recordedOn'),
});

// ---------------------------------------------------------------------------
// Weights
// ---------------------------------------------------------------------------
const centimetres = z
  .number()
  .positive('Must be greater than 0')
  .max(1000)
  .refine(twoDecimals, 'At most 2 decimals');

export const createWeightSchema = z
  .object({
    animalId: objectId,
    weighedOn: notInFuture('The weighing date'),
    weightKg: z
      .number()
      .positive('Must be greater than 0')
      .max(50_000)
      .refine(twoDecimals, 'At most 2 decimals'),
    method: z.enum(WEIGH_METHODS).default('scale'),
    heightCm: centimetres.optional(),
    lengthCm: centimetres.optional(),
    bodyCondition: optionalText(200),
    notes: optionalText(1000),
    attachments,
  })
  .strict();

// ---------------------------------------------------------------------------
// Growth standards (admin)
// ---------------------------------------------------------------------------
const ageDays = z.number().int('Whole days only').min(0).max(36_500);
const kgBound = z
  .number()
  .positive('Must be greater than 0')
  .max(50_000)
  .refine(twoDecimals, 'At most 2 decimals');
const BOUNDS = [
  ['minWeightKg', 'maxWeightKg'],
  ['minHeightCm', 'maxHeightCm'],
  ['minLengthCm', 'maxLengthCm'],
] as const;

const growthStandardFields = {
  animalTypeId: objectId,
  /** Breed key of the type; omitted = all breeds. */
  breed: z.string().trim().min(1).max(40).optional(),
  sex: z.enum(GROWTH_STANDARD_SEXES).default('any'),
  kind: z.enum(GROWTH_STANDARD_KINDS),
  ageFromDays: ageDays,
  ageToDays: ageDays,
  minWeightKg: kgBound.optional(),
  maxWeightKg: kgBound.optional(),
  minHeightCm: centimetres.optional(),
  maxHeightCm: centimetres.optional(),
  minLengthCm: centimetres.optional(),
  maxLengthCm: centimetres.optional(),
  source: z
    .object({
      kind: z.enum(GROWTH_SOURCE_KINDS),
      citation: optionalText(300),
      note: optionalText(500),
    })
    .strict(),
};

/**
 * One criterion. The source is mandatory: a cited `reference`, or an explicit `system_recommendation` — so no number is
 * ever presented as an academic standard without saying where it comes from.
 */
export const createGrowthStandardSchema = z
  .object(growthStandardFields)
  .strict()
  .superRefine((v, ctx) => {
    if (v.ageToDays <= v.ageFromDays)
      issue(ctx, ['ageToDays'], 'The end of the age range must be after its start');
    const bounded = BOUNDS.filter(([lo, hi]) => v[lo] !== undefined || v[hi] !== undefined);
    for (const [lo, hi] of BOUNDS) {
      const [a, b] = [v[lo], v[hi]];
      if (a !== undefined && b !== undefined && a > b)
        issue(ctx, [lo], 'The minimum cannot be greater than the maximum');
    }
    if (v.kind === 'weight_for_age' && bounded.length === 0)
      issue(ctx, ['minWeightKg'], 'Give at least one minimum or maximum');
    if (v.kind !== 'weight_for_age' && bounded.length > 0)
      issue(ctx, [bounded[0]![0]], 'Only an age range applies to this kind of criterion');
    if (v.source.kind === 'reference' && !v.source.citation)
      issue(ctx, ['source', 'citation'], 'A reference needs a citation');
  });

/**
 * Changes to a criterion (`null` clears an optional value). Type and kind are fixed; the server merges the change into
 * the stored criterion and re-validates the result with `createGrowthStandardSchema`.
 */
export const updateGrowthStandardSchema = z
  .object({
    breed: z.union([growthStandardFields.breed.unwrap(), z.null()]).optional(),
    sex: z.enum(GROWTH_STANDARD_SEXES).optional(),
    ageFromDays: ageDays.optional(),
    ageToDays: ageDays.optional(),
    minWeightKg: z.union([kgBound, z.null()]).optional(),
    maxWeightKg: z.union([kgBound, z.null()]).optional(),
    minHeightCm: z.union([centimetres, z.null()]).optional(),
    maxHeightCm: z.union([centimetres, z.null()]).optional(),
    minLengthCm: z.union([centimetres, z.null()]).optional(),
    maxLengthCm: z.union([centimetres, z.null()]).optional(),
    source: growthStandardFields.source.optional(),
    active: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' });

export const growthStandardListQuerySchema = z.object({
  animalTypeId: objectId.optional(),
  kind: z.enum(GROWTH_STANDARD_KINDS).optional(),
  includeInactive: z.enum(['true', 'false']).default('false'),
});

export type CreateGrowthStandardInput = z.infer<typeof createGrowthStandardSchema>;
export type UpdateGrowthStandardInput = z.infer<typeof updateGrowthStandardSchema>;

/** `GET …/animals/:id/lineage?generations=` — how many ancestor levels the family tree shows (1–5). */
export const lineageQuerySchema = z.object({
  generations: z.coerce.number().int().min(1).max(5).default(3),
});

export const weightListQuerySchema = recordListBase.extend({
  animalId: objectId.optional(),
  sortBy: z.enum(['weighedOn', 'weightKg', 'createdAt']).default('weighedOn'),
});

// ---------------------------------------------------------------------------
// Feeding
// ---------------------------------------------------------------------------
const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use 24-hour HH:MM');

export const createFeedingSchema = z
  .object({
    kind: z.enum(FEEDING_KINDS),
    animalId: objectId.optional(),
    groupLabel: optionalText(80),
    date: dateOnly,
    endDate: dateOnly.optional(),
    feedName: text(120).min(1, 'Required'),
    category: z.enum(FEED_CATEGORIES).default('other'),
    quantity,
    frequencyPerDay: z.number().int().min(1).max(24).optional(),
    timesOfDay: z.array(timeOfDay).max(24).optional(),
    notes: optionalText(1000),
    attachments,
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.animalId && v.groupLabel)
      issue(ctx, ['groupLabel'], 'Choose one animal or a group, not both');
    if (v.kind === 'log') {
      if (v.date > today()) issue(ctx, ['date'], 'A feeding log cannot be in the future');
      for (const f of ['endDate', 'frequencyPerDay', 'timesOfDay'] as const) {
        if (v[f] !== undefined) issue(ctx, [f], 'Only schedules have this');
      }
    }
    if (v.endDate && v.endDate < v.date) issue(ctx, ['endDate'], 'Cannot be before the start date');
    if (v.timesOfDay && v.frequencyPerDay && v.timesOfDay.length !== v.frequencyPerDay) {
      issue(ctx, ['timesOfDay'], 'Give one time per feeding, or leave the times out');
    }
  });

export const feedingListQuerySchema = recordListBase.extend({
  animalId: objectId.optional(),
  kind: z.enum(FEEDING_KINDS).optional(),
  /** Schedules only: `true` = running today. */
  active: z.enum(['true', 'false']).optional(),
  sortBy: z.enum(['date', 'createdAt']).default('date'),
});

// ---------------------------------------------------------------------------
// Expenses
// ---------------------------------------------------------------------------
export const createExpenseSchema = z
  .object({
    category: z.enum(EXPENSE_CATEGORIES),
    expenseDate: notInFuture('The expense date'),
    /** Baht. */
    amount: z
      .number()
      .positive('Must be greater than 0')
      .max(100_000_000)
      .refine(twoDecimals, 'At most 2 decimals'),
    description: text(200).min(2, 'At least 2 characters'),
    supplier: optionalText(120),
    animalId: objectId.optional(),
    related: z
      .object({ kind: z.enum(['health', 'feeding']), id: objectId })
      .strict()
      .optional(),
    quantity: quantity.optional(),
    notes: optionalText(1000),
    attachments,
  })
  .strict();

export const expenseListQuerySchema = recordListBase.extend({
  category: z.enum(EXPENSE_CATEGORIES).optional(),
  animalId: objectId.optional(),
  sortBy: z.enum(['expenseDate', 'amount', 'createdAt']).default('expenseDate'),
});

export const expenseSummaryQuerySchema = z.object({
  from: dateOnly.optional(),
  to: dateOnly.optional(),
  animalId: objectId.optional(),
});

// ---------------------------------------------------------------------------
// Breeding
// ---------------------------------------------------------------------------
const sireExternal = z
  .object({ name: optionalText(120), code: optionalText(60), note: optionalText(300) })
  .strict()
  .refine((v) => Boolean(v.name || v.code || v.note), 'Give at least one detail');

export const createBreedingSchema = z
  .object({
    damId: objectId,
    sireId: objectId.optional(),
    sireExternal: sireExternal.optional(),
    method: z.enum(BREEDING_METHODS).default('unknown'),
    breedingDate: notInFuture('The breeding date'),
    notes: optionalText(2000),
    attachments,
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.sireId && v.sireExternal)
      issue(ctx, ['sireExternal'], 'Choose a sire on this farm or an outside sire, not both');
    if (v.sireId && v.sireId === v.damId)
      issue(ctx, ['sireId'], 'The sire and dam must be different animals');
  });

export const confirmPregnancySchema = z
  .object({ date: notInFuture('The check date'), notes: optionalText(500) })
  .strict();
export const failBreedingSchema = z
  .object({ date: notInFuture('The date'), reason: text(300).min(3, 'Say what happened') })
  .strict();

const offspringEntry = z.union([
  z.object({ animalId: objectId, note: optionalText(300) }).strict(),
  z
    .object({
      register: z
        .object({
          animalCode: animalCodeSchema.optional(),
          name: text(80).min(1).optional(),
          sex: z.enum(ANIMAL_SEXES, { error: 'Choose the animal’s sex' }),
          breed: z
            .string()
            .regex(/^[a-z][a-z0-9_]{1,39}$/)
            .optional(),
          notes: optionalText(1000),
        })
        .strict(),
      note: optionalText(300),
    })
    .strict(),
  z
    .object({
      outcome: z.enum(['stillborn', 'died_at_birth']),
      sex: z.enum(ANIMAL_SEXES).optional(),
      note: optionalText(300),
    })
    .strict(),
]);

export const recordDeliverySchema = z
  .object({
    date: notInFuture('The delivery date'),
    offspring: z.array(offspringEntry).max(20).default([]),
    notes: optionalText(1000),
  })
  .strict();

export const breedingListQuerySchema = recordListBase.extend({
  damId: objectId.optional(),
  sireId: objectId.optional(),
  status: z.enum(BREEDING_STATUSES).optional(),
  sortBy: z.enum(['breedingDate', 'createdAt']).default('breedingDate'),
});

// ---------------------------------------------------------------------------
// Whole-animal history
// ---------------------------------------------------------------------------
export const historyQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(30),
  /** Comma separated subset of HISTORY_EVENT_TYPES. */
  types: z
    .string()
    .optional()
    .transform((v) =>
      v
        ? v
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean)
        : undefined,
    )
    .pipe(z.array(z.enum(HISTORY_EVENT_TYPES)).optional()),
  from: dateOnly.optional(),
  to: dateOnly.optional(),
  includeVoided: z.enum(['true', 'false']).default('true'),
});

export type CreateHealthInput = z.infer<typeof createHealthSchema>;
export type CreateWeightInput = z.infer<typeof createWeightSchema>;
export type CreateFeedingInput = z.infer<typeof createFeedingSchema>;
export type CreateExpenseInput = z.infer<typeof createExpenseSchema>;
export type CreateBreedingInput = z.infer<typeof createBreedingSchema>;
export type RecordDeliveryInput = z.infer<typeof recordDeliverySchema>;
