import { z } from 'zod';
import {
  DELIVERY_OPTIONS,
  FULFILLMENT_METHODS,
  LISTING_LIMITS,
  PRODUCT_LIMITS,
  PRODUCT_SORTS,
  PRODUCT_STATUSES,
} from '@farmplus/shared-types';
import { shippingConfigSchema } from './marketplace';
import { deliveryAddressSchema } from './orders';

const objectId = z.string().regex(/^[0-9a-f]{24}$/, 'Invalid id');
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F‪-‮⁦-⁩]/;
const plain = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `At most ${max} characters`)
    .refine((v) => !CONTROL.test(v), 'Contains characters that are not allowed');
const price = z
  .number({ error: 'Enter an amount' })
  .int('Amounts are whole satang')
  .positive('The amount must be greater than zero')
  .max(LISTING_LIMITS.maxPriceMinor, 'The amount is too large');
const date = z.string().datetime({ offset: true, message: 'Use an ISO date-time' });
const key = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9_]{1,39}$/, 'Use lower-case letters, digits and _');

const photo = z
  .object({ url: z.url({ protocol: /^https$/ }).max(1000), caption: plain(200).optional() })
  .strict();
const spec = z
  .object({
    name: plain(PRODUCT_LIMITS.specName).min(1, 'Name the specification'),
    value: plain(PRODUCT_LIMITS.specValue).min(1, 'Give the value'),
  })
  .strict();
const promotion = z
  .object({ priceMinor: price, startsAt: date, endsAt: date })
  .strict()
  .refine((p) => new Date(p.endsAt) > new Date(p.startsAt), {
    message: 'The promotion must end after it starts',
    path: ['endsAt'],
  });
const regulatory = z
  .object({
    registrationNumber: plain(60).min(3, 'Enter the registration or licence number'),
    notes: plain(300).optional(),
  })
  .strict();

/** Shipping for products: the seller's rates only. Animal-transport requirements do not apply to goods. */
const productShipping = shippingConfigSchema.refine((s) => s.requirements.length === 0, {
  message: 'Transport requirements are for animals only',
  path: ['requirements'],
});

const fields = {
  categoryKey: key,
  title: plain(PRODUCT_LIMITS.title).min(3, 'Give the product a title'),
  description: plain(PRODUCT_LIMITS.description).optional(),
  brand: plain(PRODUCT_LIMITS.brand).optional(),
  sku: plain(PRODUCT_LIMITS.sku).optional(),
  unit: plain(PRODUCT_LIMITS.unit).optional(),
  priceMinor: price,
  promotion: promotion.nullable().optional(),
  specs: z.array(spec).max(PRODUCT_LIMITS.specs),
  photos: z.array(photo).max(PRODUCT_LIMITS.photos),
  deliveryOptions: z.array(z.enum(DELIVERY_OPTIONS)).min(1).max(2),
  shipping: productShipping.optional(),
  minOrderQty: z.number().int().min(1).max(PRODUCT_LIMITS.maxQuantity),
  maxOrderQty: z.number().int().min(1).max(PRODUCT_LIMITS.maxQuantity).nullable().optional(),
  lowStockThreshold: z.number().int().min(0).max(PRODUCT_LIMITS.maxStock).nullable().optional(),
  regulatory: regulatory.nullable().optional(),
};

const crossChecks = (
  v: {
    priceMinor?: number | undefined;
    promotion?: { priceMinor: number } | null | undefined;
    minOrderQty?: number | undefined;
    maxOrderQty?: number | null | undefined;
    deliveryOptions?: readonly string[] | undefined;
    shipping?: unknown;
  },
  ctx: z.RefinementCtx,
) => {
  if (v.promotion && v.priceMinor !== undefined && v.promotion.priceMinor >= v.priceMinor)
    ctx.addIssue({
      code: 'custom',
      path: ['promotion', 'priceMinor'],
      message: 'The promotion price must be lower than the regular price',
    });
  if (v.maxOrderQty != null && v.minOrderQty !== undefined && v.maxOrderQty < v.minOrderQty)
    ctx.addIssue({
      code: 'custom',
      path: ['maxOrderQty'],
      message: 'The maximum cannot be below the minimum',
    });
};

export const createProductSchema = z
  .object({
    ...fields,
    // Defaults live here only: an UPDATE must never silently reset a field the caller did not send.
    specs: fields.specs.default([]),
    photos: fields.photos.default([]),
    deliveryOptions: fields.deliveryOptions.default(['pickup']),
    minOrderQty: fields.minOrderQty.default(1),
    /** Units on hand when the product is created (recorded as the first inventory movement). */
    stock: z.number().int().min(0).max(PRODUCT_LIMITS.maxStock).default(0),
  })
  .strict()
  .superRefine(crossChecks);

