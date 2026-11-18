import { Schema, type Types } from 'mongoose';

export interface HistoryEntryAttrs {
  at: Date;
  by: Types.ObjectId;
  kind: 'correction' | 'attachment_added' | 'attachment_removed' | 'void' | 'event';
  reason?: string | null;
  changes: { field: string; from: unknown; to: unknown }[];
}

export interface AttachmentAttrs {
  _id: Types.ObjectId;
  kind: 'photo' | 'document';
  url: string;
  mimeType?: string | null;
  caption?: string | null;
  addedBy: Types.ObjectId;
  addedAt: Date;
}

/**
 * Fields every husbandry record carries. Records are append-only in spirit: nothing is ever deleted, edits are
 * corrections (with a reason, kept in `history`), and a mistaken record is `voided`, not removed.
 */
export interface RecordBaseAttrs {
  _id: Types.ObjectId;
  farmId: Types.ObjectId;
  /** 1 on creation, +1 per correction. */
  revision: number;
  createdBy: Types.ObjectId;
  updatedBy?: Types.ObjectId | null;
  voided: boolean;
  voidedAt?: Date | null;
  voidedBy?: Types.ObjectId | null;
  voidReason?: string | null;
  attachments: AttachmentAttrs[];
  history: HistoryEntryAttrs[];
  createdAt: Date;
  updatedAt: Date;
}

export const recordBaseDefinition = {
  farmId: { type: Schema.Types.ObjectId, required: true, ref: 'Farm' },
  revision: { type: Number, default: 1 },
  createdBy: { type: Schema.Types.ObjectId, required: true, ref: 'User' },
  updatedBy: { type: Schema.Types.ObjectId, default: null },
  voided: { type: Boolean, default: false },
  voidedAt: { type: Date, default: null },
  voidedBy: { type: Schema.Types.ObjectId, default: null },
  voidReason: { type: String, default: null },
  attachments: {
    type: [
      {
        kind: { type: String, enum: ['photo', 'document'], required: true },
        url: { type: String, required: true },
        mimeType: { type: String, default: null },
        caption: { type: String, default: null },
        addedBy: { type: Schema.Types.ObjectId, required: true },
        addedAt: { type: Date, default: Date.now },
      },
    ],
    default: [],
  },
  history: {
    type: [
      {
        _id: false,
        at: { type: Date, required: true },
        by: { type: Schema.Types.ObjectId, required: true },
        kind: { type: String, required: true },
        reason: { type: String, default: null },
        changes: {
          type: [{ _id: false, field: String, from: Schema.Types.Mixed, to: Schema.Types.Mixed }],
          default: [],
        },
      },
    ],
    default: [],
  },
};
