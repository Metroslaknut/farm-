import { Schema, model, type HydratedDocument, type Types } from 'mongoose';
import {
  MESSAGE_REPORT_ACTIONS,
  MESSAGE_REPORT_STATUSES,
  REPORT_REASONS,
  type ChatSide,
  type MessageReportAction,
  type MessageReportStatus,
  type ReportReason,
} from '@farmplus/shared-types';

// -- Blocks --------------------------------------------------------------------------------------
export interface ChatBlockAttrs {
  _id: Types.ObjectId;
  farmId: Types.ObjectId;
  buyerId: Types.ObjectId;
  /** Who set the block: the buyer, or someone on the farm's seller side. Either one stops sending for both. */
  by: ChatSide;
  actorId: Types.ObjectId;
  createdAt: Date;
}
const blockSchema = new Schema<ChatBlockAttrs>(
  {
    farmId: { type: Schema.Types.ObjectId, required: true },
    buyerId: { type: Schema.Types.ObjectId, required: true },
    by: { type: String, enum: ['buyer', 'seller'], required: true },
    actorId: { type: Schema.Types.ObjectId, required: true },
    createdAt: { type: Date, default: Date.now },
  },
  { collection: 'chat_blocks' },
);
blockSchema.index({ farmId: 1, buyerId: 1, by: 1 }, { unique: true });
export const ChatBlock = model<ChatBlockAttrs>('ChatBlock', blockSchema);

// -- Reports -------------------------------------------------------------------------------------
export interface MessageReportAttrs {
  _id: Types.ObjectId;
  reporterId: Types.ObjectId;
  reporterSide: ChatSide;
  conversationId: Types.ObjectId;
  farmId: Types.ObjectId;
  buyerId: Types.ObjectId;
  reportedUserId: Types.ObjectId;
  messageId?: Types.ObjectId | null;
  reason: ReportReason;
  details?: string | null;
  status: MessageReportStatus;
  /** Copied at report time (the reported message and a few before it): the only chat text a moderator can see. */
  evidence: {
    side: ChatSide;
    senderId: Types.ObjectId;
    body: string;
    at: Date;
    reported: boolean;
  }[];
  resolvedBy?: Types.ObjectId | null;
  resolution?: { action: MessageReportAction; note?: string | null; at: Date } | null;
  createdAt: Date;
}
const reportSchema = new Schema<MessageReportAttrs>(
  {
    reporterId: { type: Schema.Types.ObjectId, required: true },
    reporterSide: { type: String, enum: ['buyer', 'seller'], required: true },
    conversationId: { type: Schema.Types.ObjectId, required: true },
    farmId: { type: Schema.Types.ObjectId, required: true },
    buyerId: { type: Schema.Types.ObjectId, required: true },
    reportedUserId: { type: Schema.Types.ObjectId, required: true },
    messageId: { type: Schema.Types.ObjectId, default: null },
    reason: { type: String, enum: REPORT_REASONS, required: true },
    details: { type: String, default: null, maxlength: 500 },
    status: { type: String, enum: MESSAGE_REPORT_STATUSES, default: 'open' },
    evidence: {
      type: [
        new Schema(
          {
            side: { type: String, enum: ['buyer', 'seller'] },
            senderId: Schema.Types.ObjectId,
            body: String,
            at: Date,
            reported: Boolean,
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    resolvedBy: { type: Schema.Types.ObjectId, default: null },
    resolution: {
      type: new Schema(
        {
          action: { type: String, enum: MESSAGE_REPORT_ACTIONS },
          note: { type: String, default: null },
          at: Date,
        },
        { _id: false },
      ),
      default: null,
    },
    createdAt: { type: Date, default: Date.now },
  },
  { collection: 'message_reports' },
);
reportSchema.index({ status: 1, _id: -1 });
// One open report per reporter and conversation: a report cannot be used to flood the moderation queue.
reportSchema.index(
  { reporterId: 1, conversationId: 1 },
  { unique: true, name: 'msg_report_open_unique', partialFilterExpression: { status: 'open' } },
);
export const MessageReport = model<MessageReportAttrs>('MessageReport', reportSchema);

// -- Restrictions --------------------------------------------------------------------------------
export interface ChatRestrictionAttrs {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  reason: string;
  by: Types.ObjectId;
  createdAt: Date;
}
const restrictionSchema = new Schema<ChatRestrictionAttrs>(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    reason: { type: String, required: true, maxlength: 500 },
    by: { type: Schema.Types.ObjectId, required: true },
    createdAt: { type: Date, default: Date.now },
  },
  { collection: 'chat_restrictions' },
);
restrictionSchema.index({ userId: 1 }, { unique: true });
export const ChatRestriction = model<ChatRestrictionAttrs>('ChatRestriction', restrictionSchema);
export type MessageReportDoc = HydratedDocument<MessageReportAttrs>;