export const updateProductSchema = z
  .object({
    categoryKey: fields.categoryKey,
    title: fields.title,
    description: plain(PRODUCT_LIMITS.description).nullable(),
    brand: plain(PRODUCT_LIMITS.brand).nullable(),
    sku: plain(PRODUCT_LIMITS.sku).nullable(),
    unit: plain(PRODUCT_LIMITS.unit).nullable(),
    priceMinor: price,
    promotion: promotion.nullable(),
    specs: fields.specs,
    photos: fields.photos,
    deliveryOptions: fields.deliveryOptions,
    shipping: productShipping.nullable(),
    minOrderQty: fields.minOrderQty,
    maxOrderQty: fields.maxOrderQty,
    lowStockThreshold: fields.lowStockThreshold,
    regulatory: fields.regulatory,
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to change' })
  .superRefine(crossChecks);

export const stockAdjustSchema = z
  .object({
    /** Add (positive) or remove (negative) units. */
    delta: z.number().int().min(-PRODUCT_LIMITS.maxStock).max(PRODUCT_LIMITS.maxStock).optional(),
    /** Or count the shelf and set the on-hand total. */
    set: z.number().int().min(0).max(PRODUCT_LIMITS.maxStock).optional(),
    reason: plain(200).min(3, 'Give a reason (e.g. "stock count", "damaged")'),
  })
  .strict()
  .refine((v) => (v.delta === undefined) !== (v.set === undefined), {
    message: 'Give either a change (delta) or a new total (set)',
    path: ['delta'],
  })
  .refine((v) => v.delta !== 0, { message: 'The change cannot be zero', path: ['delta'] });

export const productReasonSchema = z
  .object({ reason: plain(300).min(3, 'Give a reason') })
  .strict();
export const productOptionalReasonSchema = z.object({ reason: plain(300).optional() }).strict();

export const shopSearchSchema = z
  .object({
    page: z.coerce.number().int().min(1).max(1000).default(1),
    pageSize: z.coerce.number().int().min(1).max(48).default(24),
    q: plain(100).optional(),
    category: key.optional(),
    minPriceMinor: z.coerce.number().int().min(0).optional(),
    maxPriceMinor: z.coerce.number().int().min(0).optional(),
    inStock: z
      .enum(['true', 'false'])
      .transform((v) => v === 'true')
      .optional(),
    onSale: z
      .enum(['true', 'false'])
      .transform((v) => v === 'true')
      .optional(),
    farmId: objectId.optional(),
    sort: z.enum(PRODUCT_SORTS).default('newest'),
  })
  .strict()
  .refine(
    (v) =>
      v.minPriceMinor === undefined ||
      v.maxPriceMinor === undefined ||
      v.minPriceMinor <= v.maxPriceMinor,
    { message: 'The lowest price is above the highest', path: ['minPriceMinor'] },
  );

export const farmProductsQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(1000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    status: z.enum(PRODUCT_STATUSES).optional(),
    q: plain(100).optional(),
  })
  .strict();
export const moderationProductsQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(1000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    status: z.enum(PRODUCT_STATUSES).default('PENDING_REVIEW'),
  })
  .strict();
export const movementsQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(30),
    cursor: z.string().max(200).optional(),
  })
  .strict();

// ---- cart & checkout
export const setCartItemSchema = z
  .object({ quantity: z.number().int().min(1).max(PRODUCT_LIMITS.maxQuantity) })
  .strict();
export const cartQuerySchema = z.object({ province: plain(80).min(2).optional() }).strict();
export const checkoutCartSchema = z
  .object({
    fulfillment: z.enum(FULFILLMENT_METHODS),
    address: deliveryAddressSchema.optional(),
    /** What the buyer saw per seller: if anything changed since (price, shipping), checkout stops and asks again. */
    expected: z
      .array(
        z
          .object({
            farmId: objectId,
            itemsMinor: z.number().int().min(0),
            shippingMinor: z.number().int().min(0),
          })
          .strict(),
      )
      .min(1)
      .max(PRODUCT_LIMITS.cartLines),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.fulfillment === 'delivery' && !v.address)
      ctx.addIssue({ code: 'custom', path: ['address'], message: 'Enter the delivery address' });
    if (v.fulfillment === 'pickup' && v.address)
      ctx.addIssue({
        code: 'custom',
        path: ['address'],
        message: 'A pickup order has no delivery address',
      });
  });

// ---- reviews
export const createReviewSchema = z
  .object({
    rating: z.number().int().min(1, 'Choose 1 to 5 stars').max(5, 'Choose 1 to 5 stars'),
    title: plain(PRODUCT_LIMITS.reviewTitle).optional(),
    body: plain(PRODUCT_LIMITS.reviewBody).min(3, 'Write a few words about the product'),
  })
  .strict();
export const reviewsQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(50).default(10),
    cursor: z.string().max(200).optional(),
  })
  .strict();

// ---- categories (admin)
export const upsertCategorySchema = z
  .object({
    name: plain(80).min(2),
    description: plain(300).nullable().optional(),
    parentKey: key.nullable().optional(),
    regulation: z.enum(['none', 'regulated', 'prohibited']).optional(),
    sortOrder: z.number().int().min(0).max(1000).optional(),
    reason: plain(300).min(3, 'Give a reason'),
  })
  .strict();
/** Switching sales on or off is the compliance gate: regulated categories need the review reference and a typed confirmation. */
export const categorySalesSchema = z
  .object({
    enabled: z.boolean(),
    complianceReference: plain(200).min(3).optional(),
    reason: plain(300).min(3, 'Give a reason'),
    confirmation: plain(80).min(3),
  })
  .strict();
export const categoryKeySchema = key;
