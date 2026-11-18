import { Schema, model, type HydratedDocument, type Types } from 'mongoose';
import {
  CURRENCIES,
  NEGOTIATION_EVENT_TYPES,
  NEGOTIATION_STATUSES,
  type Currency,
  type NegotiationEventType,
  type NegotiationStatus,
  type Party,
} from '@farmplus/shared-types';

/** One immutable fact of the negotiation. Items are only ever appended. */
export interface NegotiationEventAttrs {
  seq: number;
  type: NegotiationEventType;
  by: Party;
  actorId: Types.ObjectId;
  amountMinor?: number | null;
  currency?: Currency | null;
  message?: string | null;
  reason?: string | null;
  at: Date;
}

export interface NegotiationAttrs {
  _id: Types.ObjectId;
  listingId: Types.ObjectId;
  farmId: Types.ObjectId;
  sellerId: Types.ObjectId;
  buyerId: Types.ObjectId;
  status: NegotiationStatus;
  turn?: Party | null;
  currentOfferMinor: number;
  currency: Currency;
  /** `seq` of the offer on the table. Every offer/counter increments it; accept must quote it. */
  currentSeq: number;
  offerExpiresAt?: Date | null;
  history: NegotiationEventAttrs[];
  createdAt: Date;
  updatedAt: Date;
}

const eventDefinition = {
  seq: { type: Number, required: true },
  type: { type: String, enum: NEGOTIATION_EVENT_TYPES, required: true },
  by: { type: String, enum: ['buyer', 'seller'], required: true },
  actorId: { type: Schema.Types.ObjectId, required: true },
  amountMinor: { type: Number, default: null },
  currency: { type: String, enum: [...CURRENCIES, null], default: null },
  message: { type: String, default: null },
  reason: { type: String, default: null },
  at: { type: Date, default: Date.now },
  _id: false,
};

const schema = new Schema<NegotiationAttrs>(
  {
    listingId: { type: Schema.Types.ObjectId, required: true, ref: 'Listing' },
    farmId: { type: Schema.Types.ObjectId, required: true },
    sellerId: { type: Schema.Types.ObjectId, required: true },
    buyerId: { type: Schema.Types.ObjectId, required: true, ref: 'User' },
    status: { type: String, enum: NEGOTIATION_STATUSES, default: 'open' },
    turn: { type: String, enum: ['buyer', 'seller', null], default: null },
    currentOfferMinor: { type: Number, required: true, min: 1 },
    currency: { type: String, enum: CURRENCIES, default: 'THB' },
    currentSeq: { type: Number, required: true, min: 1 },
    offerExpiresAt: { type: Date, default: null },
    history: { type: [eventDefinition], default: [] },
  },
  { timestamps: true, collection: 'negotiations' },
);

// A buyer has one negotiation per listing (they keep negotiating inside it).
schema.index({ listingId: 1, buyerId: 1 }, { unique: true });
schema.index({ buyerId: 1, updatedAt: -1, _id: -1 });
schema.index({ listingId: 1, status: 1, updatedAt: -1 });
schema.index({ farmId: 1, status: 1, updatedAt: -1 });
schema.index({ status: 1, offerExpiresAt: 1 });

export type NegotiationDoc = HydratedDocument<NegotiationAttrs>;
export const Negotiation = model<NegotiationAttrs>('Negotiation', schema);
