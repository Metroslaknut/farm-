import { Schema, model, type HydratedDocument, type Types } from 'mongoose';

export interface ProductReviewAttrs {
  _id: Types.ObjectId;
  productId: Types.ObjectId;
  buyerId: Types.ObjectId;
  /** The delivered order that earned the right to review. */
  orderId: Types.ObjectId;
  rating: number;
  title?: string | null;
  body: string;
  status: 'published' | 'hidden';
  hiddenReason?: string | null;
  hiddenBy?: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const schema = new Schema<ProductReviewAttrs>(
  {
    productId: { type: Schema.Types.ObjectId, required: true, ref: 'Product' },
    buyerId: { type: Schema.Types.ObjectId, required: true, ref: 'User' },
    orderId: { type: Schema.Types.ObjectId, required: true, ref: 'Order' },
    rating: { type: Number, required: true, min: 1, max: 5 },
    title: { type: String, default: null },
    body: { type: String, required: true },
    status: { type: String, enum: ['published', 'hidden'], default: 'published' },
    hiddenReason: { type: String, default: null },
    hiddenBy: { type: Schema.Types.ObjectId, default: null },
  },
  { timestamps: true, collection: 'product_reviews' },
);
// One review per buyer per product.
schema.index({ productId: 1, buyerId: 1 }, { unique: true });
schema.index({ productId: 1, status: 1, createdAt: -1, _id: -1 });

export type ProductReviewDoc = HydratedDocument<ProductReviewAttrs>;
export const ProductReview = model<ProductReviewAttrs>('ProductReview', schema);
