import { Schema, model, type HydratedDocument, type Types } from 'mongoose';
import type { ChatSide } from '@farmplus/shared-types';

export interface MessageAttrs {
  _id: Types.ObjectId;
  conversationId: Types.ObjectId;
  /** Denormalised so unread counts need no join and are scoped by the caller's own ids. */
  farmId: Types.ObjectId;
  buyerId: Types.ObjectId;
  seq: number;
  side: ChatSide;
  senderId: Types.ObjectId;
  body: string;
  /** Client-chosen id: a retried send returns the original message instead of a duplicate. */
  clientId?: string | null;
  /** When the OTHER side read it. For the seller side this is shared: any owner/manager reading marks it read. */
  readAt?: Date | null;
  createdAt: Date;
}

const schema = new Schema<MessageAttrs>(
  {
    conversationId: { type: Schema.Types.ObjectId, required: true },
    farmId: { type: Schema.Types.ObjectId, required: true },
    buyerId: { type: Schema.Types.ObjectId, required: true },
    seq: { type: Number, required: true },
    side: { type: String, enum: ['buyer', 'seller'], required: true },
    senderId: { type: Schema.Types.ObjectId, required: true },
    body: { type: String, required: true, maxlength: 2000 },
    clientId: { type: String, default: null },
    readAt: { type: Date, default: null },
    createdAt: { type: Date, default: Date.now },
  },
  { collection: 'messages' },
);
schema.index({ conversationId: 1, seq: 1 }, { unique: true });
schema.index(
  { conversationId: 1, senderId: 1, clientId: 1 },
  {
    unique: true,
    name: 'msg_client_unique',
    partialFilterExpression: { clientId: { $type: 'string' } },
  },
);
// Unread counters: "messages sent by the other side that I have not read".
schema.index({ buyerId: 1, side: 1, readAt: 1 });
schema.index({ farmId: 1, side: 1, readAt: 1 });
// Per-conversation unread badges on the conversation list (only unread rows are examined, not the whole history).
schema.index({ conversationId: 1, readAt: 1, side: 1 });
schema.index({ senderId: 1, createdAt: -1 });

export const Message = model<MessageAttrs>('Message', schema);
export type MessageDoc = HydratedDocument<MessageAttrs>;
