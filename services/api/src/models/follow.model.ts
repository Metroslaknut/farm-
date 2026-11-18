import { Schema, model, type Types } from 'mongoose';

export interface FollowAttrs {
  _id: Types.ObjectId;
  followerId: Types.ObjectId;
  followeeId: Types.ObjectId;
  createdAt: Date;
}

const schema = new Schema<FollowAttrs>(
  {
    followerId: { type: Schema.Types.ObjectId, required: true },
    followeeId: { type: Schema.Types.ObjectId, required: true },
    createdAt: { type: Date, default: Date.now },
  },
  { collection: 'follows' },
);
schema.index({ followerId: 1, followeeId: 1 }, { unique: true });
schema.index({ followeeId: 1, followerId: 1 });

export const Follow = model<FollowAttrs>('Follow', schema);
