import { Schema, model, type HydratedDocument, type Types } from 'mongoose';
import {
  CURRENCIES,
  REFUND_STATUSES,
  type Currency,
  type RefundStatus,
} from '@farmplus/shared-types';

export interface RefundAttrs {
  _id: Types.ObjectId;
  refundNo: string;
  paymentId: Types.ObjectId;
  orderId?: Types.ObjectId | null;
  orderNo?: string | null;
  buyerId: Types.ObjectId;
  amountMinor: number;
  currency: Currency;
  reason: string;
  status: RefundStatus;
  requestedAt: Date;
  approvedAt?: Date | null;
  approvedBy?: Types.ObjectId | null;
  completedAt?: Date | null;
  provider?: string | null;
  providerRef?: string | null;
  failureCode?: string | null;
  attempts: number;
  createdAt: Date;
  updatedAt: Date;
}

const schema = new Schema<RefundAttrs>(
  {
    refundNo: { type: String, required: true },
    paymentId: { type: Schema.Types.ObjectId, required: true, ref: 'Payment' },
    orderId: { type: Schema.Types.ObjectId, default: null, ref: 'Order' },
    orderNo: { type: String, default: null },
    buyerId: { type: Schema.Types.ObjectId, required: true, ref: 'User' },
    amountMinor: { type: Number, required: true, min: 1 },
    currency: { type: String, enum: CURRENCIES, default: 'THB' },
    reason: { type: String, required: true },
    status: { type: String, enum: REFUND_STATUSES, default: 'requested' },
    requestedAt: { type: Date, default: Date.now },
    approvedAt: { type: Date, default: null },
    approvedBy: { type: Schema.Types.ObjectId, default: null },
    completedAt: { type: Date, default: null },
    provider: { type: String, default: null },
    providerRef: { type: String, default: null },
    failureCode: { type: String, default: null },
    attempts: { type: Number, default: 0 },
  },
  { timestamps: true, collection: 'refunds' },
);

schema.index({ refundNo: 1 }, { unique: true });
// A payment can be refunded once, in full: duplicate requests (retries, redelivered events) collapse into one refund.
schema.index({ paymentId: 1 }, { unique: true });
schema.index(
  { provider: 1, providerRef: 1 },
  { unique: true, partialFilterExpression: { providerRef: { $type: 'string' } } },
);
schema.index({ status: 1, requestedAt: -1, _id: -1 });
schema.index({ orderId: 1 });
schema.index({ requestedAt: 1 }); // analytics
schema.index({ status: 1, completedAt: 1 });

export type RefundDoc = HydratedDocument<RefundAttrs>;
export const Refund = model<RefundAttrs>('Refund', schema);
