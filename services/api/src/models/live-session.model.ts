import { Schema, model, type HydratedDocument, type Types } from 'mongoose';
import {
  CONTENT_STATUSES,
  LIVE_ACCESS,
  LIVE_STATES,
  type ContentStatus,
  type LiveAccess,
  type LiveState,
} from '@farmplus/shared-types';
import { moderationDefinition, type ModerationEntryAttrs } from './post.model';

export const ACTIVE_LIVE_STATES: LiveState[] = ['created', 'live', 'interrupted'];

export interface LiveSessionAttrs {
  _id: Types.ObjectId;
  hostId: Types.ObjectId;
  title: string;
  description?: string | null;
  access: LiveAccess;
  state: LiveState;
  /** Moderation status. The stream key is NOT stored here: it is re-read from the provider for the host on request. */
  status: ContentStatus;
  provider: string;
  providerInputId: string;
  startedAt?: Date | null;
  endedAt?: Date | null;
  endReason?: 'host' | 'moderator' | 'timeout' | 'provider' | null;
  lastDisconnectedAt?: Date | null;
  moderation: ModerationEntryAttrs[];
  createdAt: Date;
  updatedAt: Date;
}

const schema = new Schema<LiveSessionAttrs>(
  {
    hostId: { type: Schema.Types.ObjectId, required: true, ref: 'User' },
    title: { type: String, required: true, maxlength: 120 },
    description: { type: String, default: null, maxlength: 500 },
    access: { type: String, enum: LIVE_ACCESS, default: 'public' },
    state: { type: String, enum: LIVE_STATES, default: 'created' },
    status: { type: String, enum: CONTENT_STATUSES, default: 'published' },
    provider: { type: String, required: true },
    providerInputId: { type: String, required: true },
    startedAt: { type: Date, default: null },
    endedAt: { type: Date, default: null },
    endReason: {
      type: String,
      enum: ['host', 'moderator', 'timeout', 'provider', null],
      default: null,
    },
    lastDisconnectedAt: { type: Date, default: null },
    moderation: { type: [moderationDefinition], default: [] },
  },
  { timestamps: true, collection: 'live_sessions' },
);

schema.index({ state: 1, status: 1, createdAt: -1, _id: -1 });
schema.index({ hostId: 1, createdAt: -1 });
schema.index({ provider: 1, providerInputId: 1 }, { unique: true });
// A host can have only one session that is not over: the database enforces it, not just the service.
schema.index(
  { hostId: 1 },
  { unique: true, partialFilterExpression: { state: { $in: ACTIVE_LIVE_STATES } } },
);
schema.index({ state: 1, lastDisconnectedAt: 1 });

export type LiveSessionDoc = HydratedDocument<LiveSessionAttrs>;
export const LiveSession = model<LiveSessionAttrs>('LiveSession', schema);
