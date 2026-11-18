import { Schema, model, type HydratedDocument, type Types } from 'mongoose';
import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_TYPES,
  type NotificationCategory,
  type NotificationType,
} from '@farmplus/shared-types';

export interface NotificationAttrs {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  type: NotificationType;
  category: NotificationCategory;
  title: string;
  body: string;
  link?: string | null;
  count: number;
  /** One notification per (user, event): retries and duplicate hooks cannot notify twice. */
  eventKey?: string | null;
  /** While unread, repeated events of one kind (chat messages) fold into this one notification. */
  groupKey?: string | null;
  readAt?: Date | null;
  createdAt: Date;
}

const schema = new Schema<NotificationAttrs>(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    type: { type: String, enum: NOTIFICATION_TYPES, required: true },
    category: { type: String, enum: NOTIFICATION_CATEGORIES, required: true },
    title: { type: String, required: true, maxlength: 160 },
    body: { type: String, required: true, maxlength: 400 },
    link: { type: String, default: null, maxlength: 200 },
    count: { type: Number, default: 1, min: 1 },
    eventKey: { type: String, default: null },
    groupKey: { type: String, default: null },
    readAt: { type: Date, default: null },
    createdAt: { type: Date, default: Date.now },
  },
  { collection: 'notifications' },
);
schema.index({ userId: 1, _id: -1 });
schema.index({ userId: 1, readAt: 1, category: 1 });
schema.index(
  { userId: 1, eventKey: 1 },
  {
    unique: true,
    name: 'notif_event_unique',
    partialFilterExpression: { eventKey: { $type: 'string' } },
  },
);
schema.index(
  { userId: 1, groupKey: 1 },
  {
    unique: true,
    name: 'notif_group_unique',
    partialFilterExpression: { groupKey: { $type: 'string' } },
  },
);
// Notifications are a convenience, not a record: they age out (the audit log keeps the real history).
schema.index({ createdAt: 1 }, { name: 'notif_ttl', expireAfterSeconds: 180 * 24 * 3600 });

export const Notification = model<NotificationAttrs>('Notification', schema);
export type NotificationDoc = HydratedDocument<NotificationAttrs>;
