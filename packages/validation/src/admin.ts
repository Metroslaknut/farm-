import { z } from 'zod';
import {
  IDENTITY_VERIFICATION_STATUSES,
  PERMISSION_KEYS,
  REGISTRATION_STATUSES,
  REGISTRATION_TYPES,
  SELLER_VERIFICATION_STATUSES,
  USER_STATUSES,
} from '@farmplus/shared-types';
import { listQuerySchema } from './auth';

const reason = z.string().trim().min(3, 'A reason of at least 3 characters is required').max(500);
const objectId = z.string().regex(/^[0-9a-f]{24}$/, 'Invalid id');
const isoDate = z.iso.datetime({ offset: true });

export const submitRegistrationSchema = z
  .object({
    type: z.enum(REGISTRATION_TYPES),
    businessName: z.string().trim().min(1).max(120).optional(),
    note: z.string().trim().max(1000).optional(),
    documents: z
      .array(
        z
          .object({
            kind: z.string().trim().min(1).max(40),
            url: z.url({ protocol: /^https$/ }).max(500),
          })
          .strict(),
      )
      .max(10)
      .default([]),
  })
  .strict();

export const registrationDecisionSchema = z.object({ reason }).strict();

export const registrationListQuerySchema = listQuerySchema.extend({
  status: z.enum(REGISTRATION_STATUSES).optional(),
  type: z.enum(REGISTRATION_TYPES).optional(),
  sortBy: z.enum(['submittedAt', 'status']).default('submittedAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
});

export const adminUserListQuerySchema = listQuerySchema.extend({
  status: z.enum(USER_STATUSES).optional(),
  role: z
    .string()
    .regex(/^[a-z][a-z0-9_]{1,40}$/)
    .optional(),
  identity: z.enum(IDENTITY_VERIFICATION_STATUSES).optional(),
  seller: z.enum(SELLER_VERIFICATION_STATUSES).optional(),
  sortBy: z.enum(['createdAt', 'displayName', 'lastLoginAt']).default('createdAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
});

export const createRoleSchema = z
  .object({
    key: z.string().regex(/^[a-z][a-z0-9_]{2,40}$/, 'Lowercase letters, digits and underscores'),
    name: z.string().trim().min(1).max(80),
    description: z.string().trim().max(300).default(''),
    permissions: z.array(z.enum(PERMISSION_KEYS)).max(PERMISSION_KEYS.length).default([]),
  })
  .strict();

export const updateRoleSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    description: z.string().trim().max(300).optional(),
    permissions: z.array(z.enum(PERMISSION_KEYS)).max(PERMISSION_KEYS.length).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' });

export const auditLogListQuerySchema = listQuerySchema.extend({
  action: z.string().trim().max(100).optional(),
  actorId: objectId.optional(),
  targetType: z.string().trim().max(40).optional(),
  targetId: z.string().trim().max(64).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
});

export const updateSettingsSchema = z
  .object({
    values: z.record(z.string().max(80), z.union([z.string().max(300), z.number(), z.boolean()])),
    reason,
  })
  .strict();

export { objectId as objectIdSchema };
