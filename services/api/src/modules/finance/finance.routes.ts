import express, { Router, type Request } from 'express';
import { z } from 'zod';
import {
  auditQuerySchema,
  commissionPreviewSchema,
  confirmSchema,
  createCommissionRuleSchema,
  createPaymentSchema,
  createWithdrawalSchema,
  financeListQuerySchema,
  idempotencyKeySchema,
  mockCompleteSchema,
  payoutAccountSchema,
  reconcileSchema,
  rejectSchema,
  updateCommissionRuleSchema,
  walletTransactionQuerySchema,
} from '@farmplus/validation';
import type { AppContext } from '../../context';
import { HttpError, notFound } from '../../lib/errors';
import { parse, requireActor } from '../../lib/http';
import { parseObjectId } from '../../lib/object-id';
import { authenticate } from '../../middleware/authenticate';
import { requirePermission } from '../../middleware/authorize';
import { rateLimits } from '../../middleware/rate-limit';
import { Payment } from '../../models';
import { signedWebhook } from '../orders/webhook-auth';
import { listFinancialAudit, verifyAuditChain } from './audit';
import { createRule, listRules, previewFee, updateRule } from './commission.service';
import {
  applyChargeEvent,
  createPayment,
  getPayment,
  listMyPayments,
  listPayments,
  paymentDTO,
  type FinanceDeps,
} from './payments.service';
import { MockPaymentProvider } from './provider';
import { reconcile } from './reconcile.service';
import {
  applyRefundEvent,
  approveRefund,
  getRefund,
  listRefunds,
  retryRefund,
} from './refunds.service';
import {
  getMyWallet,
  listMyTransactions,
  listTransactions,
  setPayoutAccount,
} from './wallet.service';
import {
  applyPayoutEvent,
  approveWithdrawal,
  cancelWithdrawal,
  listMyWithdrawals,
  listWithdrawals,
  rejectWithdrawal,
  requestWithdrawal,
  retryWithdrawal,
} from './withdrawals.service';

const id = (req: Request, name = 'id') =>
  parseObjectId((req.params as Record<string, unknown>)[name]);
export const financeDeps = (ctx: AppContext): FinanceDeps => ({
  provider: ctx.payments,
  masterKey: ctx.mfaKey,
});

/** Money-moving requests must be replayable safely: the client supplies a key and a retry returns the original result. */
const idempotencyKey = (req: Request): string => {
  const parsed = idempotencyKeySchema.safeParse(req.get('idempotency-key'));
  if (!parsed.success)
    throw new HttpError(
      400,
      'IDEMPOTENCY_KEY_REQUIRED',
      'Send an Idempotency-Key header (8–100 characters) with this request',
    );
  return parsed.data;
};

/** `/api/v1/payments` — the buyer starts and follows payments for their own orders. */
export function paymentsRouter(ctx: AppContext): Router {
  const router = Router();
  const limits = rateLimits(ctx.env);
  const d = financeDeps(ctx);
  router.use(authenticate(ctx));

  router.post('/', limits.payment, async (req, res) => {
    const { orderId } = parse(createPaymentSchema, req.body);
    const r = await createPayment(
      requireActor(req),
      parseObjectId(orderId),
      idempotencyKey(req),
      d,
    );
    res.status(r.replayed ? 200 : 201).json({ payment: r.payment, replayed: r.replayed });
  });
  router.get('/', async (req, res) => {
    const { orderId } = parse(
      z.object({ orderId: z.string().regex(/^[0-9a-f]{24}$/) }).strict(),
      req.query,
    );
    res.json({ payments: await listMyPayments(requireActor(req), parseObjectId(orderId), d) });
  });

  // Development only: stands in for the provider's checkout page + callback while no real provider is configured.
  router.post('/:id/mock-complete', async (req, res) => {
    const provider = ctx.payments;
    if (!(provider instanceof MockPaymentProvider) || ctx.env.NODE_ENV === 'production')
      throw notFound();
    const actor = requireActor(req);
    const { outcome } = parse(mockCompleteSchema, req.body);
    const payment = await Payment.findOne({ _id: id(req), buyerId: actor.userId });
    if (!payment?.providerRef) throw notFound('Payment not found');
    const charge = provider.settleCharge(payment.providerRef, outcome);
    const result = await applyChargeEvent(
      {
        id: `mock:${payment._id}:${outcome}`,
        type: outcome === 'succeeded' ? 'charge.succeeded' : 'charge.failed',
        ref: charge.ref,
        amountMinor: charge.amountMinor,
        currency: charge.currency,
      },
      provider.name,
    );
    res.json({ payment: paymentDTO((await Payment.findById(payment._id))!, provider), result });
  });
  return router;
}

