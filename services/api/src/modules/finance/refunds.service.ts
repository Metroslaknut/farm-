import { Types } from 'mongoose';
import { byProviderRef } from './provider-ref';
import {
  REFUND_TRANSITIONS,
  type CursorPage,
  type RefundDTO,
  type RefundStatus,
} from '@farmplus/shared-types';
import type { Actor } from '../../context';
import { notFound } from '../../lib/errors';
import { Order, Payment, Refund, type RefundDoc } from '../../models';
import { isSellerSide } from '../marketplace/common';
import { markOrderRefunded } from '../orders/orders.service';
import { PROVIDER, SYSTEM, recordFinancial, userActor } from './audit';
import { postRefund } from './ledger';
import { PaymentProviderError } from './provider';
import { beforeCursor, createdKey, err, pageOf } from './shared';
import type { FinanceDeps } from './payments.service';

export const refundDTO = (r: RefundDoc): RefundDTO => ({
  id: String(r._id),
  refundNo: r.refundNo,
  paymentId: String(r.paymentId),
  orderId: r.orderId ? String(r.orderId) : null,
  orderNo: r.orderNo ?? null,
  amountMinor: r.amountMinor,
  currency: r.currency,
  reason: r.reason,
  status: r.status,
  requestedAt: r.requestedAt.toISOString(),
  approvedAt: r.approvedAt?.toISOString() ?? null,
  approvedBy: r.approvedBy ? String(r.approvedBy) : null,
  completedAt: r.completedAt?.toISOString() ?? null,
  failureCode: r.failureCode ?? null,
});

async function moveRefund(
  refund: RefundDoc,
  to: RefundStatus,
  set: Record<string, unknown> = {},
  inc: Record<string, number> = {},
): Promise<RefundDoc | null> {
  if (!REFUND_TRANSITIONS[refund.status].includes(to))
    throw err(409, 'INVALID_TRANSITION', `A refund cannot move from ${refund.status} to ${to}`);
  return Refund.findOneAndUpdate(
    { _id: refund._id, status: refund.status },
    { $set: { status: to, ...set }, ...(Object.keys(inc).length ? { $inc: inc } : {}) },
    { returnDocument: 'after' },
  );
}

export async function listRefunds(q: {
  status?: string | undefined;
  orderId?: string | undefined;
  limit: number;
  cursor?: string | undefined;
}): Promise<CursorPage<RefundDTO>> {
  const rows = await Refund.find({
    ...(q.status ? { status: q.status as never } : {}),
    ...(q.orderId ? { orderId: new Types.ObjectId(q.orderId) } : {}),
    ...beforeCursor(q.cursor),
  })
    .sort({ createdAt: -1, _id: -1 })
    .limit(q.limit + 1);
  return pageOf(rows, q.limit, createdKey, refundDTO);
}

export async function getRefund(id: Types.ObjectId): Promise<RefundDTO> {
  const r = await Refund.findById(id);
  if (!r) throw notFound('Refund not found');
  return refundDTO(r);
}

/**
 * Approve = a person with `payments.refund` decides the money goes back. Sensitive, so:
 *  - the caller must type the refund number (guards against clicking the wrong row),
 *  - nobody can approve a refund on an order they are a party to.
 */
export async function approveRefund(
  actor: Actor,
  id: Types.ObjectId,
  confirmation: string,
  deps: FinanceDeps,
): Promise<RefundDTO> {
  const refund = await Refund.findById(id);
  if (!refund) throw notFound('Refund not found');
  if (confirmation !== refund.refundNo)
    throw err(400, 'CONFIRMATION_MISMATCH', `Type ${refund.refundNo} to confirm this refund`);
  if (refund.status !== 'requested')
    throw err(409, 'INVALID_STATE', `This refund is already ${refund.status}`);
  const order = refund.orderId ? await Order.findById(refund.orderId) : null;
  if (
    actor.userId === String(refund.buyerId) ||
    (order &&
      (actor.userId === String(order.sellerId) || (await isSellerSide(actor.userId, order.farmId))))
  )
    throw err(403, 'SELF_APPROVAL', 'You cannot approve a refund on your own order');
  const approved = await moveRefund(refund, 'approved', {
    approvedAt: new Date(),
    approvedBy: new Types.ObjectId(actor.userId),
  });
  if (!approved) throw err(409, 'INVALID_STATE', 'This refund was just handled by someone else');
  await recordFinancial({
    actor: userActor(actor.userId),
    action: 'refund.approved',
    targetType: 'refund',
    targetId: refund._id,
    amountMinor: refund.amountMinor,
    data: { refundNo: refund.refundNo },
  });
  return refundDTO(await submitRefund(approved, deps, userActor(actor.userId)));
}

