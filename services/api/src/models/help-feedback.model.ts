import { Schema, model, type HydratedDocument, type Types } from 'mongoose';

/**
 * "Was this article helpful?" from the help centre (`POST /help/feedback`): two counters per article and language.
 * Anonymous by design — no user, IP or free text is stored, only the counts.
 */
export interface HelpFeedbackAttrs {
  _id: Types.ObjectId;
  slug: string;
  locale: 'th' | 'en';
  helpful: number;
  notHelpful: number;
  createdAt: Date;
  updatedAt: Date;
}

const schema = new Schema<HelpFeedbackAttrs>(
  {
    slug: { type: String, required: true },
    locale: { type: String, enum: ['th', 'en'], required: true },
    helpful: { type: Number, default: 0 },
    notHelpful: { type: Number, default: 0 },
  },
  { timestamps: true, collection: 'help_feedback' },
);
schema.index({ slug: 1, locale: 1 }, { unique: true });

export type HelpFeedbackDoc = HydratedDocument<HelpFeedbackAttrs>;
export const HelpFeedback = model<HelpFeedbackAttrs>('HelpFeedback', schema);