/** `/api/v1/wallet` — the signed-in seller's own earnings balance, payout account and withdrawals. */
export function walletRouter(ctx: AppContext): Router {
  const router = Router();
  const limits = rateLimits(ctx.env);
  router.use(authenticate(ctx));
  router.use((_req, res, next) => {
    res.setHeader('cache-control', 'no-store');
    next();
  });

  router.get('/', async (req, res) => {
    res.json({ wallet: await getMyWallet(requireActor(req)) });
  });
  router.get('/transactions', async (req, res) => {
    const q = parse(walletTransactionQuerySchema.pick({ limit: true, cursor: true }), req.query);
    res.json(await listMyTransactions(requireActor(req), q));
  });
  router.put('/payout-account', limits.money, async (req, res) => {
    res.json({
      payoutAccount: await setPayoutAccount(
        requireActor(req),
        parse(payoutAccountSchema, req.body),
        ctx.mfaKey,
      ),
    });
  });
  router.get('/withdrawals', async (req, res) => {
    res.json(
      await listMyWithdrawals(
        requireActor(req),
        parse(financeListQuerySchema.pick({ limit: true, cursor: true }), req.query),
      ),
    );
  });
  router.post('/withdrawals', limits.money, async (req, res) => {
    const { amountMinor } = parse(createWithdrawalSchema, req.body);
    const r = await requestWithdrawal(requireActor(req), amountMinor, idempotencyKey(req));
    res.status(r.replayed ? 200 : 201).json({ withdrawal: r.withdrawal, replayed: r.replayed });
  });
  router.post('/withdrawals/:id/cancel', limits.money, async (req, res) => {
    res.json({ withdrawal: await cancelWithdrawal(requireActor(req), id(req)) });
  });
  return router;
}

