import { Schema, model, type HydratedDocument, type Types } from 'mongoose';

/**
 * A signed-in user's choice about one contextual tip (`PUT /me/assistant-tips/:key`): hidden for good, or snoozed until
 * a Thai calendar day ("remind me in 7 days"). `key` is the tip's rule, plus the farm id for farm tips. A personal
 * preference, not business data: not audited.
 */
export interface AssistantTipStateAttrs {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  key: string;
  hidden: boolean;
  /** Thai calendar day (YYYY-MM-DD) from which the tip shows again; null = not snoozed. */
  snoozedUntil: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const schema = new Schema<AssistantTipStateAttrs>(
  {
    userId: { type: Schema.Types.ObjectId, required: true, ref: 'User' },
    key: { type: String, required: true },
    hidden: { type: Boolean, default: false },
    snoozedUntil: { type: String, default: null },
  },
  { timestamps: true, collection: 'assistant_tip_states' },
);
schema.index({ userId: 1, key: 1 }, { unique: true });

export type AssistantTipStateDoc = HydratedDocument<AssistantTipStateAttrs>;
export const AssistantTipState = model<AssistantTipStateAttrs>('AssistantTipState', schema);
