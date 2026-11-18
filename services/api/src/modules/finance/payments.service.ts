import { Types } from 'mongoose';
import { byProviderRef } from './provider-ref';
import { PAYMENT_TRANSITIONS, type PaymentDTO, type PaymentStatus } from '@farmplus/shared-types';
import type { Actor } from '../../context';
import { notFound } from '../../lib/errors';
import { Order, Payment, Refund, type PaymentDoc } from '../../models';
import { isDuplicateKey } from '../community/shared';
import { markOrderPaid } from '../orders/orders.service';
import { getNumberSetting } from '../settings/settings.service';
import { PROVIDER, SYSTEM, recordFinancial, userActor, type FinancialActor } from './audit';
import { postCapture, postUnapplied } from './ledger';
import { openRefundForOrder } from './order-hooks';
import { newRefundNo } from './refunds.numbers';
import { PaymentProviderError, type PaymentProvider } from './provider';
import { beforeCursor, createdKey, err, pageOf } from './shared';

export interface FinanceDeps {
  provider: PaymentProvider | null;
  masterKey: Buffer;
}

const MINUTE = 60_000;

export const paymentDTO = (p: PaymentDoc, provider: PaymentProvider | null): PaymentDTO => ({
  id: String(p._id),
  orderId: String(p.orderId),
  orderNo: p.orderNo,
  amountMinor: p.amountMinor,
  currency: p.currency,
  status: p.status,
  disposition: p.disposition ?? null,
  unappliedReason: p.unappliedReason ?? null,
  provider: p.provider,
  providerRef: p.providerRef ?? null,
  checkoutUrl: p.checkoutUrl ?? null,
  failureCode: p.failureCode ?? null,
  expiresAt: p.expiresAt?.toISOString() ?? null,
  createdAt: p.createdAt.toISOString(),
  succeededAt: p.succeededAt?.toISOString() ?? null,
  mock: Boolean(provider?.isMock),
});

const requireProvider = (deps: FinanceDeps): PaymentProvider => {
  if (!deps.provider)
    throw err(503, 'PAYMENTS_UNAVAILABLE', 'Online payment is not available right now');
  return deps.provider;
};

/** The ONE place a payment's status changes: a compare-and-set along PAYMENT_TRANSITIONS. */
export async function movePayment(
  payment: PaymentDoc,
  to: PaymentStatus,
  source: 'buyer' | 'provider' | 'system',
  set: Record<string, unknown> = {},
  note?: string,
): Promise<PaymentDoc | null> {
  if (!PAYMENT_TRANSITIONS[payment.status].includes(to))
    throw err(409, 'INVALID_TRANSITION', `A payment cannot move from ${payment.status} to ${to}`);
  return Payment.findOneAndUpdate(
    { _id: payment._id, status: payment.status },
    {
      $set: { status: to, ...set },
      $push: { events: { at: new Date(), status: to, source, note: note ?? null } },
    },
    { returnDocument: 'after' },
  );
}

