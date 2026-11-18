import { Schema, model, type HydratedDocument, type Types } from 'mongoose';
import { SHIPMENT_STATUSES, type ShipmentStatus } from '@farmplus/shared-types';

export interface ShipmentEventAttrs {
  at: Date;
  status: ShipmentStatus;
  source: 'seller' | 'provider' | 'buyer' | 'system';
  note?: string | null;
  location?: string | null;
}

export interface ShipmentAttrs {
  _id: Types.ObjectId;
  orderId: Types.ObjectId;
  farmId: Types.ObjectId;
  buyerId: Types.ObjectId;
  sellerId: Types.ObjectId;
  /** 1 for the first shipment; every re-attempt after a failed delivery is a new row (attempt 2, 3, …). */
  attempt: number;
  status: ShipmentStatus;
  carrier: string;
  trackingNumber?: string | null;
  expectedDays?: { min: number; max: number } | null;
  shippedAt?: Date | null;
  deliveredAt?: Date | null;
  events: ShipmentEventAttrs[];
  createdAt: Date;
  updatedAt: Date;
}

const schema = new Schema<ShipmentAttrs>(
  {
    orderId: { type: Schema.Types.ObjectId, required: true, ref: 'Order' },
    farmId: { type: Schema.Types.ObjectId, required: true },
    buyerId: { type: Schema.Types.ObjectId, required: true },
    sellerId: { type: Schema.Types.ObjectId, required: true },
    attempt: { type: Number, default: 1 },
    status: { type: String, enum: SHIPMENT_STATUSES, default: 'pending' },
    carrier: { type: String, required: true },
    trackingNumber: { type: String, default: null },
    expectedDays: { type: { min: Number, max: Number, _id: false }, default: null },
    shippedAt: { type: Date, default: null },
    deliveredAt: { type: Date, default: null },
    events: {
      type: [
        {
          at: { type: Date, default: Date.now },
          status: { type: String, enum: SHIPMENT_STATUSES, required: true },
          source: { type: String, enum: ['seller', 'provider', 'buyer', 'system'], required: true },
          note: { type: String, default: null },
          location: { type: String, default: null },
          _id: false,
        },
      ],
      default: [],
    },
  },
  { timestamps: true, collection: 'shipments' },
);

schema.index({ orderId: 1, attempt: 1 }, { unique: true });
schema.index(
  { carrier: 1, trackingNumber: 1 },
  { unique: true, partialFilterExpression: { trackingNumber: { $type: 'string' } } },
);
schema.index({ farmId: 1, status: 1, updatedAt: -1 });

export type ShipmentDoc = HydratedDocument<ShipmentAttrs>;
export const Shipment = model<ShipmentAttrs>('Shipment', schema);
