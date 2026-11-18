import { z } from 'zod';
import {
  FULFILLMENT_METHODS,
  ORDER_LIMITS,
  ORDER_STATUSES,
  SHIPMENT_STATUSES,
} from '@farmplus/shared-types';

const objectId = z.string().regex(/^[0-9a-f]{24}$/, 'Invalid id');
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F‪-‮⁦-⁩]/;
const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `At most ${max} characters`)
    .refine((v) => !CONTROL.test(v), 'Contains characters that are not allowed');

export const destinationSchema = z
  .object({
    province: text(80).min(2, 'Enter the province'),
    district: text(80).optional(),
    postalCode: z
      .string()
      .trim()
      .regex(/^\d{5}$/, 'Postal code must be 5 digits')
      .optional(),
  })
  .strict();

export const deliveryAddressSchema = z
  .object({
    recipientName: text(100).min(2, 'Enter the recipient name'),
    phone: z
      .string()
      .trim()
      .regex(/^\+?[0-9][0-9 -]{7,18}$/, 'Enter a valid phone number'),
    line1: text(ORDER_LIMITS.address).min(5, 'Enter the street address'),
    subdistrict: text(80).optional(),
    district: text(80).min(2, 'Enter the district'),
    province: text(80).min(2, 'Enter the province'),
    postalCode: z
      .string()
      .trim()
      .regex(/^\d{5}$/, 'Postal code must be 5 digits'),
    note: text(ORDER_LIMITS.note).optional(),
  })
  .strict();

export const quoteRequestSchema = z
  .object({ listingId: objectId, destination: destinationSchema })
  .strict();

export const createOrderSchema = z
  .object({
    negotiationId: objectId,
    fulfillment: z.enum(FULFILLMENT_METHODS),
    quoteId: objectId.optional(),
    optionId: z.string().min(1).max(60).optional(),
    address: deliveryAddressSchema.optional(),
    acknowledgeTransport: z.boolean().optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.fulfillment === 'delivery') {
      if (!v.address)
        ctx.addIssue({ code: 'custom', path: ['address'], message: 'Enter the delivery address' });
      if (!v.quoteId || !v.optionId)
        ctx.addIssue({ code: 'custom', path: ['quoteId'], message: 'Get a shipping quote first' });
    } else if (v.address || v.quoteId) {
      ctx.addIssue({
        code: 'custom',
        path: ['fulfillment'],
        message: 'A pickup order has no delivery address or shipping quote',
      });
    }
  });

export const requoteSchema = z
  .object({
    quoteId: objectId,
    optionId: z.string().min(1).max(60),
    address: deliveryAddressSchema,
    acknowledgeTransport: z.boolean().optional(),
  })
  .strict();

export const cancelOrderSchema = z
  .object({ reason: text(ORDER_LIMITS.reason).min(3, 'Give a reason') })
  .strict();
export const optionalNoteSchema = z.object({ note: text(ORDER_LIMITS.note).optional() }).strict();

export const shipOrderSchema = z
  .object({
    carrier: text(80).min(2, 'Enter the carrier or how it is sent'),
    trackingNumber: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9-]{4,40}$/, 'Tracking numbers use letters, digits and dashes')
      .optional(),
    expectedDays: z
      .object({ min: z.number().int().min(0).max(60), max: z.number().int().min(0).max(60) })
      .strict()
      .optional(),
  })
  .strict();

export const shipmentEventSchema = z
  .object({
    status: z.enum(SHIPMENT_STATUSES),
    note: text(ORDER_LIMITS.note).optional(),
    location: text(100).optional(),
  })
  .strict();

const limit = z.coerce.number().int().min(1).max(50).default(20);
const cursor = z.string().min(1).max(300).optional();
export const orderListQuerySchema = z
  .object({ cursor, limit, status: z.enum(ORDER_STATUSES).optional() })
  .strict();
export const farmOrderListQuerySchema = orderListQuerySchema;
