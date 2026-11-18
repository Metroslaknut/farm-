import { z } from 'zod';
import {
  ANIMAL_ORIGINS,
  ANIMAL_SEXES,
  ANIMAL_STATUSES,
  ANIMAL_TYPE_STATUSES,
  ASSIGNABLE_FARM_ROLES,
  FARM_STATUSES,
  MEDIA_KINDS,
} from '@farmplus/shared-types';
import { listQuerySchema } from './auth';
import { thaiToday } from './dates';

const objectId = z.string().regex(/^[0-9a-f]{24}$/, 'Invalid id');
const text = (max: number) => z.string().trim().max(max);
const optionalText = (max: number) => text(max).optional();
/** Calendar date, YYYY-MM-DD. */
const dateOnly = z.iso.date();
const notFuture = (value: string) => value <= thaiToday();

// ---------------- farms
const locationSchema = z
  .object({
    province: optionalText(80),
    district: optionalText(80),
    subdistrict: optionalText(80),
    postalCode: z
      .string()
      .trim()
      .regex(/^\d{5}$/, 'Postal code must be 5 digits')
      .optional(),
    address: optionalText(300),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
  })
  .strict()
  .refine((v) => (v.latitude === undefined) === (v.longitude === undefined), {
    message: 'Provide both latitude and longitude, or neither',
    path: ['latitude'],
  });

const contactSchema = z
  .object({
    phone: z
      .string()
      .trim()
      .regex(/^\+?[0-9][0-9\s-]{6,18}$/, 'Invalid phone number')
      .optional(),
    email: z.string().trim().toLowerCase().pipe(z.email().max(254)).optional(),
    lineId: optionalText(40),
  })
  .strict();

/** What the farm raises: ids from the admin-managed animal types (checked to exist and be active by the API). */
const animalTypeIdsSchema = z
  .array(objectId)
  .max(30)
  .refine((ids) => new Set(ids).size === ids.length, { message: 'Duplicate animal type' });

export const createFarmSchema = z
  .object({
    name: text(120).min(2, 'At least 2 characters'),
    description: optionalText(1000),
    location: locationSchema.default({}),
    contact: contactSchema.default({}),
    animalTypeIds: animalTypeIdsSchema.default([]),
  })
  .strict();

export const updateFarmSchema = z
  .object({
    name: text(120).min(2).optional(),
    description: z.union([text(1000), z.null()]).optional(),
    location: locationSchema.optional(),
    contact: contactSchema.optional(),
    animalTypeIds: animalTypeIdsSchema.optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' });

export const farmListQuerySchema = listQuerySchema.extend({
  status: z.enum(FARM_STATUSES).optional(),
  /** `all` is for platform staff holding farms.read; everyone else always sees only their own farms. */
  scope: z.enum(['mine', 'all']).default('mine'),
});

export const addMemberSchema = z
  .object({
    userId: objectId.optional(),
    email: z.string().trim().toLowerCase().pipe(z.email().max(254)).optional(),
    role: z.enum(ASSIGNABLE_FARM_ROLES),
  })
  .strict()
  .refine((v) => Boolean(v.userId) !== Boolean(v.email), {
    message: 'Provide exactly one of userId or email',
    path: ['userId'],
  });

export const updateMemberSchema = z.object({ role: z.enum(ASSIGNABLE_FARM_ROLES) }).strict();

// ---------------- animal types
const keySchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]{1,39}$/, 'Lowercase letters, digits and underscores');

/** Optional species configuration (see AnimalTypeConfig). `null` clears a value. */
const gestationDays = z.number().int().min(1).max(1500);
const minBreedingAgeDays = z.number().int().min(0).max(10000);
const maxWeightKg = z.number().positive().max(50000);

export const createAnimalTypeSchema = z
  .object({
    key: keySchema,
    name: text(80).min(1),
    nameTh: optionalText(80),
    gestationDays: gestationDays.optional(),
    minBreedingAgeDays: minBreedingAgeDays.optional(),
    maxWeightKg: maxWeightKg.optional(),
    breeds: z
      .array(z.object({ key: keySchema, name: text(80).min(1), nameTh: optionalText(80) }).strict())
      .max(100)
      .default([]),
  })
  .strict();