// ---------------------------------------------------------------------------
// Buyer: start (or resume) a payment
// ---------------------------------------------------------------------------
export async function createPayment(
  actor: Actor,
  orderId: Types.ObjectId,
  idempotencyKey: string,
  deps: FinanceDeps,
): Promise<{ payment: PaymentDTO; replayed: boolean }> {
  const provider = requireProvider(deps);
  const order = await Order.findById(orderId);
  if (!order || String(order.buyerId) !== actor.userId) throw notFound('Order not found');

  // Same key = same attempt. If the first call died before the provider answered, this resumes it.
  let payment = await Payment.findOne({ orderId, idempotencyKey });
  let replayed = Boolean(payment);

  if (!payment) {
    if (order.status !== 'PENDING_PAYMENT')
      throw err(409, 'ORDER_NOT_PAYABLE', 'This order is not waiting for payment');
    if (order.paymentDueAt && order.paymentDueAt <= new Date())
      throw err(409, 'PAYMENT_WINDOW_CLOSED', 'The payment window for this order has closed');
    const open = await Payment.findOne({ orderId, status: 'pending' });
    if (open && open.idempotencyKey === idempotencyKey) {
      payment = open; // a parallel request with the same key got there first: that IS this attempt
      replayed = true;
    } else if (open) {
      if (open.expiresAt && open.expiresAt <= new Date()) {
        await movePayment(open, 'expired', 'system', {}, 'attempt_window_elapsed');
        if (open.providerRef) await provider.cancelCharge(open.providerRef).catch(() => undefined);
      } else {
        throw err(409, 'PAYMENT_IN_PROGRESS', 'A payment for this order is already in progress');
      }
    }
    if (!payment) {
      const minutes = await getNumberSetting('finance.paymentAttemptMinutes', 5, 1440);
      const expires = new Date(Date.now() + minutes * MINUTE);
      try {
        payment = await Payment.create({
          orderId: order._id,
          orderNo: order.orderNo,
          buyerId: order.buyerId,
          amountMinor: order.grandTotalMinor,
          currency: order.currency,
          orderTotalVersion: order.totalVersion,
          provider: provider.name,
          idempotencyKey,
          expiresAt:
            order.paymentDueAt && order.paymentDueAt < expires ? order.paymentDueAt : expires,
          events: [{ at: new Date(), status: 'pending', source: 'buyer', note: 'created' }],
        });
        await recordFinancial({
          actor: userActor(actor.userId),
          action: 'payment.created',
          targetType: 'payment',
          targetId: payment._id,
          amountMinor: payment.amountMinor,
          data: { orderNo: order.orderNo },
        });
      } catch (error) {
        if (!isDuplicateKey(error)) throw error;
        const raced = await Payment.findOne({ orderId, idempotencyKey });
        if (!raced)
          throw err(409, 'PAYMENT_IN_PROGRESS', 'A payment for this order is already in progress');
        payment = raced;
        replayed = true;
      }
    }
  }

  if (payment.status === 'pending' && !payment.providerRef) {
    try {
      const charge = await provider.createCharge({
        idempotencyKey: `pay:${payment._id}`,
        amountMinor: payment.amountMinor,
        currency: payment.currency,
        reference: payment.orderNo,
      });
      payment =
        (await Payment.findOneAndUpdate(
          { _id: payment._id, providerRef: null },
          { $set: { providerRef: charge.ref, checkoutUrl: charge.checkoutUrl } },
          { returnDocument: 'after' },
        )) ?? (await Payment.findById(payment._id))!;
    } catch (error) {
      if (!(error instanceof PaymentProviderError)) throw error;
      // The attempt stays open: the buyer retries with the same key and it resumes (the provider call is idempotent).
      throw err(
        502,
        'PROVIDER_UNAVAILABLE',
        'The payment provider did not respond. Please try again.',
      );
    }
  }
  return { payment: paymentDTO(payment, provider), replayed };
}

export async function listMyPayments(actor: Actor, orderId: Types.ObjectId, deps: FinanceDeps) {
  const order = await Order.findById(orderId);
  if (!order || String(order.buyerId) !== actor.userId) throw notFound('Order not found');
  const rows = await Payment.find({ orderId }).sort({ createdAt: -1 });
  return rows.map((p) => paymentDTO(p, deps.provider));
}

// ---------------------------------------------------------------------------
// Provider events (all verified upstream by the webhook signature)
// ---------------------------------------------------------------------------
/**
 * A captured payment is applied to its order, or — if the order can no longer take it — parked in suspense and queued
 * for refund. Safe to run any number of times: every step is a compare-and-set or an idempotent journal.
 */
