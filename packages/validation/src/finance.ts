import { z } from 'zod';
import { COMMISSION_LIMITS } from '@farmplus/shared-types';

const objectId = z.string().regex(/^[0-9a-f]{24}$/, 'Invalid id');
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F‪-‮⁦-⁩]/;
const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `At most ${max} characters`)
    .refine((v) => !CONTROL.test(v), 'Contains characters that are not allowed');
const minor = z.number().int('Whole satang only').min(0).max(1_000_000_000_000);
const date = z.string().datetime({ offset: true, message: 'Use an ISO date-time' });

export const idempotencyKeySchema = z
  .string()
  .trim()
  .min(8, 'Idempotency-Key must be at least 8 characters')
  .max(100)
  .regex(/^[A-Za-z0-9_\-:.]+$/, 'Idempotency-Key may only contain letters, digits and _-:.');

export const createPaymentSchema = z.object({ orderId: objectId }).strict();
export const mockCompleteSchema = z.object({ outcome: z.enum(['succeeded', 'failed']) }).strict();

// ---- commission rules
const commissionBody = z
  .object({
    name: text(80).min(2, 'Give the rule a name'),
    feeBps: z
      .number()
      .int()
      .min(0)
      .max(COMMISSION_LIMITS.maxBps, `At most ${COMMISSION_LIMITS.maxBps} bps (50%)`),
    minFeeMinor: minor.nullable().optional(),
    maxFeeMinor: minor.nullable().optional(),
    priceMinMinor: minor.nullable().optional(),
    priceMaxMinor: minor.nullable().optional(),
    categories: z.array(z.string().trim().min(1).max(60)).max(50),
    startsAt: date,
    endsAt: date.nullable().optional(),
    priority: z.number().int().min(0).max(COMMISSION_LIMITS.maxPriority),
    reason: text(300).min(3, 'Give a reason (it is kept in the financial audit log)'),
  })
  .strict();

const commissionRefine = (
  v: z.infer<typeof commissionBody> | Partial<z.infer<typeof commissionBody>>,
  ctx: z.RefinementCtx,
) => {
  const bad = (path: string, message: string) =>
    ctx.addIssue({ code: 'custom', path: [path], message });
  if (v.minFeeMinor != null && v.maxFeeMinor != null && v.minFeeMinor > v.maxFeeMinor)
    bad('maxFeeMinor', 'Maximum fee must not be below the minimum fee');
  if (v.priceMinMinor != null && v.priceMaxMinor != null && v.priceMinMinor > v.priceMaxMinor)
    bad('priceMaxMinor', 'Maximum price must not be below the minimum price');
  if (v.startsAt && v.endsAt && new Date(v.endsAt) <= new Date(v.startsAt))
    bad('endsAt', 'The end date must be after the start date');
};

// Defaults belong to creation only: in Zod 4 a default inside `.partial()` would overwrite stored values on every edit.
export const createCommissionRuleSchema = commissionBody
  .extend({ categories: commissionBody.shape.categories.default([]) })
  .superRefine(commissionRefine);
export const updateCommissionRuleSchema = commissionBody
  .partial()
  .extend({ reason: commissionBody.shape.reason, active: z.boolean().optional() })
  .strict()
  .superRefine(commissionRefine);
export const commissionPreviewSchema = z
  .object({
    priceMinor: minor.min(1),
    categoryKey: z.string().trim().min(1).max(60).optional(),
    at: date.optional(),
  })
  .strict();

// ---- confirmations for sensitive actions
/** The caller must type the reference of the thing they are acting on (refund no., withdrawal no.). */
export const confirmSchema = z.object({ confirmation: z.string().trim().min(3).max(60) }).strict();
export const rejectSchema = z.object({ reason: text(300).min(3, 'Give a reason') }).strict();
export const reconcileSchema = z
  .object({
    repair: z.boolean().default(false),
    confirmation: z.string().trim().max(60).optional(),
  })
  .strict();

// ---- payout account & withdrawals
export const payoutAccountSchema = z
  .object({
    bankCode: z
      .string()
      .trim()
      .regex(/^[A-Z0-9]{2,10}$/, 'Use the bank code, e.g. KBANK'),
    accountNumber: z
      .string()
      .trim()
      .regex(/^\d{8,20}$/, 'Account number must be 8–20 digits'),
    accountName: text(100).min(2, 'Enter the account holder name'),
  })
  .strict();
export const createWithdrawalSchema = z
  .object({ amountMinor: z.number().int().positive().max(1_000_000_000_000) })
  .strict();

// ---- list queries
const cursor = z.string().max(200).optional();
const limit = z.coerce.number().int().min(1).max(100).default(20);
export const financeListQuerySchema = z
  .object({
    status: z.string().max(30).optional(),
    orderId: objectId.optional(),
    limit,
    cursor,
  })
  .strict();
export const walletTransactionQuerySchema = z
  .object({
    walletId: objectId.optional(),
    journalKey: z.string().max(120).optional(),
    limit,
    cursor,
  })
  .strict();
export const auditQuerySchema = z
  .object({
    action: z.string().max(60).optional(),
    targetId: z.string().max(60).optional(),
    limit,
    cursor,
  })
  .strict();
