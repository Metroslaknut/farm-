import { Types } from 'mongoose';
import type { NotificationCategory, UnreadCounts } from '@farmplus/shared-types';
import { FarmMember, Message, Notification } from '../../models';
import { hub } from '../realtime/hub';
import { REALTIME_EVENTS } from '@farmplus/shared-types';

/** Farms where this user is on the seller side of conversations (owners and managers). */
export async function sellerFarmIds(userId: Types.ObjectId | string): Promise<Types.ObjectId[]> {
  const rows = await FarmMember.find({ userId, role: { $in: ['owner', 'manager'] } }).select(
    'farmId',
  );
  return rows.map((r) => r.farmId);
}

/** Unread chat messages for this user: sent by the other side, in conversations they take part in. */
export async function unreadMessages(userId: Types.ObjectId | string): Promise<number> {
  const farmIds = await sellerFarmIds(userId);
  const [asBuyer, asSeller] = await Promise.all([
    Message.countDocuments({ buyerId: userId, side: 'seller', readAt: null }),
    farmIds.length
      ? Message.countDocuments({ farmId: { $in: farmIds }, side: 'buyer', readAt: null })
      : 0,
  ]);
  return asBuyer + asSeller;
}

/** Always recalculated from the stored rows, never incremented, so the counters cannot drift. */
export async function unreadCounts(userId: Types.ObjectId | string): Promise<UnreadCounts> {
  const [rows, messages] = await Promise.all([
    Notification.aggregate<{ _id: NotificationCategory; n: number }>([
      { $match: { userId: new Types.ObjectId(String(userId)), readAt: null } },
      { $group: { _id: '$category', n: { $sum: 1 } } },
    ]),
    unreadMessages(userId),
  ]);
  const byCategory: Partial<Record<NotificationCategory, number>> = {};
  let total = 0;
  for (const r of rows) {
    byCategory[r._id] = r.n;
    total += r.n;
  }
  return { notifications: total, messages, byCategory };
}

/** Tell the user's open tabs the current counters. */
export async function pushUnread(userId: Types.ObjectId | string): Promise<void> {
  if (!hub.attached) return;
  hub.toUser(String(userId), REALTIME_EVENTS.unread, await unreadCounts(userId));
}
