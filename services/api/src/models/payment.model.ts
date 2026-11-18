import { Schema, model, type HydratedDocument, type Types } from 'mongoose';
import {
  CURRENCIES,
  PAYMENT_DISPOSITIONS,
  PAYMENT_STATUSES,
  type Currency,
  type PaymentDisposition,
  type PaymentStatus,
} from '@farmplus/shared-types';

export interface PaymentAttrs {
  _id: Types.ObjectId;
  orderId: Types.ObjectId;
  orderNo: string;
  buyerId: Types.ObjectId;
  /** Frozen: what the buyer was asked to pay. Callbacks must match this exactly. */
  amountMinor: number;
  /** What the provider says it captured (normally equal to `amountMinor`; a difference is parked and refunded). */
  receivedMinor?: number | null;
  currency: Currency;
  orderTotalVersion: number;
  status: PaymentStatus;
  disposition?: PaymentDisposition | null;
  unappliedReason?: string | null;
  provider: string;
  providerRef?: string | null;
  checkoutUrl?: string | null;
  /** Client-supplied `Idempotency-Key`: replays return this same payment instead of starting another. */
  idempotencyKey: string;
  failureCode?: string | null;
  expiresAt?: Date | null;
  succeededAt?: Date | null;
  lastEventId?: string | null;
  events: {
    at: Date;
    status: PaymentStatus;
    source: 'buyer' | 'provider' | 'system';
    note?: string | null;
  }[];
  createdAt: Date;
  updatedAt: Date;
}

const schema = new Schema<PaymentAttrs>(
  {
    orderId: { type: Schema.Types.ObjectId, required: true, ref: 'Order' },
    orderNo: { type: String, required: true },
    buyerId: { type: Schema.Types.ObjectId, required: true, ref: 'User' },
    amountMinor: { type: Number, required: true, min: 1 },
    receivedMinor: { type: Number, default: null },
    currency: { type: String, enum: CURRENCIES, default: 'THB' },
    orderTotalVersion: { type: Number, required: true },
    status: { type: String, enum: PAYMENT_STATUSES, default: 'pending' },
    disposition: { type: String, enum: [...PAYMENT_DISPOSITIONS, null], default: null },
    unappliedReason: { type: String, default: null },
    provider: { type: String, required: true },
    providerRef: { type: String, default: null },
    checkoutUrl: { type: String, default: null },
    idempotencyKey: { type: String, required: true },
    failureCode: { type: String, default: null },
    expiresAt: { type: Date, default: null },
    succeededAt: { type: Date, default: null },
    lastEventId: { type: String, default: null },
    events: {
      type: [
        {
          at: { type: Date, default: Date.now },
          status: { type: String, enum: PAYMENT_STATUSES, required: true },
          source: { type: String, enum: ['buyer', 'provider', 'system'], required: true },
          note: { type: String, default: null },
          _id: false,
        },
      ],
      default: [],
    },
  },
  { timestamps: true, collection: 'payments' },
);

// Replaying the same request never starts a second payment.
schema.index({ orderId: 1, idempotencyKey: 1 }, { unique: true });
// At most ONE open attempt per order: no two charges can be in flight at once.
schema.index(
  { orderId: 1 },
  {
    unique: true,
    name: 'one_open_attempt_per_order',
    partialFilterExpression: { status: 'pending' },
  },
);
// At most ONE payment is ever applied to an order: a second capture is refunded instead.
schema.index(
  { orderId: 1 },
  {
    unique: true,
    name: 'one_applied_payment_per_order',
    partialFilterExpression: { disposition: 'applied' },
  },
);
schema.index(
  { provider: 1, providerRef: 1 },
  { unique: true, partialFilterExpression: { providerRef: { $type: 'string' } } },
);
schema.index({ status: 1, expiresAt: 1 });
schema.index({ buyerId: 1, createdAt: -1 });
schema.index({ createdAt: 1 }); // analytics: payments by date
schema.index({ status: 1, createdAt: -1, _id: -1 });

export type PaymentDoc = HydratedDocument<PaymentAttrs>;
export const Payment = model<PaymentAttrs>('Payment', schema);