export async function finalizePayment(
  paymentId: Types.ObjectId,
  actor: FinancialActor = SYSTEM,
): Promise<'applied' | 'unapplied' | 'skipped'> {
  const payment = await Payment.findById(paymentId);
  if (!payment || payment.status === 'pending' || payment.status === 'failed') return 'skipped';
  const order = await Order.findById(payment.orderId);
  const received = payment.receivedMinor ?? payment.amountMinor;

  let reason: string | null = null;
  if (!order) reason = 'order_missing';
  else if (received !== payment.amountMinor || order.grandTotalMinor !== payment.amountMinor)
    reason = 'amount_mismatch';
  else if (order.totalVersion !== payment.orderTotalVersion) reason = 'order_changed';

  if (order && !reason) {
    const ours = order.paymentRef === payment.providerRef && order.status !== 'PENDING_PAYMENT';
    if (!ours && order.status !== 'PENDING_PAYMENT') reason = 'order_not_payable';
  }

  if (order && !reason) {
    const applied = await markOrderPaid(
      order._id,
      payment.providerRef ?? String(payment._id),
      payment.orderTotalVersion,
    );
    if (!applied) reason = 'order_not_payable';
  }

  if (order && !reason) {
    await postCapture(order, payment, actor);
    const done = await Payment.updateOne(
      { _id: payment._id, disposition: null },
      { $set: { disposition: 'applied' } },
    ).catch((error: unknown) => {
      if (isDuplicateKey(error)) return null; // another payment already holds "applied" for this order
      throw error;
    });
    if (done === null) {
      // Unreachable in practice (the order's paymentRef already admits only one payment); kept as a tripwire.
      await recordFinancial({
        actor,
        action: 'payment.apply_conflict',
        targetType: 'payment',
        targetId: payment._id,
        data: { orderNo: payment.orderNo },
      });
      return 'skipped';
    }
    if (done.modifiedCount === 1)
      await recordFinancial({
        actor,
        action: 'payment.applied',
        targetType: 'payment',
        targetId: payment._id,
        amountMinor: received,
        data: { orderNo: payment.orderNo },
      });
    // An order cancelled (or returned) before the payment was marked applied could not queue its refund then.
    const current = await Order.findById(order._id);
    if (current?.status === 'REFUND_PENDING') await openRefundForOrder(current);
    return 'applied';
  }
  return parkUnapplied(payment, reason ?? 'order_missing', actor);
}

async function parkUnapplied(payment: PaymentDoc, reason: string, actor: FinancialActor) {
  if (payment.disposition === 'applied') return 'applied' as const;
  const parked = {
    ...payment.toObject(),
    amountMinor: payment.receivedMinor ?? payment.amountMinor,
  };
  // Nothing was received (a zero capture): there is no money to park or refund, only the mismatch to record.
  if (parked.amountMinor > 0) await postUnapplied(parked, actor);
  const res = await Payment.updateOne(
    { _id: payment._id, disposition: null },
    { $set: { disposition: 'unapplied', unappliedReason: reason } },
  );
  if (res.modifiedCount === 1) {
    await recordFinancial({
      actor,
      action: 'payment.unapplied',
      targetType: 'payment',
      targetId: payment._id,
      amountMinor: parked.amountMinor,
      data: { orderNo: payment.orderNo, reason },
    });
    // Queue the money to go back to the buyer (a finance admin still approves it).
    if (parked.amountMinor > 0)
      try {
        const refund = await Refund.create({
          refundNo: newRefundNo(),
          paymentId: payment._id,
          orderId: payment.orderId,
          orderNo: payment.orderNo,
          buyerId: payment.buyerId,
          amountMinor: parked.amountMinor,
          currency: payment.currency,
          reason: `unapplied_${reason}`,
          status: 'requested',
        });
        await recordFinancial({
          actor: SYSTEM,
          action: 'refund.requested',
          targetType: 'refund',
          targetId: refund._id,
          amountMinor: refund.amountMinor,
          data: { refundNo: refund.refundNo, reason: refund.reason },
        });
      } catch (error) {
        if (!isDuplicateKey(error)) throw error;
      }
  }
  return 'unapplied' as const;
}

export type ProviderEventResult =
  | 'succeeded'
  | 'failed'
  | 'duplicate'
  | 'stale'
  | 'unknown_reference'
  | 'unapplied'
  | 'currency_mismatch';

