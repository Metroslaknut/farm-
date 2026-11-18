import { Schema, model, type HydratedDocument, type Types } from 'mongoose';
import {
  ANIMAL_SEXES,
  CURRENCIES,
  DELIVERY_OPTIONS,
  LISTING_STATUSES,
  OPEN_LISTING_STATUSES,
  type AnimalSex,
  type AnimalStatus,
  type Currency,
  type DeliveryOption,
  type ListingStatus,
  type ShippingConfig,
} from '@farmplus/shared-types';

export interface ListingAttrs {
  _id: Types.ObjectId;
  sellerId: Types.ObjectId;
  farmId: Types.ObjectId;
  animalId: Types.ObjectId;
  /** Copied at listing time so the public page never reads the farm's private records. */
  animal: {
    animalTypeId: Types.ObjectId;
    animalTypeKey?: string | null;
    animalTypeName: string;
    breed?: string | null;
    sex: AnimalSex;
    birthDate?: Date | null;
    birthDateEstimated: boolean;
  };
  farmName: string;
  location: { province?: string | null; district?: string | null };
  title: string;
  description?: string | null;
  status: ListingStatus;
  askingPriceMinor: number;
  currency: Currency;
  negotiable: boolean;
  minOfferMinor?: number | null;
  conditions?: string | null;
  deliveryOptions: DeliveryOption[];
  shipping?: ShippingConfig | null;
  photos: { url: string; caption?: string | null }[];
  favoriteCount: number;
  rejectedReason?: string | null;
  pausedBy?: 'seller' | 'moderator' | null;
  pausedReason?: string | null;
  activatedAt?: Date | null;
  expiresAt?: Date | null;
  soldAt?: Date | null;
  /**
   * The animal's status before this listing put it on sale (`active` → `for_sale`): restored when the listing closes
   * unsold. `null` = this listing did not change the animal's status.
   */
  animalStatusBefore?: AnimalStatus | null;
  /** Present while RESERVED: the accepted deal that holds the animal. */
  reservation?: {
    negotiationId: Types.ObjectId;
    buyerId: Types.ObjectId;
    amountMinor: number;
    reservedAt: Date;
    expiresAt: Date;
    /** Set once an order is created for the deal: from then on the order, not the reservation timer, decides the animal's fate. */
    orderId?: Types.ObjectId | null;
  } | null;
  createdAt: Date;
  updatedAt: Date;
}

const schema = new Schema<ListingAttrs>(
  {
    sellerId: { type: Schema.Types.ObjectId, required: true, ref: 'User' },
    farmId: { type: Schema.Types.ObjectId, required: true, ref: 'Farm' },
    animalId: { type: Schema.Types.ObjectId, required: true, ref: 'Animal' },
    animal: {
      animalTypeId: { type: Schema.Types.ObjectId, required: true },
      animalTypeKey: { type: String, default: null },
      animalTypeName: { type: String, required: true },
      breed: { type: String, default: null },
      sex: { type: String, enum: ANIMAL_SEXES, required: true },
      birthDate: { type: Date, default: null },
      birthDateEstimated: { type: Boolean, default: false },
    },
    farmName: { type: String, required: true },
    location: {
      province: { type: String, default: null },
      district: { type: String, default: null },
    },
    title: { type: String, required: true, maxlength: 120 },
    description: { type: String, default: null, maxlength: 2000 },
    status: { type: String, enum: LISTING_STATUSES, default: 'DRAFT' },
    askingPriceMinor: { type: Number, required: true, min: 1 },
    currency: { type: String, enum: CURRENCIES, default: 'THB' },
    negotiable: { type: Boolean, default: true },
    minOfferMinor: { type: Number, default: null },
    conditions: { type: String, default: null, maxlength: 1000 },
    deliveryOptions: { type: [{ type: String, enum: DELIVERY_OPTIONS }], default: ['pickup'] },
    shipping: { type: Schema.Types.Mixed, default: null },
    photos: {
      type: [{ url: String, caption: { type: String, default: null }, _id: false }],
      default: [],
    },
    favoriteCount: { type: Number, default: 0, min: 0 },
    rejectedReason: { type: String, default: null },
    pausedBy: { type: String, enum: ['seller', 'moderator', null], default: null },
    pausedReason: { type: String, default: null },
    activatedAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null },
    soldAt: { type: Date, default: null },
    animalStatusBefore: { type: String, default: null },
    reservation: {
      type: {
        negotiationId: Schema.Types.ObjectId,
        buyerId: Schema.Types.ObjectId,
        amountMinor: Number,
        reservedAt: Date,
        expiresAt: Date,
        orderId: { type: Schema.Types.ObjectId, default: null },
        _id: false,
      },
      default: null,
    },
  },
  { timestamps: true, collection: 'listings' },
);

// An animal can be in at most one open listing: the database refuses the second one, whatever the services do.
schema.index(
  { animalId: 1 },
  { unique: true, partialFilterExpression: { status: { $in: [...OPEN_LISTING_STATUSES] } } },
);
schema.index({ status: 1, activatedAt: -1, _id: -1 });
schema.index({ status: 1, askingPriceMinor: 1, _id: 1 });
schema.index({ status: 1, 'animal.animalTypeId': 1, 'location.province': 1 });
schema.index({ farmId: 1, status: 1, createdAt: -1, _id: -1 });
// The farm's listing list without a status filter (the index above only serves it when a status is given).
schema.index({ farmId: 1, createdAt: -1, _id: -1 });
schema.index({ status: 1, expiresAt: 1 });
schema.index({ status: 1, 'reservation.expiresAt': 1 });

export type ListingDoc = HydratedDocument<ListingAttrs>;
export const Listing = model<ListingAttrs>('Listing', schema);
