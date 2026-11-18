import { Types } from 'mongoose';
import { reportError } from '../../lib/error-reporter';
import {
  LOCKED_CATEGORIES,
  NOTIFICATION_CATEGORIES,
  REALTIME_EVENTS,
  categoryOf,
  type NotificationCategory,
  type NotificationDTO,
  type NotificationPage,
  type NotificationPreferencesDTO,
  type NotificationType,
} from '@farmplus/shared-types';
import { conflict, notFound } from '../../lib/errors';
import { Notification, NotificationPreference, type NotificationDoc } from '../../models';
import { hub } from '../realtime/hub';
import { render, type TemplateParams } from './templates';
import { pushUnread } from './unread';

export const toNotificationDTO = (n: NotificationDoc): NotificationDTO => ({
  id: String(n._id),
  type: n.type,
  category: n.category,
  title: n.title,
  body: n.body,
  link: n.link ?? null,
  count: n.count,
  readAt: n.readAt?.toISOString() ?? null,
  createdAt: n.createdAt.toISOString(),
});

const isDuplicate = (e: unknown): boolean => (e as { code?: number })?.code === 11000;

async function enabledFor(
  userId: Types.ObjectId,
  category: NotificationCategory,
): Promise<boolean> {
  if (LOCKED_CATEGORIES.includes(category)) return true;
  const pref = await NotificationPreference.findOne({ userId }).select('categories');
  return pref?.categories?.[category]?.inApp !== false;
}

export interface NotifyInput<T extends NotificationType> {
  /** Recipients; duplicates are folded, `exclude` (usually the person who did it) is skipped. */
  to: (Types.ObjectId | string)[];
  exclude?: (Types.ObjectId | string | null | undefined)[];
  type: T;
  params: TemplateParams<T>;
  /** Idempotency: at most one notification per recipient and event key (e.g. `order:<id>:PAID`). */
  eventKey?: string;
  /** While unread, further events with the same group key fold into one notification (chat). */
  groupKey?: string;
}

/**
 * Create in-app notifications. **Never throws**: a notification problem must not undo the business action that
 * caused it (the order is paid whether or not the bell updates), so failures are logged and swallowed.
 */
export async function notify<T extends NotificationType>(input: NotifyInput<T>): Promise<void> {
  try {
    const skip = new Set((input.exclude ?? []).filter(Boolean).map(String));
    const ids = [...new Set(input.to.map(String))].filter((id) => !skip.has(id));
    if (ids.length === 0) return;
    const category = categoryOf(input.type);
    const content = render(input.type, input.params);
    await Promise.all(
      ids.map(async (id) => {
        const userId = new Types.ObjectId(id);
        if (!(await enabledFor(userId, category))) return;
        const created = input.groupKey
          ? await upsertGrouped(userId, input, category, content)
          : await insertOnce(userId, input, category, content);
        if (!created) return;
        hub.toUser(id, REALTIME_EVENTS.notification, toNotificationDTO(created));
        await pushUnread(id);
      }),
    );
  } catch (error) {
    reportError(error, { source: 'job', route: `notifications.notify.${input.type}` });
  }
}

type Content = ReturnType<typeof render>;

async function insertOnce(
  userId: Types.ObjectId,
  input: NotifyInput<NotificationType>,
  category: NotificationCategory,
  content: Content,
): Promise<NotificationDoc | null> {
  const doc = {
    userId,
    type: input.type,
    category,
    ...content,
    eventKey: input.eventKey ?? null,
    createdAt: new Date(),
  };
  try {
    return await Notification.create(doc);
  } catch (e) {
    if (isDuplicate(e)) return null; // this event was already announced to this person
    throw e;
  }
}

