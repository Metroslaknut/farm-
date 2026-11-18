import { Schema, model, type HydratedDocument, type Types } from 'mongoose';
import {
  MODERATION_ACTIONS,
  REPORT_REASONS,
  REPORT_STATUSES,
  REPORT_TARGETS,
  type ModerationAction,
  type ReportReason,
  type ReportStatus,
  type ReportTarget,
} from '@farmplus/shared-types';

export interface ContentReportAttrs {
  _id: Types.ObjectId;
  reporterId: Types.ObjectId;
  targetType: ReportTarget;
  targetId: Types.ObjectId;
  /** The post itself, or the post a reported comment belongs to. */
  postId: Types.ObjectId;
  /** What `postId` refers to (a post, a video or a live session). */
  containerType: 'post' | 'video' | 'live';
  targetAuthorId: Types.ObjectId;
  reason: ReportReason;
  details?: string | null;
  status: ReportStatus;
  /** Content as reported: edits or deletion afterwards must not erase the evidence. */
  snapshot: { body: string; media: { kind: string; url: string }[] };
  resolvedBy?: Types.ObjectId | null;
  resolvedAt?: Date | null;
  resolution?: { action: ModerationAction; note?: string | null } | null;
  createdAt: Date;
  updatedAt: Date;
}

const schema = new Schema<ContentReportAttrs>(
  {
    reporterId: { type: Schema.Types.ObjectId, required: true },
    targetType: { type: String, enum: REPORT_TARGETS, required: true },
    targetId: { type: Schema.Types.ObjectId, required: true },
    postId: { type: Schema.Types.ObjectId, required: true },
    containerType: { type: String, enum: ['post', 'video', 'live'], default: 'post' },
    targetAuthorId: { type: Schema.Types.ObjectId, required: true },
    reason: { type: String, enum: REPORT_REASONS, required: true },
    details: { type: String, default: null, maxlength: 500 },
    status: { type: String, enum: REPORT_STATUSES, default: 'open' },
    snapshot: {
      body: { type: String, default: '' },
      media: { type: [{ kind: String, url: String, _id: false }], default: [] },
    },
    resolvedBy: { type: Schema.Types.ObjectId, default: null },
    resolvedAt: { type: Date, default: null },
    resolution: {
      type: {
        action: { type: String, enum: MODERATION_ACTIONS },
        note: { type: String, default: null },
        _id: false,
      },
      default: null,
    },
  },
  { timestamps: true, collection: 'content_reports' },
);

// One open report per reporter and target: reporting twice (or spamming reports) adds nothing.
schema.index(
  { reporterId: 1, targetType: 1, targetId: 1 },
  { unique: true, partialFilterExpression: { status: 'open' } },
);
schema.index({ status: 1, createdAt: -1, _id: -1 });
schema.index({ targetType: 1, targetId: 1, status: 1 });

export type ContentReportDoc = HydratedDocument<ContentReportAttrs>;
export const ContentReport = model<ContentReportAttrs>('ContentReport', schema);
