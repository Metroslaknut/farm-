import { Schema, model, type HydratedDocument, type Types } from 'mongoose';
import {
  CURRENCIES,
  FULFILLMENT_METHODS,
  ORDER_STATUSES,
  TRANSPORT_REQUIREMENTS,
  type Currency,
  type FeeSnapshot,
  type FulfillmentMethod,
  type ListingAnimalSnapshot,
  type OrderActor,
  type OrderStatus,
  type TransportRequirement,
} from '@farmplus/shared-types';

export interface OrderItemAttrs {
  type: 'animal';
  listingId: Types.ObjectId;
  animalId: Types.ObjectId;
  title: string;
  photoUrl?: string | null;
  animal: ListingAnimalSnapshot;
  quantity: number;
  unitPriceMinor: number;
  totalMinor: number;
}

export interface OrderHistoryAttrs {
  at: Date;
  from?: OrderStatus | null;
  to: OrderStatus;
  by: OrderActor;
  actorId?: Types.ObjectId | null;
  reason?: string | null;
}

export interface OrderAttrs {
  _id: Types.ObjectId;
  orderNo: string;
  buyerId: Types.ObjectId;
  sellerId: Types.ObjectId;
  farmId: Types.ObjectId;
  farmName: string;
  /** `animal`: from an accepted marketplace deal; `product`: from the shop cart (no listing or negotiation). */
  kind: 'animal' | 'product';
  listingId?: Types.ObjectId | null;
  negotiationId?: Types.ObjectId | null;
  /** Frozen at checkout. Later listing edits never change an existing order. */
  items: OrderItemAttrs[];
  currency: Currency;
  itemsMinor: number;
  shippingMinor: number;
  platformFeeMinor: number;
  /** Immutable record of how the fee was decided (rule, rates, bounds, calculation). */
  feeSnapshot?: FeeSnapshot | null;
  grandTotalMinor: number;
  sellerPayoutMinor: number;
  fulfillment: FulfillmentMethod;
  /** Region only (needed for quotes and routing). The street address is encrypted in `addressEnc`. */
  destination?: { province: string; district?: string | null; postalCode?: string | null } | null;
  addressEnc?: string | null;
  shippingSnapshot?: {
    quoteId?: Types.ObjectId | null;
    optionId: string;
    label: string;
    source: string;
    isEstimate: boolean;
    estimatedDays?: { min: number; max: number } | null;
    requirements: TransportRequirement[];
  } | null;
  transportAcknowledgedAt?: Date | null;
  status: OrderStatus;
  paymentDueAt?: Date | null;
  paidAt?: Date | null;
  paymentRef?: string | null;
  deliveredAt?: Date | null;
  /** Carrier said delivered; the buyer has until then to confirm or the order completes by itself. */
  autoConfirmAt?: Date | null;
  cancelReason?: string | null;
  refund?: {
    requestedAt: Date;
    amountMinor: number;
    reason: string;
    completedAt?: Date | null;
    ref?: string | null;
  } | null;
  /** Incremented whenever the total changes (re-quote): payment callbacks must match the current total. */
  totalVersion: number;
  history: OrderHistoryAttrs[];
  createdAt: Date;
  updatedAt: Date;
}

const schema = new Schema<OrderAttrs>(
  {
    orderNo: { type: String, required: true },
    buyerId: { type: Schema.Types.ObjectId, required: true, ref: 'User' },
    sellerId: { type: Schema.Types.ObjectId, required: true, ref: 'User' },
    farmId: { type: Schema.Types.ObjectId, required: true, ref: 'Farm' },
    farmName: { type: String, required: true },
    kind: { type: String, enum: ['animal', 'product'], default: 'animal' },
    listingId: { type: Schema.Types.ObjectId, default: null, ref: 'Listing' },
    negotiationId: { type: Schema.Types.ObjectId, default: null, ref: 'Negotiation' },
    items: { type: Schema.Types.Mixed, default: [] },
    currency: { type: String, enum: CURRENCIES, default: 'THB' },
    itemsMinor: { type: Number, required: true, min: 1 },
    shippingMinor: { type: Number, required: true, min: 0 },
    platformFeeMinor: { type: Number, required: true, min: 0 },
    feeSnapshot: { type: Schema.Types.Mixed, default: null },
    grandTotalMinor: { type: Number, required: true, min: 1 },
    sellerPayoutMinor: { type: Number, required: true, min: 0 },
    fulfillment: { type: String, enum: FULFILLMENT_METHODS, required: true },
    destination: {
      type: {
        province: String,
        district: { type: String, default: null },
        postalCode: { type: String, default: null },
        _id: false,
      },
      default: null,
    },
    addressEnc: { type: String, default: null },
    shippingSnapshot: {
      type: {
        quoteId: Schema.Types.ObjectId,
        optionId: String,
        label: String,
        source: String,
        isEstimate: Boolean,
        estimatedDays: { type: { min: Number, max: Number, _id: false }, default: null },
        requirements: [{ type: String, enum: TRANSPORT_REQUIREMENTS }],
        _id: false,
      },
      default: null,
    },
    transportAcknowledgedAt: { type: Date, default: null },
    status: { type: String, enum: ORDER_STATUSES, default: 'PENDING_PAYMENT' },
    paymentDueAt: { type: Date, default: null },
    paidAt: { type: Date, default: null },
    paymentRef: { type: String, default: null },
    deliveredAt: { type: Date, default: null },
    autoConfirmAt: { type: Date, default: null },
    cancelReason: { type: String, default: null },
    refund: {
      type: {
        requestedAt: Date,
        amountMinor: Number,
        reason: String,
        completedAt: { type: Date, default: null },
        ref: { type: String, default: null },
        _id: false,
      },
      default: null,
    },
    totalVersion: { type: Number, default: 1 },
    history: {
      type: [
        {
          at: { type: Date, default: Date.now },
          from: { type: String, enum: [...ORDER_STATUSES, null], default: null },
          to: { type: String, enum: ORDER_STATUSES, required: true },
          by: {
            type: String,
            enum: ['buyer', 'seller', 'payment', 'shipping', 'system'],
            required: true,
          },
          actorId: { type: Schema.Types.ObjectId, default: null },
          reason: { type: String, default: null },
          _id: false,
        },
      ],
      default: [],
    },
  },
  { timestamps: true, collection: 'orders' },
);

schema.index({ orderNo: 1 }, { unique: true });
// One order per accepted deal: checkout can never double-charge or double-reserve.
schema.index(
  { negotiationId: 1 },
  { unique: true, partialFilterExpression: { negotiationId: { $type: 'objectId' } } },
);
schema.index(
  { paymentRef: 1 },
  { unique: true, partialFilterExpression: { paymentRef: { $type: 'string' } } },
);
schema.index({ buyerId: 1, createdAt: -1, _id: -1 });
schema.index({ farmId: 1, status: 1, createdAt: -1, _id: -1 });
// The seller's order list without a status filter (the index above only serves it when a status is given).
schema.index({ farmId: 1, createdAt: -1, _id: -1 });
schema.index({ status: 1, paymentDueAt: 1 });
schema.index({ status: 1, autoConfirmAt: 1 });
// Analytics: sales are counted by the day payment was confirmed, per farm and platform-wide.
schema.index({ farmId: 1, paidAt: 1 });
schema.index({ paidAt: 1 });
schema.index({ farmId: 1, createdAt: 1 });
schema.index({ createdAt: 1 });

export type OrderDoc = HydratedDocument<OrderAttrs>;
export const Order = model<OrderAttrs>('Order', schema);
