import { Schema, model, type Types } from 'mongoose';
import { REACTION_TYPES, type ReactionType } from '@farmplus/shared-types';

/** One row per (user, target): the unique index is what makes “like twice” impossible, whatever the clients do. */
export interface ReactionAttrs {
  _id: Types.ObjectId;
  targetType: 'post' | 'comment' | 'video';
  targetId: Types.ObjectId;
  userId: Types.ObjectId;
  type: ReactionType;
  createdAt: Date;
}

const schema = new Schema<ReactionAttrs>(
  {
    targetType: { type: String, enum: ['post', 'comment', 'video'], required: true },
    targetId: { type: Schema.Types.ObjectId, required: true },
    userId: { type: Schema.Types.ObjectId, required: true },
    type: { type: String, enum: REACTION_TYPES, default: 'like' },
    createdAt: { type: Date, default: Date.now },
  },
  { collection: 'reactions' },
);
schema.index({ targetType: 1, targetId: 1, userId: 1 }, { unique: true });
schema.index({ userId: 1, targetType: 1, targetId: 1 });

export const Reaction = model<ReactionAttrs>('Reaction', schema);
