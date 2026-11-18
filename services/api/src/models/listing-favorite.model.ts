import { Schema, model, type Types } from 'mongoose';

export interface ListingFavoriteAttrs {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  listingId: Types.ObjectId;
  createdAt: Date;
}

const schema = new Schema<ListingFavoriteAttrs>(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    listingId: { type: Schema.Types.ObjectId, required: true },
    createdAt: { type: Date, default: Date.now },
  },
  { collection: 'listing_favorites' },
);
schema.index({ userId: 1, listingId: 1 }, { unique: true });
schema.index({ userId: 1, createdAt: -1, _id: -1 });

export const ListingFavorite = model<ListingFavoriteAttrs>('ListingFavorite', schema);
