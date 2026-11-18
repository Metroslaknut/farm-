import { Schema, model, type Types } from 'mongoose';
import type { NotificationCategory } from '@farmplus/shared-types';

export interface NotificationPreferenceAttrs {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  /** Only categories the user changed; anything absent uses the default (on). */
  categories: Partial<Record<NotificationCategory, { inApp: boolean }>>;
  updatedAt: Date;
}

const schema = new Schema<NotificationPreferenceAttrs>(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    categories: { type: Schema.Types.Mixed, default: {} },
  },
  { collection: 'notification_preferences', timestamps: { createdAt: false, updatedAt: true } },
);
schema.index({ userId: 1 }, { unique: true });

export const NotificationPreference = model<NotificationPreferenceAttrs>(
  'NotificationPreference',
  schema,
);
