import { z } from 'zod';
import {
  CURRENCIES,
  DELIVERY_OPTIONS,
  LISTING_LIMITS,
  LISTING_SORTS,
  LISTING_STATUSES,
  ANIMAL_SEXES,
  ORDER_LIMITS,
  SHIPPING_MODES,
  TRANSPORT_REQUIREMENTS,
} from '@farmplus/shared-types';

const objectId = z.string().regex(/^[0-9a-f]{24}$/, 'Invalid id');
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F‪-‮⁦-⁩]/;
const plain = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `At most ${max} characters`)
    .refine((v) => !CONTROL.test(v), 'Contains characters that are not allowed');

/** Integer satang. Floats, zero, negatives and absurd values are refused (never rounded). */
export const moneyMinor = z
  .number({ error: 'Enter an amount' })
  .int('Amounts are whole satang')
  .positive('The amount must be greater than zero')
  .max(LISTING_LIMITS.maxPriceMinor, 'The amount is too large');

const currency = z.enum(CURRENCIES, { error: 'Only THB is supported' });

const photo = z
  .object({
    url: z.url({ protocol: /^https$/ }).max(1000),
    caption: plain(200).optional(),
  })
  .strict();

/** The seller's own shipping terms for a listing (a rate the SELLER states; FARM+ never invents carrier rates). */
export const shippingConfigSchema = z
  .object({
    mode: z.enum(SHIPPING_MODES),
    flatPriceMinor: z.number().int().min(0).max(ORDER_LIMITS.maxFlatPriceMinor).optional(),
    provinces: z
      .array(
        z
          .object({
            province: plain(80).min(2),
            priceMinor: z.number().int().min(0).max(ORDER_LIMITS.maxFlatPriceMinor),
          })
          .strict(),
      )
      .max(77)
      .optional(),
    estimatedDays: z
      .object({ min: z.number().int().min(0).max(60), max: z.number().int().min(0).max(60) })
      .strict()
      .optional(),
    requirements: z.array(z.enum(TRANSPORT_REQUIREMENTS)).max(3).default([]),
    notes: plain(500).optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.mode === 'flat' && v.flatPriceMinor === undefined)
      ctx.addIssue({
        code: 'custom',
        path: ['flatPriceMinor'],
        message: 'Enter the delivery price',
      });
    if (v.mode === 'by_province' && (!v.provinces || v.provinces.length === 0))
      ctx.addIssue({
        code: 'custom',
        path: ['provinces'],
        message: 'Add at least one province you deliver to',
      });
    if (v.estimatedDays && v.estimatedDays.min > v.estimatedDays.max)
      ctx.addIssue({
        code: 'custom',
        path: ['estimatedDays'],
        message: 'The shortest time is above the longest',
      });
    if (
      v.provinces &&
      new Set(v.provinces.map((p) => p.province.toLowerCase())).size !== v.provinces.length
    )
      ctx.addIssue({ code: 'custom', path: ['provinces'], message: 'A province is listed twice' });
  });

export type ShippingConfigInput = z.infer<typeof shippingConfigSchema>;

const listingFields = {
  title: plain(LISTING_LIMITS.title).min(3, 'Give the listing a title'),
  description: plain(LISTING_LIMITS.description).optional(),
  askingPriceMinor: moneyMinor,
  negotiable: z.boolean().default(true),
  minOfferMinor: moneyMinor.optional(),
  conditions: plain(LISTING_LIMITS.conditions).optional(),
  deliveryOptions: z.array(z.enum(DELIVERY_OPTIONS)).min(1, 'Choose at least one option').max(2),
  photos: z.array(photo).max(LISTING_LIMITS.photos),
  /** How the seller delivers (required when `delivery` is offered). */
  shipping: shippingConfigSchema.optional(),
};

const floorOk = (v: {
  askingPriceMinor?: number | undefined;
  minOfferMinor?: number | undefined;
}) =>
  v.minOfferMinor === undefined ||
  v.askingPriceMinor === undefined ||
  v.minOfferMinor <= v.askingPriceMinor;
