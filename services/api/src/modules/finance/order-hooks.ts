import type { Types } from 'mongoose';
import { Payment, Refund, type OrderDoc } from '../../models';
import { isDuplicateKey } from '../community/shared';
import { SYSTEM, recordFinancial } from './audit';
import { postRelease } from './ledger';
import { newRefundNo } from './refunds.numbers';

/**
 * Called by the orders module at the moments money has to follow an order's state. They are deliberately small and
 * idempotent: if one fails, `reconcile` finds the missing piece and `repair` finishes it.
 */

/** Order moved to REFUND_PENDING: queue a refund of what was actually received. Never creates a second refund for a payment. */
export async function openRefundForOrder(
  order: Pick<OrderDoc, '_id' | 'orderNo' | 'buyerId' | 'refund' | 'cancelReason'>,
) {
  const payment = await Payment.findOne({ orderId: order._id, disposition: 'applied' });
  if (!payment) return null;
  const reason = order.refund?.reason ?? order.cancelReason ?? 'order_refund';
  try {
    const refund = await Refund.create({
      refundNo: newRefundNo(),
      paymentId: payment._id,
      orderId: order._id,
      orderNo: order.orderNo,
      buyerId: order.buyerId,
      amountMinor: payment.receivedMinor ?? payment.amountMinor,
      currency: payment.currency,
      reason,
      status: 'requested',
    });
    await recordFinancial({
      actor: SYSTEM,
      action: 'refund.requested',
      targetType: 'refund',
      targetId: refund._id,
      amountMinor: refund.amountMinor,
      data: { refundNo: refund.refundNo, orderNo: order.orderNo, reason },
    });
    return refund;
  } catch (error) {
    if (isDuplicateKey(error)) return Refund.findOne({ paymentId: payment._id });
    throw error;
  }
}

/** Order delivered: the seller's earnings become withdrawable. */
export async function releaseSellerFunds(
  order: Pick<OrderDoc, '_id' | 'sellerId' | 'sellerPayoutMinor'>,
): Promise<void> {
  await postRelease(order);
}

/** The order can no longer be paid (cancelled, expired, re-quoted): any open attempt is abandoned. */
export async function abandonOpenPayments(orderId: Types.ObjectId, note: string): Promise<void> {
  await Payment.updateMany(
    { orderId, status: 'pending' },
    {
      $set: { status: 'cancelled' },
      $push: { events: { at: new Date(), status: 'cancelled', source: 'system', note } },
    },
  );
}
