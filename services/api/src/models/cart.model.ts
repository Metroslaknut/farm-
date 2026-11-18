import { Schema, model, type HydratedDocument, type Types } from 'mongoose';

/** A buyer's saved cart. It stores only product ids and quantities: prices and availability are always read live. */
export interface CartAttrs {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  items: { productId: Types.ObjectId; quantity: number; addedAt: Date }[];
  /** Set while a checkout of this cart runs, so a double submit cannot order the same cart twice. */
  checkoutLockedUntil?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const schema = new Schema<CartAttrs>(
  {
    userId: { type: Schema.Types.ObjectId, required: true, ref: 'User' },
    items: {
      type: [
        new Schema(
          {
            productId: { type: Schema.Types.ObjectId, required: true },
            quantity: { type: Number, required: true, min: 1 },
            addedAt: { type: Date, default: Date.now },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    checkoutLockedUntil: { type: Date, default: null },
  },
  { timestamps: true, collection: 'carts' },
);
schema.index({ userId: 1 }, { unique: true });

export type CartDoc = HydratedDocument<CartAttrs>;
export const Cart = model<CartAttrs>('Cart', schema);
