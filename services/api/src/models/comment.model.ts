import { Schema, model, type HydratedDocument, type Types } from 'mongoose';
import { CONTENT_STATUSES, type ContentStatus } from '@farmplus/shared-types';
import { moderationDefinition, type ModerationEntryAttrs } from './post.model';

export interface CommentAttrs {
  _id: Types.ObjectId;
  /** Id of the post or video the comment belongs to (see `targetType`). */
  postId: Types.ObjectId;
  targetType: 'post' | 'video';
  /** Top-level comment this is a reply to (replies are one level deep). */
  parentId?: Types.ObjectId | null;
  authorId: Types.ObjectId;
  body: string;
  status: ContentStatus;
  reactionCount: number;
  replyCount: number;
  editedAt?: Date | null;
  deletedAt?: Date | null;
  edits: { at: Date; body: string }[];
  moderation: ModerationEntryAttrs[];
  createdAt: Date;
  updatedAt: Date;
}

const schema = new Schema<CommentAttrs>(
  {
    postId: { type: Schema.Types.ObjectId, required: true },
    targetType: { type: String, enum: ['post', 'video'], default: 'post' },
    parentId: { type: Schema.Types.ObjectId, default: null },
    authorId: { type: Schema.Types.ObjectId, required: true, ref: 'User' },
    body: { type: String, required: true, maxlength: 1000 },
    status: { type: String, enum: CONTENT_STATUSES, default: 'published' },
    reactionCount: { type: Number, default: 0, min: 0 },
    replyCount: { type: Number, default: 0, min: 0 },
    editedAt: { type: Date, default: null },
    deletedAt: { type: Date, default: null },
    edits: {
      type: [{ at: { type: Date, default: Date.now }, body: { type: String, default: '' } }],
      default: [],
    },
    moderation: { type: [moderationDefinition], default: [] },
  },
  { timestamps: true, collection: 'comments' },
);

// Oldest first within a post (top level) or within a parent (replies).
schema.index({ targetType: 1, postId: 1, parentId: 1, createdAt: 1, _id: 1 });
schema.index({ authorId: 1, createdAt: -1 });

export type CommentDoc = HydratedDocument<CommentAttrs>;
export const Comment = model<CommentAttrs>('Comment', schema);
