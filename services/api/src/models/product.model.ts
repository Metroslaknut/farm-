import { Schema, model, type HydratedDocument, type Types } from 'mongoose';
import {
  CURRENCIES,
  DELIVERY_OPTIONS,
  PRODUCT_STATUSES,
  type Currency,
  type DeliveryOption,
  type ProductStatus,
  type ShippingConfig,
} from '@farmplus/shared-types';

export interface ProductAttrs {
  _id: Types.ObjectId;
  farmId: Types.ObjectId;
  /** The farm member who created it. Orders pay the farm OWNER's earnings, whoever listed the product. */
  sellerId: Types.ObjectId;
  farmName: string;
  categoryKey: string;
  title: string;
  description?: string | null;
  brand?: string | null;
  sku?: string | null;
  unit?: string | null;
  status: ProductStatus;
  currency: Currency;
  priceMinor: number;
  promotion?: { priceMinor: number; startsAt: Date; endsAt: Date } | null;
  specs: { name: string; value: string }[];
  photos: { url: string; caption?: string | null }[];
  deliveryOptions: DeliveryOption[];
  shipping?: ShippingConfig | null;
  minOrderQty: number;
  maxOrderQty?: number | null;
  /**
   * Units on hand and units promised to unpaid orders. `stock − reserved` is what can still be ordered. Both are
   * PROJECTIONS of `inventory_movements`, changed only by the inventory service with a guarded atomic update, so
   * concurrent orders can never drive either below zero.
   */
  stock: number;
  reserved: number;
  lowStockThreshold?: number | null;
  regulatory?: { registrationNumber: string; notes?: string | null } | null;
  review: {
    submittedAt?: Date | null;
    approvedAt?: Date | null;
    approvedBy?: Types.ObjectId | null;
    rejectedReason?: string | null;
    suspendedReason?: string | null;
    /** A suspension by a moderator can only be lifted by a moderator. */
    moderatorHold: boolean;
  };
  ratingCount: number;
  ratingSum: number;
  soldCount: number;
  history: {
    at: Date;
    type: string;
    from?: ProductStatus | null;
    to?: ProductStatus | null;
    actorId?: Types.ObjectId | null;
    data?: Record<string, unknown>;
  }[];
  createdAt: Date;
  updatedAt: Date;
}

const schema = new Schema<ProductAttrs>(
  {
    farmId: { type: Schema.Types.ObjectId, required: true, ref: 'Farm' },
    sellerId: { type: Schema.Types.ObjectId, required: true, ref: 'User' },
    farmName: { type: String, required: true },
    categoryKey: { type: String, required: true },
    title: { type: String, required: true },
    description: { type: String, default: null },
    brand: { type: String, default: null },
    sku: { type: String, default: null },
    unit: { type: String, default: null },
    status: { type: String, enum: PRODUCT_STATUSES, default: 'DRAFT' },
    currency: { type: String, enum: CURRENCIES, default: 'THB' },
    priceMinor: { type: Number, required: true, min: 1 },
    promotion: { type: Schema.Types.Mixed, default: null },
    specs: { type: Schema.Types.Mixed, default: [] },
    photos: { type: Schema.Types.Mixed, default: [] },
    deliveryOptions: { type: [{ type: String, enum: DELIVERY_OPTIONS }], default: ['pickup'] },
    shipping: { type: Schema.Types.Mixed, default: null },
    minOrderQty: { type: Number, default: 1, min: 1 },
    maxOrderQty: { type: Number, default: null },
    stock: { type: Number, default: 0, min: 0 },
    reserved: { type: Number, default: 0, min: 0 },
    lowStockThreshold: { type: Number, default: null },
    regulatory: { type: Schema.Types.Mixed, default: null },
    review: { type: Schema.Types.Mixed, default: () => ({ moderatorHold: false }) },
    ratingCount: { type: Number, default: 0, min: 0 },
    ratingSum: { type: Number, default: 0, min: 0 },
    soldCount: { type: Number, default: 0, min: 0 },
    history: { type: Schema.Types.Mixed, default: [] },
  },
  { timestamps: true, collection: 'products' },
);

schema.index({ farmId: 1, status: 1, createdAt: -1 });
schema.index({ status: 1, categoryKey: 1, createdAt: -1 });
schema.index({ status: 1, createdAt: -1 });
// A SKU identifies one product within a farm (when given).
schema.index(
  { farmId: 1, sku: 1 },
  { unique: true, partialFilterExpression: { sku: { $type: 'string' } } },
);

export type ProductDoc = HydratedDocument<ProductAttrs>;
export const Product = model<ProductAttrs>('Product', schema);