export async function applyChargeEvent(
  event: {
    id: string;
    type: 'charge.succeeded' | 'charge.failed';
    ref: string;
    amountMinor: number;
    currency: string;
    failureCode?: string | undefined;
  },
  providerName: string,
): Promise<ProviderEventResult> {
  const payment = await Payment.findOne(byProviderRef(providerName, event.ref));
  if (!payment) {
    await recordFinancial({
      actor: PROVIDER,
      action: 'provider_event.unknown_reference',
      targetType: 'charge',
      targetId: event.ref,
      amountMinor: event.amountMinor,
      data: { type: event.type, eventId: event.id },
    });
    return 'unknown_reference';
  }

  if (event.type === 'charge.failed') {
    if (payment.status !== 'pending') return payment.status === 'failed' ? 'duplicate' : 'stale';
    const next = await movePayment(payment, 'failed', 'provider', {
      failureCode: event.failureCode ?? 'declined',
      lastEventId: event.id,
    });
    if (!next) return 'stale';
    await recordFinancial({
      actor: PROVIDER,
      action: 'payment.failed',
      targetType: 'payment',
      targetId: payment._id,
      data: { failureCode: event.failureCode ?? 'declined', eventId: event.id },
    });
    return 'failed';
  }

  // charge.succeeded
  if (event.currency !== payment.currency) {
    // Foreign-currency money cannot be booked in a THB ledger: leave everything untouched, flag it for a person
    // (reconcile also shows the provider/internal difference).
    await recordFinancial({
      actor: PROVIDER,
      action: 'payment.currency_mismatch',
      targetType: 'payment',
      targetId: payment._id,
      amountMinor: event.amountMinor,
      data: { expected: payment.currency, received: event.currency, eventId: event.id },
    });
    return 'currency_mismatch';
  }
  if (payment.status === 'succeeded' || payment.status === 'refunded') {
    await finalizePayment(payment._id); // finishes any step a crash left undone; changes nothing otherwise
    return 'duplicate';
  }
  if (payment.status === 'failed') return 'stale'; // the provider told us it failed; a contradiction needs a human (reconcile reports it)
  const next = await movePayment(payment, 'succeeded', 'provider', {
    succeededAt: new Date(),
    receivedMinor: event.amountMinor,
    lastEventId: event.id,
  });
  if (!next) {
    await finalizePayment(payment._id);
    return 'duplicate';
  }
  await recordFinancial({
    actor: PROVIDER,
    action: 'payment.succeeded',
    targetType: 'payment',
    targetId: payment._id,
    amountMinor: event.amountMinor,
    data: { orderNo: payment.orderNo, eventId: event.id, late: payment.status !== 'pending' },
  });
  return (await finalizePayment(payment._id, PROVIDER)) === 'unapplied' ? 'unapplied' : 'succeeded';
}

// ---------------------------------------------------------------------------
// Housekeeping
// ---------------------------------------------------------------------------
export async function expireStalePayments(
  provider: PaymentProvider | null,
  now = new Date(),
): Promise<number> {
  const stale = await Payment.find({ status: 'pending', expiresAt: { $lte: now } }).limit(200);
  let n = 0;
  for (const p of stale) {
    const next = await movePayment(p, 'expired', 'system', {}, 'attempt_window_elapsed').catch(
      () => null,
    );
    if (!next) continue;
    n++;
    if (p.providerRef && provider)
      await provider.cancelCharge(p.providerRef).catch(() => undefined);
  }
  return n;
}

// ---------------------------------------------------------------------------
// Finance admin: read side
// ---------------------------------------------------------------------------
export async function listPayments(
  q: {
    status?: string | undefined;
    orderId?: string | undefined;
    limit: number;
    cursor?: string | undefined;
  },
  deps: FinanceDeps,
) {
  const rows = await Payment.find({
    ...(q.status ? { status: q.status as never } : {}),
    ...(q.orderId ? { orderId: new Types.ObjectId(q.orderId) } : {}),
    ...beforeCursor(q.cursor),
  })
    .sort({ createdAt: -1, _id: -1 })
    .limit(q.limit + 1);
  return pageOf(rows, q.limit, createdKey, (p) => paymentDTO(p, deps.provider));
}

export async function getPayment(id: Types.ObjectId, deps: FinanceDeps): Promise<PaymentDTO> {
  const p = await Payment.findById(id);
  if (!p) throw notFound('Payment not found');
  return paymentDTO(p, deps.provider);
}