/** Failed or interrupted submissions are retried by a person; the provider call is idempotent so a retry cannot refund twice. */
export async function retryRefund(
  actor: Actor,
  id: Types.ObjectId,
  deps: FinanceDeps,
): Promise<RefundDTO> {
  const refund = await Refund.findById(id);
  if (!refund) throw notFound('Refund not found');
  const retryable =
    refund.status === 'failed' ||
    refund.status === 'approved' ||
    (refund.status === 'processing' && !refund.providerRef);
  if (!retryable) throw err(409, 'INVALID_STATE', `A ${refund.status} refund cannot be retried`);
  await recordFinancial({
    actor: userActor(actor.userId),
    action: 'refund.retry',
    targetType: 'refund',
    targetId: refund._id,
    data: { refundNo: refund.refundNo },
  });
  return refundDTO(await submitRefund(refund, deps, userActor(actor.userId)));
}

export async function submitRefund(
  refund: RefundDoc,
  deps: FinanceDeps,
  actor = SYSTEM,
): Promise<RefundDoc> {
  if (!deps.provider)
    throw err(503, 'PAYMENTS_UNAVAILABLE', 'Online payment is not available right now');
  const payment = await Payment.findById(refund.paymentId);
  if (!payment?.providerRef)
    throw err(409, 'PAYMENT_NOT_REFUNDABLE', 'The original payment has no provider reference');

  let current = refund;
  if (refund.status === 'approved' || refund.status === 'failed') {
    const next = await moveRefund(
      refund,
      'processing',
      // a new attempt is a new provider refund: forget the old reference
      { failureCode: null, providerRef: null, provider: deps.provider.name },
      { attempts: 1 },
    );
    if (!next) throw err(409, 'INVALID_STATE', 'This refund was just handled by someone else');
    current = next;
  }
  try {
    const result = await deps.provider.createRefund({
      // A new attempt after a provider-side failure gets a new key; re-sending an interrupted attempt keeps its key.
      idempotencyKey: `refund:${refund._id}:${current.attempts}`,
      chargeRef: payment.providerRef,
      amountMinor: current.amountMinor,
    });
    await Refund.updateOne(
      { _id: current._id, providerRef: null },
      { $set: { providerRef: result.ref, provider: deps.provider.name } },
    );
    await recordFinancial({
      actor,
      action: 'refund.submitted',
      targetType: 'refund',
      targetId: current._id,
      amountMinor: current.amountMinor,
      data: { refundNo: current.refundNo, providerStatus: result.status },
    });
    if (result.status === 'succeeded') return completeRefund(current._id, PROVIDER);
    if (result.status === 'failed')
      return failRefund(current._id, result.failureCode ?? 'provider_failed');
  } catch (error) {
    if (!(error instanceof PaymentProviderError)) throw error;
    throw err(
      502,
      'PROVIDER_UNAVAILABLE',
      'The payment provider did not respond. Retry the refund.',
    );
  }
  return (await Refund.findById(current._id))!;
}

/**
 * Refund confirmed by the provider: payment → refunded, ledger reversal posted, order → REFUNDED. Every step is a
 * compare-and-set or an idempotent journal, so a redelivered callback only completes what is still missing.
 */
