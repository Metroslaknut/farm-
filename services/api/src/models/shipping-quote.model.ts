import { Schema, model, type HydratedDocument, type Types } from 'mongoose';
import {
  CURRENCIES,
  TRANSPORT_REQUIREMENTS,
  type Currency,
  type TransportRequirement,
} from '@farmplus/shared-types';

export interface ShippingQuoteAttrs {
  _id: Types.ObjectId;
  buyerId: Types.ObjectId;
  listingId: Types.ObjectId;
  destination: { province: string; district?: string | null; postalCode?: string | null };
  options: {
    /** Not called `id`: Mongoose reserves that name for the document id. */
    optionId: string;
    source: 'seller_rule' | 'provider';
    label: string;
    priceMinor: number;
    currency: Currency;
    estimatedDays?: { min: number; max: number } | null;
    isEstimate: boolean;
    requirements: TransportRequirement[];
  }[];
  /** Hash of the shipping terms (and price) the quote was computed from: if the listing changes, the quote is stale. */
  termsHash: string;
  unavailableReason?: string | null;
  expiresAt: Date;
  usedByOrderId?: Types.ObjectId | null;
  purgeAt: Date;
  createdAt: Date;
}

const schema = new Schema<ShippingQuoteAttrs>(
  {
    buyerId: { type: Schema.Types.ObjectId, required: true },
    listingId: { type: Schema.Types.ObjectId, required: true },
    destination: { type: Schema.Types.Mixed, required: true },
    options: {
      type: [
        {
          optionId: String,
          source: { type: String, enum: ['seller_rule', 'provider'] },
          label: String,
          priceMinor: Number,
          currency: { type: String, enum: CURRENCIES },
          estimatedDays: { type: { min: Number, max: Number, _id: false }, default: null },
          isEstimate: Boolean,
          requirements: [{ type: String, enum: TRANSPORT_REQUIREMENTS }],
          _id: false,
        },
      ],
      default: [],
    },
    termsHash: { type: String, required: true },
    unavailableReason: { type: String, default: null },
    expiresAt: { type: Date, required: true },
    usedByOrderId: { type: Schema.Types.ObjectId, default: null },
    purgeAt: { type: Date, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: 'shipping_quotes' },
);
schema.index({ buyerId: 1, listingId: 1, createdAt: -1 });
// Quotes are kept for a week after they expire (support/audit), then removed by MongoDB itself.
schema.index({ purgeAt: 1 }, { expireAfterSeconds: 0 });

export type ShippingQuoteDoc = HydratedDocument<ShippingQuoteAttrs>;
export const ShippingQuote = model<ShippingQuoteAttrs>('ShippingQuote', schema);