export const updateAnimalTypeSchema = z
  .object({
    name: text(80).min(1).optional(),
    nameTh: z.union([text(80), z.null()]).optional(),
    status: z.enum(ANIMAL_TYPE_STATUSES).optional(),
    gestationDays: z.union([gestationDays, z.null()]).optional(),
    minBreedingAgeDays: z.union([minBreedingAgeDays, z.null()]).optional(),
    maxWeightKg: z.union([maxWeightKg, z.null()]).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' });

export const addBreedSchema = z
  .object({ key: keySchema, name: text(80).min(1), nameTh: optionalText(80) })
  .strict();
export const updateBreedSchema = z
  .object({
    name: text(80).min(1).optional(),
    nameTh: z.union([text(80), z.null()]).optional(),
    active: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' });

export const animalTypeListQuerySchema = z.object({
  includeInactive: z.enum(['true', 'false']).default('false'),
});

// ---------------- animals
/** Identifier unique within a farm. No spaces so codes are safe in URLs, QR codes and ear tags. */
export const animalCodeSchema = z
  .string()
  .trim()
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9._\-/]{0,39}$/,
    'Use letters, digits and . _ - / (max 40, no spaces)',
  );

const animalFields = {
  animalTypeId: z.string().regex(/^[0-9a-f]{24}$/, 'Choose an animal type'),
  breed: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9_]{1,39}$/, 'Invalid breed key'),
  name: text(80).min(1),
  sex: z.enum(ANIMAL_SEXES, { error: 'Choose the animal’s sex' }),
  birthDate: dateOnly.refine(notFuture, 'Birth date cannot be in the future'),
  birthDateEstimated: z.boolean(),
  acquisitionDate: dateOnly.refine(notFuture, 'Acquisition date cannot be in the future'),
  origin: z.object({ kind: z.enum(ANIMAL_ORIGINS), note: optionalText(300) }).strict(),
  currentStatus: z.enum(ANIMAL_STATUSES),
  sireId: objectId,
  damId: objectId,
  color: text(120).min(1),
  notes: text(2000),
};

const datesConsistent = (v: {
  birthDate?: string | null | undefined;
  acquisitionDate?: string | null | undefined;
}): boolean => !v.birthDate || !v.acquisitionDate || v.acquisitionDate >= v.birthDate;
const DATE_ORDER = {
  message: 'Acquisition date cannot be before the birth date',
  path: ['acquisitionDate'],
};

export const createAnimalSchema = z
  .object({
    /** Optional: when omitted the server issues the next free code for the farm (A-00001, …). */
    animalCode: animalCodeSchema.optional(),
    animalTypeId: animalFields.animalTypeId,
    breed: animalFields.breed.optional(),
    name: animalFields.name.optional(),
    sex: animalFields.sex,
    birthDate: animalFields.birthDate.optional(),
    birthDateEstimated: animalFields.birthDateEstimated.default(false),
    acquisitionDate: animalFields.acquisitionDate.optional(),
    origin: animalFields.origin.default({ kind: 'born_on_farm' }),
    currentStatus: animalFields.currentStatus.default('active'),
    sireId: animalFields.sireId.optional(),
    damId: animalFields.damId.optional(),
    color: animalFields.color.optional(),
    notes: animalFields.notes.optional(),
  })
  .strict()
  .refine(datesConsistent, DATE_ORDER);

/** `null` clears an optional field. animalCode, animalTypeId and farmId can never be changed (identity). */
export const updateAnimalSchema = z
  .object({
    breed: z.union([animalFields.breed, z.null()]).optional(),
    name: z.union([animalFields.name, z.null()]).optional(),
    sex: animalFields.sex.optional(),
    birthDate: z.union([animalFields.birthDate, z.null()]).optional(),
    birthDateEstimated: animalFields.birthDateEstimated.optional(),
    acquisitionDate: z.union([animalFields.acquisitionDate, z.null()]).optional(),
    origin: animalFields.origin.optional(),
    currentStatus: animalFields.currentStatus.optional(),
    sireId: z.union([animalFields.sireId, z.null()]).optional(),
    damId: z.union([animalFields.damId, z.null()]).optional(),
    color: z.union([animalFields.color, z.null()]).optional(),
    notes: z.union([animalFields.notes, z.null()]).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' })
  .refine(datesConsistent, DATE_ORDER);

export const animalListQuerySchema = listQuerySchema.extend({
  animalTypeId: objectId.optional(),
  breed: z
    .string()
    .regex(/^[a-z][a-z0-9_]{1,39}$/)
    .optional(),
  sex: z.enum(ANIMAL_SEXES).optional(),
  status: z.enum(ANIMAL_STATUSES).optional(),
  /** Archived animals are hidden unless asked for. */
  archived: z.enum(['false', 'true', 'all']).default('false'),
  sortBy: z.enum(['animalCode', 'name', 'birthDate', 'createdAt']).default('createdAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
});

export const archiveSchema = z.object({ reason: optionalText(300) }).strict();

export const addMediaSchema = z
  .object({
    kind: z.enum(MEDIA_KINDS),
    /** Location of a file already uploaded to the external object store (https only). */
    url: z.url({ protocol: /^https$/ }).max(1000),
    mimeType: z
      .string()
      .trim()
      .regex(/^[a-z]+\/[a-z0-9.+-]+$/i, 'Invalid MIME type')
      .max(100)
      .optional(),
    caption: optionalText(200),
  })
  .strict();

export type CreateFarmInput = z.infer<typeof createFarmSchema>;
export type UpdateFarmInput = z.infer<typeof updateFarmSchema>;
export type CreateAnimalInput = z.infer<typeof createAnimalSchema>;
export type UpdateAnimalInput = z.infer<typeof updateAnimalSchema>;
export type AnimalListQuery = z.infer<typeof animalListQuerySchema>;