export async function completeRefund(id: Types.ObjectId, actor = PROVIDER): Promise<RefundDoc> {
  let refund = (await Refund.findById(id))!;
  if (refund.status === 'processing') {
    // Only the caller whose compare-and-set moved the refund records it (parallel callbacks are booked once).
    const moved = await moveRefund(refund, 'succeeded', {
      completedAt: new Date(),
      failureCode: null,
    });
    refund = moved ?? (await Refund.findById(id))!;
    if (moved)
      await recordFinancial({
        actor,
        action: 'refund.succeeded',
        targetType: 'refund',
        targetId: refund._id,
        amountMinor: refund.amountMinor,
        data: { refundNo: refund.refundNo },
      });
  }
  if (refund.status !== 'succeeded') return refund;
  const payment = (await Payment.findById(refund.paymentId))!;
  if (payment.status === 'succeeded')
    await Payment.updateOne(
      { _id: payment._id, status: 'succeeded' },
      {
        $set: { status: 'refunded' },
        $push: {
          events: { at: new Date(), status: 'refunded', source: 'system', note: refund.refundNo },
        },
      },
    );
  const order = refund.orderId ? await Order.findById(refund.orderId) : null;
  await postRefund(refund, payment, order, actor);
  if (order?.status === 'REFUND_PENDING')
    await markOrderRefunded(order._id, refund.providerRef ?? refund.refundNo);
  return refund;
}

export async function failRefund(id: Types.ObjectId, failureCode: string): Promise<RefundDoc> {
  const refund = (await Refund.findById(id))!;
  if (refund.status !== 'processing') return refund;
  const moved = await moveRefund(refund, 'failed', { failureCode });
  if (!moved) return (await Refund.findById(id))!;
  const next = moved;
  await recordFinancial({
    actor: PROVIDER,
    action: 'refund.failed',
    targetType: 'refund',
    targetId: refund._id,
    amountMinor: refund.amountMinor,
    data: { refundNo: refund.refundNo, failureCode },
  });
  return next;
}

export type RefundEventResult =
  | 'succeeded'
  | 'failed'
  | 'duplicate'
  | 'unknown_reference'
  | 'amount_mismatch'
  | 'currency_mismatch'
  | 'stale';

export async function applyRefundEvent(
  event: {
    id: string;
    type: 'refund.succeeded' | 'refund.failed';
    ref: string;
    amountMinor: number;
    currency: string;
    failureCode?: string | undefined;
  },
  providerName: string,
): Promise<RefundEventResult> {
  const refund = await Refund.findOne(byProviderRef(providerName, event.ref));
  if (!refund) {
    await recordFinancial({
      actor: PROVIDER,
      action: 'provider_event.unknown_reference',
      targetType: 'refund',
      targetId: event.ref,
      amountMinor: event.amountMinor,
      data: { type: event.type, eventId: event.id },
    });
    return 'unknown_reference';
  }
  if (event.type === 'refund.succeeded') {
    // The same number in another currency is not the same money: never complete a refund on it.
    if (event.currency !== refund.currency) {
      await recordFinancial({
        actor: PROVIDER,
        action: 'refund.currency_mismatch',
        targetType: 'refund',
        targetId: refund._id,
        amountMinor: event.amountMinor,
        data: { expected: refund.currency, received: event.currency, eventId: event.id },
      });
      return 'currency_mismatch';
    }
    if (event.amountMinor !== refund.amountMinor) {
      await recordFinancial({
        actor: PROVIDER,
        action: 'refund.amount_mismatch',
        targetType: 'refund',
        targetId: refund._id,
        amountMinor: event.amountMinor,
        data: { expectedMinor: refund.amountMinor, eventId: event.id },
      });
      return 'amount_mismatch';
    }
    if (refund.status === 'succeeded') {
      await completeRefund(refund._id);
      return 'duplicate';
    }
    if (refund.status !== 'processing') return 'stale';
    await completeRefund(refund._id);
    return 'succeeded';
  }
  if (refund.status === 'failed') return 'duplicate';
  if (refund.status !== 'processing') return 'stale';
  await failRefund(refund._id, event.failureCode ?? 'provider_failed');
  return 'failed';
}