async function upsertGrouped(
  userId: Types.ObjectId,
  input: NotifyInput<NotificationType>,
  category: NotificationCategory,
  _content: Content,
): Promise<NotificationDoc | null> {
  const groupKey = input.groupKey!;
  const attempt = async () => {
    const existing = await Notification.findOneAndUpdate(
      { userId, groupKey },
      { $inc: { count: 1 } },
      { returnDocument: 'after' },
    );
    if (existing) {
      // re-render with the new count
      const p = {
        ...(input.params as object),
        count: existing.count,
      } as TemplateParams<NotificationType>;
      const content = render(input.type, p as never);
      existing.title = content.title;
      existing.body = content.body;
      await existing.save();
      return existing;
    }
    return Notification.create({
      userId,
      type: input.type,
      category,
      ...render(input.type, { ...(input.params as object), count: 1 } as never),
      groupKey,
      createdAt: new Date(),
    });
  };
  try {
    return await attempt();
  } catch (e) {
    if (isDuplicate(e)) return attempt(); // two messages raced to open the group: the second one folds into it
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Reading and managing (always scoped to the caller)
// ---------------------------------------------------------------------------
export async function listNotifications(
  userId: string,
  q: {
    cursor?: string | undefined;
    limit?: number | undefined;
    unread?: boolean | undefined;
    category?: NotificationCategory | undefined;
  },
): Promise<NotificationPage> {
  const uid = new Types.ObjectId(userId);
  const limit = q.limit ?? 20;
  // Only the notification counter is returned here, so the chat counters are not computed.
  const [rows, unread] = await Promise.all([
    Notification.find({
      userId: uid,
      ...(q.cursor ? { _id: { $lt: new Types.ObjectId(q.cursor) } } : {}),
      ...(q.unread ? { readAt: null } : {}),
      ...(q.category ? { category: q.category } : {}),
    })
      .sort({ _id: -1 })
      .limit(limit + 1),
    Notification.countDocuments({ userId: uid, readAt: null }),
  ]);
  const page = rows.slice(0, limit);
  return {
    items: page.map(toNotificationDTO),
    ...(rows.length > limit ? { nextCursor: String(page[page.length - 1]!._id) } : {}),
    unread,
  };
}

export async function markRead(userId: string, id: Types.ObjectId): Promise<NotificationDTO> {
  const uid = new Types.ObjectId(userId);
  // someone else's notification is simply "not found"
  await Notification.updateOne(
    { _id: id, userId: uid, readAt: null },
    { $set: { readAt: new Date(), groupKey: null } },
  );
  const n = await Notification.findOne({ _id: id, userId: uid });
  if (!n) throw notFound('Notification not found');
  await pushUnread(userId);
  return toNotificationDTO(n);
}

export async function markAllRead(
  userId: string,
  category?: NotificationCategory,
): Promise<{ updated: number }> {
  const res = await Notification.updateMany(
    { userId: new Types.ObjectId(userId), readAt: null, ...(category ? { category } : {}) },
    { $set: { readAt: new Date(), groupKey: null } },
  );
  await pushUnread(userId);
  return { updated: res.modifiedCount };
}

export async function deleteNotification(userId: string, id: Types.ObjectId): Promise<void> {
  const res = await Notification.deleteOne({ _id: id, userId: new Types.ObjectId(userId) });
  if (res.deletedCount !== 1) throw notFound('Notification not found');
  await pushUnread(userId);
}

export async function getPreferences(userId: string): Promise<NotificationPreferencesDTO> {
  const pref = await NotificationPreference.findOne({ userId: new Types.ObjectId(userId) });
  const categories = {} as NotificationPreferencesDTO['categories'];
  for (const c of NOTIFICATION_CATEGORIES) {
    const locked = LOCKED_CATEGORIES.includes(c);
    categories[c] = { inApp: locked ? true : pref?.categories?.[c]?.inApp !== false, locked };
  }
  return { categories };
}

export async function updatePreferences(
  userId: string,
  changes: Partial<Record<NotificationCategory, { inApp: boolean }>>,
): Promise<NotificationPreferencesDTO> {
  for (const c of Object.keys(changes) as NotificationCategory[])
    if (LOCKED_CATEGORIES.includes(c))
      throw conflict(
        `${c} notifications cannot be turned off: they concern money or your account standing`,
        'CATEGORY_LOCKED',
      );
  const set: Record<string, unknown> = {};
  for (const [c, v] of Object.entries(changes)) set[`categories.${c}`] = { inApp: v!.inApp };
  await NotificationPreference.updateOne(
    { userId: new Types.ObjectId(userId) },
    { $set: set },
    { upsert: true },
  );
  return getPreferences(userId);
}
