import { Schema, model, type HydratedDocument, type Types } from 'mongoose';
import {
  CONTENT_STATUSES,
  POST_VISIBILITIES,
  VIDEO_FAILURE_CODES,
  VIDEO_PROCESSING_STATES,
  type ContentStatus,
  type PostVisibility,
  type VideoFailureCode,
  type VideoProcessingState,
} from '@farmplus/shared-types';
import { moderationDefinition, type ModerationEntryAttrs } from './post.model';

export interface MediaAttrs {
  _id: Types.ObjectId;
  ownerId: Types.ObjectId;
  kind: 'video';
  title: string;
  caption?: string | null;
  visibility: PostVisibility;
  /** Moderation / author-deletion status (same vocabulary as posts). */
  status: ContentStatus;
  processing: {
    state: VideoProcessingState;
    failureCode?: VideoFailureCode | null;
    failureMessage?: string | null;
    updatedAt: Date;
  };
  provider: string;
  providerAssetId?: string | null;
  /** What the creator declared before uploading (validated against server limits). */
  declared: { filename: string; mimeType: string; sizeBytes: number };
  uploadExpiresAt: Date;
  durationSeconds?: number | null;
  width?: number | null;
  height?: number | null;
  sizeBytes?: number | null;
  readyAt?: Date | null;
  deletedAt?: Date | null;
  /** Set once the provider asset has been deleted (cleanup bookkeeping). */
  providerDeletedAt?: Date | null;
  viewCount: number;
  reactionCount: number;
  commentCount: number;
  moderation: ModerationEntryAttrs[];
  createdAt: Date;
  updatedAt: Date;
}

const schema = new Schema<MediaAttrs>(
  {
    ownerId: { type: Schema.Types.ObjectId, required: true, ref: 'User' },
    kind: { type: String, enum: ['video'], default: 'video' },
    title: { type: String, required: true, maxlength: 120 },
    caption: { type: String, default: null, maxlength: 500 },
    visibility: { type: String, enum: POST_VISIBILITIES, default: 'public' },
    status: { type: String, enum: CONTENT_STATUSES, default: 'published' },
    processing: {
      state: { type: String, enum: VIDEO_PROCESSING_STATES, default: 'pending_upload' },
      failureCode: { type: String, enum: [...VIDEO_FAILURE_CODES, null], default: null },
      failureMessage: { type: String, default: null },
      updatedAt: { type: Date, default: Date.now },
    },
    provider: { type: String, required: true },
    providerAssetId: { type: String, default: null },
    declared: {
      filename: { type: String, required: true },
      mimeType: { type: String, required: true },
      sizeBytes: { type: Number, required: true },
    },
    uploadExpiresAt: { type: Date, required: true },
    durationSeconds: { type: Number, default: null },
    width: { type: Number, default: null },
    height: { type: Number, default: null },
    sizeBytes: { type: Number, default: null },
    readyAt: { type: Date, default: null },
    deletedAt: { type: Date, default: null },
    providerDeletedAt: { type: Date, default: null },
    viewCount: { type: Number, default: 0, min: 0 },
    reactionCount: { type: Number, default: 0, min: 0 },
    commentCount: { type: Number, default: 0, min: 0 },
    moderation: { type: [moderationDefinition], default: [] },
  },
  { timestamps: true, collection: 'media' },
);

// Public feed, creator list, webhook lookup and cleanup scans.
schema.index({ status: 1, visibility: 1, 'processing.state': 1, createdAt: -1, _id: -1 });
schema.index({ ownerId: 1, createdAt: -1, _id: -1 });
schema.index(
  { provider: 1, providerAssetId: 1 },
  { unique: true, partialFilterExpression: { providerAssetId: { $type: 'string' } } },
);
schema.index({ 'processing.state': 1, uploadExpiresAt: 1 });
schema.index({ status: 1, providerDeletedAt: 1 });

export type MediaDoc = HydratedDocument<MediaAttrs>;
export const Media = model<MediaAttrs>('Media', schema);