const floorMsg = {
  message: 'The lowest offer cannot be above the asking price',
  path: ['minOfferMinor'],
};

export const createListingSchema = z
  .object({
    animalId: objectId,
    ...listingFields,
    // Defaults belong to creation only: in Zod 4 a default inside `.optional()` would overwrite stored values on edit.
    deliveryOptions: listingFields.deliveryOptions.default(['pickup']),
    photos: listingFields.photos.default([]),
  })
  .strict()
  .refine(floorOk, floorMsg);

/** `null` clears an optional field. */
export const updateListingSchema = z
  .object({
    title: listingFields.title.optional(),
    description: listingFields.description.nullable(),
    askingPriceMinor: moneyMinor.optional(),
    negotiable: z.boolean().optional(),
    minOfferMinor: moneyMinor.nullable(),
    conditions: listingFields.conditions.nullable(),
    deliveryOptions: listingFields.deliveryOptions.optional(),
    photos: listingFields.photos.optional(),
    shipping: shippingConfigSchema.nullable(),
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to change' })
  .refine(
    (v) =>
      v.minOfferMinor === null ||
      floorOk({
        askingPriceMinor: v.askingPriceMinor,
        minOfferMinor: v.minOfferMinor ?? undefined,
      }),
    floorMsg,
  );

export const reasonSchema = z.object({ reason: plain(300).min(3, 'Give a reason') }).strict();
export const optionalReasonSchema = z.object({ reason: plain(300).optional() }).strict();

export const createOfferSchema = z
  .object({
    amountMinor: moneyMinor,
    currency: currency.default('THB'),
    message: plain(LISTING_LIMITS.message).optional(),
  })
  .strict();

/** `expectedSeq` pins the offer the caller saw, so a counter that arrived meanwhile cannot be answered blindly. */
export const counterSchema = z
  .object({
    amountMinor: moneyMinor,
    currency: currency.default('THB'),
    message: plain(LISTING_LIMITS.message).optional(),
    expectedSeq: z.number().int().min(1),
  })
  .strict();
export const acceptSchema = z.object({ expectedSeq: z.number().int().min(1) }).strict();
export const rejectOfferSchema = z
  .object({ reason: plain(300).optional(), expectedSeq: z.number().int().min(1).optional() })
  .strict();

const limit = z.coerce.number().int().min(1).max(50).default(20);
const cursor = z.string().min(1).max(300).optional();
const minor = z.coerce.number().int().min(0).max(LISTING_LIMITS.maxPriceMinor);

export const listingSearchSchema = z
  .object({
    cursor,
    limit,
    q: plain(80).optional(),
    animalTypeId: objectId.optional(),
    breed: plain(80).optional(),
    province: plain(80).optional(),
    district: plain(80).optional(),
    sex: z.enum(ANIMAL_SEXES).optional(),
    minPriceMinor: minor.optional(),
    maxPriceMinor: minor.optional(),
    sort: z.enum(LISTING_SORTS).default('newest'),
  })
  .strict()
  .refine(
    (v) =>
      v.minPriceMinor === undefined ||
      v.maxPriceMinor === undefined ||
      v.minPriceMinor <= v.maxPriceMinor,
    {
      message: 'The minimum price is above the maximum',
      path: ['minPriceMinor'],
    },
  );

export const sellerListingsQuerySchema = z
  .object({ cursor, limit, status: z.enum(LISTING_STATUSES).optional() })
  .strict();

export const pageQuerySchema = z.object({ cursor, limit }).strict();
export const moderationListQuerySchema = z
  .object({ cursor, limit, status: z.enum(LISTING_STATUSES).default('PENDING_REVIEW') })
  .strict();

export type CreateListingInput = z.infer<typeof createListingSchema>;
export type UpdateListingInput = z.infer<typeof updateListingSchema>;
