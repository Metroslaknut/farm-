import { z } from 'zod';

const objectId = z.string().regex(/^[0-9a-f]{24}$/, 'Invalid id');
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F‪-‮⁦-⁩]/;
const plain = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `At most ${max} characters`)
    .refine((v) => !CONTROL.test(v), 'Contains characters that are not allowed');
const key = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9_]{1,39}$/, 'Use lower-case letters, digits and _');

export const createAssessmentSchema = z
  .object({ includeAiExplanation: z.boolean().default(true) })
  .strict();

export const reviewAssessmentSchema = z
  .object({ decision: z.enum(['accepted', 'dismissed']), note: plain(500).optional() })
  .strict();

export const assessmentListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(1000).default(1),
    pageSize: z.coerce.number().int().min(1).max(50).default(10),
    status: z.enum(['pending', 'accepted', 'dismissed']).optional(),
    animalId: objectId.optional(),
  })
  .strict();

const num = (max: number) => z.number().finite().positive().max(max);
export const criteriaRulesSchema = z
  .object({
    minAgeDays: z.number().int().min(1).max(10_000).nullable().optional(),
    minWeightKg: num(3000).nullable().optional(),
    targetWeightKg: z
      .object({ min: num(3000), max: num(3000) })
      .strict()
      .refine((v) => v.min < v.max, { message: 'The minimum must be below the maximum' })
      .nullable()
      .optional(),
    minAverageDailyGainG: num(10_000).nullable().optional(),
    weightFreshDays: z.number().int().min(1).max(365).nullable().optional(),
    healthClearDays: z.number().int().min(1).max(365).nullable().optional(),
    vaccinationWithinDays: z.number().int().min(1).max(1000).nullable().optional(),
  })
  .strict();

export const createCriteriaSchema = z
  .object({
    animalTypeKey: key,
    rules: criteriaRulesSchema,
    /** Required: FARM+ ships no agronomic values, so every rule set must say where its numbers come from. */
    source: plain(300).min(
      5,
      'Say where these numbers come from (guideline, veterinarian, farm policy)',
    ),
    validated: z.boolean().default(false),
    validationReference: plain(300).min(3).optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (Object.values(v.rules).every((x) => x === null || x === undefined))
      ctx.addIssue({ code: 'custom', path: ['rules'], message: 'Set at least one rule' });
    if (v.validated && !v.validationReference)
      ctx.addIssue({
        code: 'custom',
        path: ['validationReference'],
        message:
          'Give the reference of the validation (study, review, sign-off) before marking the method validated',
      });
  });

export const createMarketPointSchema = z
  .object({
    animalTypeKey: key,
    kind: z.enum(['per_head', 'per_kg']),
    priceMinor: z.number().int().positive().max(100_000_000_00),
    sex: z.enum(['male', 'female', 'unknown']).optional(),
    observedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD'),
    region: plain(80).optional(),
    source: plain(200).min(3, 'Name the source of this price'),
    /** The statement that FARM+ may use this data (a licence, a written permission, "public domain"…). */
    authorization: plain(300).min(5, 'State why FARM+ is allowed to use this data'),
  })
  .strict();
export const marketListQuerySchema = z
  .object({
    animalTypeKey: key.optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();
export const usageQuerySchema = z
  .object({ days: z.coerce.number().int().min(1).max(90).default(30) })
  .strict();
export const deactivateSchema = z.object({ reason: plain(300).min(3) }).strict();
