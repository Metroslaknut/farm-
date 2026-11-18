import { Schema, model, type HydratedDocument, type Types } from 'mongoose';
import { INVENTORY_MOVEMENT_TYPES, type InventoryMovementType } from '@farmplus/shared-types';

/** Append-only stock ledger. `stock = Σ deltaStock` and `reserved = Σ deltaReserved` for every product (reconciled). */
export interface InventoryMovementAttrs {
  _id: Types.ObjectId;
  productId: Types.ObjectId;
  farmId: Types.ObjectId;
  type: InventoryMovementType;
  deltaStock: number;
  deltaReserved: number;
  orderId?: Types.ObjectId | null;
  orderNo?: string | null;
  actorId?: Types.ObjectId | null;
  note?: string | null;
  /** On a reserve row: which step settled it. Claimed atomically so a reservation is either sold or released, never both. */
  settledBy?: 'release' | 'sale' | null;
  createdAt: Date;
}

const schema = new Schema<InventoryMovementAttrs>(
  {
    productId: { type: Schema.Types.ObjectId, required: true, ref: 'Product' },
    farmId: { type: Schema.Types.ObjectId, required: true, ref: 'Farm' },
    type: { type: String, enum: INVENTORY_MOVEMENT_TYPES, required: true },
    deltaStock: { type: Number, required: true },
    deltaReserved: { type: Number, required: true },
    orderId: { type: Schema.Types.ObjectId, default: null },
    orderNo: { type: String, default: null },
    actorId: { type: Schema.Types.ObjectId, default: null },
    note: { type: String, default: null },
    settledBy: { type: String, enum: ['release', 'sale', null], default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: 'inventory_movements' },
);

// For one order and product each kind of movement happens at most once: replays are no-ops, never double counts.
schema.index(
  { orderId: 1, productId: 1, type: 1 },
  { unique: true, partialFilterExpression: { orderId: { $type: 'objectId' } } },
);
schema.index({ productId: 1, createdAt: -1, _id: -1 });
schema.index({ type: 1, createdAt: 1 });

export type InventoryMovementDoc = HydratedDocument<InventoryMovementAttrs>;
export const InventoryMovement = model<InventoryMovementAttrs>('InventoryMovement', schema);