/** `/api/v1/admin/finance` — every route names its own permission. */
export function adminFinanceRouter(ctx: AppContext): Router {
  const router = Router();
  const limits = rateLimits(ctx.env);
  const d = financeDeps(ctx);
  router.use(authenticate(ctx));
  router.use((_req, res, next) => {
    res.setHeader('cache-control', 'no-store');
    next();
  });

  router.get('/payments', requirePermission('payments.read'), async (req, res) => {
    res.json(await listPayments(parse(financeListQuerySchema, req.query), d));
  });
  router.get('/payments/:id', requirePermission('payments.read'), async (req, res) => {
    res.json({ payment: await getPayment(id(req), d) });
  });

  router.get('/refunds', requirePermission('payments.read'), async (req, res) => {
    res.json(await listRefunds(parse(financeListQuerySchema, req.query)));
  });
  router.get('/refunds/:id', requirePermission('payments.read'), async (req, res) => {
    res.json({ refund: await getRefund(id(req)) });
  });
  router.post(
    '/refunds/:id/approve',
    requirePermission('payments.refund'),
    limits.money,
    async (req, res) => {
      const { confirmation } = parse(confirmSchema, req.body);
      res.json({ refund: await approveRefund(requireActor(req), id(req), confirmation, d) });
    },
  );
  router.post(
    '/refunds/:id/retry',
    requirePermission('payments.refund'),
    limits.money,
    async (req, res) => {
      res.json({ refund: await retryRefund(requireActor(req), id(req), d) });
    },
  );

  router.get('/withdrawals', requirePermission('payments.read'), async (req, res) => {
    res.json(await listWithdrawals(parse(financeListQuerySchema, req.query)));
  });
  router.post(
    '/withdrawals/:id/approve',
    requirePermission('withdrawals.approve'),
    limits.money,
    async (req, res) => {
      const { confirmation } = parse(confirmSchema, req.body);
      res.json({
        withdrawal: await approveWithdrawal(requireActor(req), id(req), confirmation, d),
      });
    },
  );
  router.post(
    '/withdrawals/:id/reject',
    requirePermission('withdrawals.approve'),
    limits.money,
    async (req, res) => {
      const { reason } = parse(rejectSchema, req.body);
      res.json({ withdrawal: await rejectWithdrawal(requireActor(req), id(req), reason) });
    },
  );
  router.post(
    '/withdrawals/:id/retry',
    requirePermission('withdrawals.approve'),
    limits.money,
    async (req, res) => {
      res.json({ withdrawal: await retryWithdrawal(requireActor(req), id(req), d) });
    },
  );

  router.get('/commission-rules', requirePermission('commissions.manage'), async (_req, res) => {
    res.json({ rules: await listRules() });
  });
  router.post(
    '/commission-rules',
    requirePermission('commissions.manage'),
    limits.money,
    async (req, res) => {
      res.status(201).json({
        rule: await createRule(requireActor(req), parse(createCommissionRuleSchema, req.body)),
      });
    },
  );
  router.patch(
    '/commission-rules/:id',
    requirePermission('commissions.manage'),
    limits.money,
    async (req, res) => {
      res.json({
        rule: await updateRule(
          requireActor(req),
          id(req),
          parse(updateCommissionRuleSchema, req.body),
        ),
      });
    },
  );
  router.post(
    '/commission-rules/preview',
    requirePermission('commissions.manage'),
    async (req, res) => {
      const q = parse(commissionPreviewSchema, req.body);
      res.json({
        fee: await previewFee(
          q.priceMinor,
          q.categoryKey ?? null,
          q.at ? new Date(q.at) : undefined,
        ),
      });
    },
  );

  router.get('/wallet-transactions', requirePermission('payments.read'), async (req, res) => {
    const q = parse(walletTransactionQuerySchema, req.query);
    res.json(
      await listTransactions(
        { walletId: q.walletId ? parseObjectId(q.walletId) : undefined, journalKey: q.journalKey },
        q,
      ),
    );
  });

  router.get('/audit-logs', requirePermission('payments.read'), async (req, res) => {
    res.json(await listFinancialAudit(parse(auditQuerySchema, req.query)));
  });
  router.get('/audit-logs/verify', requirePermission('payments.verify'), async (_req, res) => {
    res.json(await verifyAuditChain());
  });

  router.post(
    '/reconcile',
    requirePermission('payments.verify'),
    limits.money,
    async (req, res) => {
      const body = parse(reconcileSchema, req.body ?? {});
      if (body.repair && body.confirmation !== 'REPAIR')
        throw new HttpError(400, 'CONFIRMATION_MISMATCH', 'Type REPAIR to confirm repairs');
      res.json({ report: await reconcile(requireActor(req), { repair: body.repair }, d) });
    },
  );
  return router;
}

// ---------------------------------------------------------------------------
// Provider callbacks (raw body + HMAC; see signedWebhook)
// ---------------------------------------------------------------------------
const eventSchema = z.object({
  id: z.string().min(3).max(100),
  type: z.enum([
    'charge.succeeded',
    'charge.failed',
    'refund.succeeded',
    'refund.failed',
    'payout.paid',
    'payout.failed',
  ]),
  data: z.object({
    ref: z.string().min(3).max(100),
    amountMinor: z.number().int().min(0),
    currency: z.string().length(3).default('THB'),
    failureCode: z.string().max(60).optional(),
  }),
});

export function financeWebhookRouter(ctx: AppContext): Router {
  const router = Router();
  router.post(
    '/payments',
    express.raw({ type: () => true, limit: '100kb' }),
    signedWebhook(ctx.env.PAYMENT_WEBHOOK_SECRET, 'payments', async (body) => {
      const parsed = eventSchema.safeParse(body);
      if (!parsed.success || !ctx.payments) return { result: 'ignored' };
      const { id: eventId, type, data } = parsed.data;
      const base = {
        id: eventId,
        ref: data.ref,
        amountMinor: data.amountMinor,
        currency: data.currency,
        failureCode: data.failureCode,
      };
      const provider = ctx.payments.name;
      if (type === 'charge.succeeded' || type === 'charge.failed')
        return {
          result: await applyChargeEvent({ ...base, type }, provider),
        };
      if (type === 'refund.succeeded' || type === 'refund.failed')
        return { result: await applyRefundEvent({ ...base, type }, provider) };
      return { result: await applyPayoutEvent({ ...base, type }, provider) };
    }),
  );
  return router;
}
