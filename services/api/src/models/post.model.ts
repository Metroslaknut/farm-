import { Schema, model, type HydratedDocument, type Types } from 'mongoose';
import {
  CONTENT_STATUSES,
  POST_MEDIA_KINDS,
  POST_VISIBILITIES,
  type ContentStatus,
  type PostMediaKind,
  type PostVisibility,
} from '@farmplus/shared-types';

export interface ModerationEntryAttrs {
  at: Date;
  by: Types.ObjectId;
  action: string;
  reason?: string | null;
  from?: string | null;
  to?: string | null;
}

export interface PostAttrs {
  _id: Types.ObjectId;
  authorId: Types.ObjectId;
  body: string;
  /** Files live in external object storage; only their https location is stored. */
  media: {
    _id: Types.ObjectId;
    kind: PostMediaKind;
    url: string;
    mimeType?: string | null;
    caption?: string | null;
  }[];
  visibility: PostVisibility;
  status: ContentStatus;
  reactionCount: number;
  commentCount: number;
  /** reactionCount + 2 × commentCount, kept in step so “trending” is a plain indexed sort. */
  engagement: number;
  editedAt?: Date | null;
  deletedAt?: Date | null;
  /** Previous bodies, newest last (capped) — evidence for moderators. */
  edits: { at: Date; body: string }[];
  moderation: ModerationEntryAttrs[];
  createdAt: Date;
  updatedAt: Date;
}

export const moderationDefinition = {
  at: { type: Date, default: Date.now },
  by: { type: Schema.Types.ObjectId, required: true },
  action: { type: String, required: true },
  reason: { type: String, default: null },
  from: { type: String, default: null },
  to: { type: String, default: null },
};

const schema = new Schema<PostAttrs>(
  {
    authorId: { type: Schema.Types.ObjectId, required: true, ref: 'User' },
    body: { type: String, default: '', maxlength: 2000 },
    media: {
      type: [
        {
          kind: { type: String, enum: POST_MEDIA_KINDS, required: true },
          url: { type: String, required: true },
          mimeType: { type: String, default: null },
          caption: { type: String, default: null },
        },
      ],
      default: [],
    },
    visibility: { type: String, enum: POST_VISIBILITIES, default: 'public' },
    status: { type: String, enum: CONTENT_STATUSES, default: 'published' },
    reactionCount: { type: Number, default: 0, min: 0 },
    commentCount: { type: Number, default: 0, min: 0 },
    engagement: { type: Number, default: 0, min: 0 },
    editedAt: { type: Date, default: null },
    deletedAt: { type: Date, default: null },
    edits: {
      type: [{ at: { type: Date, default: Date.now }, body: { type: String, default: '' } }],
      default: [],
    },
    moderation: { type: [moderationDefinition], default: [] },
  },
  { timestamps: true, collection: 'posts' },
);

// Feeds: newest first, by author, and the trending window.
schema.index({ status: 1, visibility: 1, createdAt: -1, _id: -1 });
schema.index({ authorId: 1, status: 1, createdAt: -1, _id: -1 });
schema.index({ status: 1, visibility: 1, createdAt: -1, engagement: -1, _id: -1 });

export type PostDoc = HydratedDocument<PostAttrs>;
export const Post = model<PostAttrs>('Post', schema);
