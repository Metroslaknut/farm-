import { Schema, model, type Types } from 'mongoose';
import { LISTING_STATUSES, type ListingStatus } from '@farmplus/shared-types';

/** Append-only history of a listing: status changes and every negotiation step. Never updated, never deleted. */
export interface ListingEventAttrs {
  _id: Types.ObjectId;
  listingId: Types.ObjectId;
  farmId: Types.ObjectId;
  type: string;
  actorId?: Types.ObjectId | null;
  from?: ListingStatus | null;
  to?: ListingStatus | null;
  data?: Record<string, unknown>;
  at: Date;
}

const schema = new Schema<ListingEventAttrs>(
  {
    listingId: { type: Schema.Types.ObjectId, required: true, index: true },
    farmId: { type: Schema.Types.ObjectId, required: true },
    type: { type: String, required: true },
    actorId: { type: Schema.Types.ObjectId, default: null },
    from: { type: String, enum: [...LISTING_STATUSES, null], default: null },
    to: { type: String, enum: [...LISTING_STATUSES, null], default: null },
    data: { type: Schema.Types.Mixed },
    at: { type: Date, default: Date.now },
  },
  { collection: 'listing_events' },
);
schema.index({ listingId: 1, at: 1, _id: 1 });

export const ListingEvent = model<ListingEventAttrs>('ListingEvent', schema);
