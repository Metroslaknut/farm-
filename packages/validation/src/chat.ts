import { z } from 'zod';
import {
  CHAT_LIMITS,
  MESSAGE_REPORT_ACTIONS,
  MESSAGE_REPORT_STATUSES,
  NOTIFICATION_CATEGORIES,
  REPORT_REASONS,
} from '@farmplus/shared-types';

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');
const limit = z.coerce.number().int().min(1).max(50);
const bool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');

// Control characters other than newline/tab are rejected; the text is stored as plain text and shown as text.
// eslint-disable-next-line no-control-regex -- the point is to refuse control characters
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
export const messageBody = z
  .string()
  .transform((s) => s.replace(/\r\n?/g, '\n').trim())
  .pipe(
    z
      .string()
      .min(1, 'Write a message')
      .max(CHAT_LIMITS.body, `At most ${CHAT_LIMITS.body} characters`)
      .refine((s) => !CONTROL.test(s), 'The message contains characters that are not allowed'),
  );

export const notificationListQuerySchema = z
  .object({
    cursor: objectId.optional(),
    limit: limit.optional(),
    unread: bool.optional(),
    category: z.enum(NOTIFICATION_CATEGORIES).optional(),
  })
  .strict();
export const markAllReadSchema = z
  .object({ category: z.enum(NOTIFICATION_CATEGORIES).optional() })
  .strict();
export const notificationPreferencesSchema = z
  .object({
    categories: z
      .partialRecord(z.enum(NOTIFICATION_CATEGORIES), z.object({ inApp: z.boolean() }).strict())
      .refine((c) => Object.keys(c).length > 0, 'Nothing to change'),
  })
  .strict();

export const startConversationSchema = z
  .object({ listingId: objectId.optional(), productId: objectId.optional(), message: messageBody })
  .strict()
  .refine((v) => Boolean(v.listingId) !== Boolean(v.productId), {
    message: 'Provide either listingId or productId',
    path: ['listingId'],
  });
export const sendMessageSchema = z
  .object({ body: messageBody, clientId: z.string().trim().min(8).max(64).optional() })
  .strict();
export const messageListQuerySchema = z
  .object({
    before: z.coerce.number().int().min(1).optional(),
    after: z.coerce.number().int().min(0).optional(),
    limit: limit.optional(),
  })
  .strict()
  .refine((q) => !(q.before && q.after !== undefined), 'Use either before or after');
export const conversationListQuerySchema = z
  .object({
    cursor: z
      .string()
      .regex(/^\d+_[a-f\d]{24}$/i, 'Invalid cursor')
      .optional(),
    limit: limit.optional(),
    unread: bool.optional(),
  })
  .strict();
export const markConversationReadSchema = z.object({}).strict();
export const reportMessageSchema = z
  .object({
    reason: z.enum(REPORT_REASONS),
    details: z.string().trim().max(500).optional(),
    messageId: objectId.optional(),
  })
  .strict();
export const messageReportListQuerySchema = z
  .object({
    status: z.enum(MESSAGE_REPORT_STATUSES).optional(),
    cursor: objectId.optional(),
    limit: limit.optional(),
  })
  .strict();
export const resolveMessageReportSchema = z
  .object({ action: z.enum(MESSAGE_REPORT_ACTIONS), note: z.string().trim().max(500).optional() })
  .strict();

/** Realtime client → server payloads. */
export const joinConversationSchema = z.object({ conversationId: objectId }).strict();
