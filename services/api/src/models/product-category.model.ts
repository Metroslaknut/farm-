import { Schema, model, type HydratedDocument, type Types } from 'mongoose';
import { PRODUCT_REGULATIONS, type ProductRegulation } from '@farmplus/shared-types';

export interface ProductCategoryAttrs {
  _id: Types.ObjectId;
  key: string;
  name: string;
  description?: string | null;
  parentKey?: string | null;
  regulation: ProductRegulation;
  /** The compliance gate. Regulated categories start OFF and are switched on only after a recorded review. */
  salesEnabled: boolean;
  complianceReference?: string | null;
  complianceReviewedAt?: Date | null;
  complianceReviewedBy?: Types.ObjectId | null;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

const schema = new Schema<ProductCategoryAttrs>(
  {
    key: { type: String, required: true },
    name: { type: String, required: true },
    description: { type: String, default: null },
    parentKey: { type: String, default: null },
    regulation: { type: String, enum: PRODUCT_REGULATIONS, default: 'none' },
    salesEnabled: { type: Boolean, default: false },
    complianceReference: { type: String, default: null },
    complianceReviewedAt: { type: Date, default: null },
    complianceReviewedBy: { type: Schema.Types.ObjectId, default: null },
    sortOrder: { type: Number, default: 100 },
  },
  { timestamps: true, collection: 'product_categories' },
);
schema.index({ key: 1 }, { unique: true });
schema.index({ parentKey: 1, sortOrder: 1 });

export type ProductCategoryDoc = HydratedDocument<ProductCategoryAttrs>;
export const ProductCategory = model<ProductCategoryAttrs>('ProductCategory', schema);
