import { Schema, model, type HydratedDocument, type Types } from 'mongoose';
import type { ChatSide } from '@farmplus/shared-types';

export interface ConversationAttrs {
  _id: Types.ObjectId;
  farmId: Types.ObjectId;
  /** The single buyer. The seller side is the farm's owners and managers, resolved live on every request. */
  buyerId: Types.ObjectId;
  subject?: { type: 'listing' | 'product'; id: Types.ObjectId; title: string } | null;
  /** Last assigned message number (atomic `$inc`); messages are ordered by it. */
  messageSeq: number;
  lastMessage?: { preview: string; side: ChatSide; at: Date } | null;
  lastMessageAt: Date;
  createdAt: Date;
}

const schema = new Schema<ConversationAttrs>(
  {
    farmId: { type: Schema.Types.ObjectId, required: true, ref: 'Farm' },
    buyerId: { type: Schema.Types.ObjectId, required: true, ref: 'User' },
    subject: {
      type: new Schema(
        {
          type: { type: String, enum: ['listing', 'product'], required: true },
          id: { type: Schema.Types.ObjectId, required: true },
          title: { type: String, required: true, maxlength: 160 },
        },
        { _id: false },
      ),
      default: null,
    },
    messageSeq: { type: Number, default: 0 },
    lastMessage: {
      type: new Schema(
        {
          preview: String,
          side: { type: String, enum: ['buyer', 'seller'] },
          at: Date,
        },
        { _id: false },
      ),
      default: null,
    },
    lastMessageAt: { type: Date, default: Date.now },
    createdAt: { type: Date, default: Date.now },
  },
  { collection: 'conversations' },
);
// One thread per buyer and farm: a second "contact seller" opens the same thread.
schema.index({ buyerId: 1, farmId: 1 }, { unique: true });
schema.index({ buyerId: 1, lastMessageAt: -1, _id: -1 });
schema.index({ farmId: 1, lastMessageAt: -1, _id: -1 });

export const Conversation = model<ConversationAttrs>('Conversation', schema);
export type ConversationDoc = HydratedDocument<ConversationAttrs>;
