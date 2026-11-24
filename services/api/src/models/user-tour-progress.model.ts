import { Schema, model, type HydratedDocument, type Types } from 'mongoose';
import { TOUR_STATUSES, type TourStatus } from '@farmplus/shared-types';

/**
 * Where a signed-in user stands with one guided tour (`PUT /me/tours/:tourId`). Kept on the server so a tour seen in
 * one tab or device is not shown again in another. `version` is the tour's version at the time: when a tour's content
 * changes a lot its version goes up and it is shown again — except to people who chose "don't show again".
 * A personal preference, not business data: not audited.
 */
export interface UserTourProgressAttrs {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  tourId: string;
  version: number;
  status: TourStatus;
  /** The step the person last saw (0-based), for stats on where tours are left. */
  lastStep: number;
  createdAt: Date;
  updatedAt: Date;
}

const schema = new Schema<UserTourProgressAttrs>(
  {
    userId: { type: Schema.Types.ObjectId, required: true, ref: 'User' },
    tourId: { type: String, required: true },
    version: { type: Number, required: true },
    status: { type: String, enum: TOUR_STATUSES, required: true },
    lastStep: { type: Number, default: 0 },
  },
  { timestamps: true, collection: 'user_tour_progress' },
);
schema.index({ userId: 1, tourId: 1 }, { unique: true });
// Admin stats: how each tour is finished, skipped or dismissed.
schema.index({ tourId: 1, status: 1 });

export type UserTourProgressDoc = HydratedDocument<UserTourProgressAttrs>;
export const UserTourProgress = model<UserTourProgressAttrs>('UserTourProgress', schema);
