import { Types } from 'mongoose';
import {
  CHAT_LIMITS,
  REALTIME_EVENTS,
  type ChatSide,
  type ConversationDTO,
  type MessageDTO,
  type MessagePage,
} from '@farmplus/shared-types';
import type { Actor } from '../../context';
import { conflict, forbidden, HttpError, notFound } from '../../lib/errors';
import {
  ChatBlock,
  ChatRestriction,
  Conversation,
  Farm,
  Listing,
  Message,
  Product,
  User,
  type ConversationDoc,
  type MessageDoc,
} from '../../models';
import { recordAudit } from '../../services/audit.service';
import { sellerSideUserIds } from '../notifications/events';
import { notify } from '../notifications/service';
import { pushUnread, sellerFarmIds } from '../notifications/unread';
import { hub } from '../realtime/hub';
import { getNumberSetting } from '../settings/settings.service';

const isDuplicate = (e: unknown): boolean => (e as { code?: number })?.code === 11000;
const oid = (v: string | Types.ObjectId) => (typeof v === 'string' ? new Types.ObjectId(v) : v);

// ---------------------------------------------------------------------------
// Who may see a conversation
// ---------------------------------------------------------------------------
export interface Access {
  conv: ConversationDoc;
  /** The caller's side. Decided live from the database on every call: removing someone from a farm ends their access at once. */
  role: ChatSide;
}

/**
 * The single authorization gate for everything inside a conversation (REST and realtime). The buyer is the one
 * `buyerId`; the seller side is the farm's current owners and managers. Everyone else — including platform staff,
 * who only ever see reported evidence — gets "not found", so conversation ids cannot be probed.
 */
export async function accessConversation(
  userId: string,
  id: Types.ObjectId,
): Promise<Access | null> {
  const conv = await Conversation.findById(id);
  if (!conv) return null;
  if (String(conv.buyerId) === userId) return { conv, role: 'buyer' };
  const ids = await sellerSideUserIds(conv.farmId);
  return ids.includes(userId) ? { conv, role: 'seller' } : null;
}

async function loadAccess(actor: Actor, id: Types.ObjectId): Promise<Access> {
  const a = await accessConversation(actor.userId, id);
  if (!a) throw notFound('Conversation not found');
  return a;
}

// ---------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------
async function nameMap(ids: Types.ObjectId[]): Promise<Map<string, string>> {
  const users = await User.find({ _id: { $in: ids } }).select('displayName');
  return new Map(users.map((u) => [String(u._id), u.displayName]));
}

export function toMessageDTOs(
  rows: MessageDoc[],
  role: ChatSide,
  names: Map<string, string>,
): MessageDTO[] {
  return rows.map((m) => ({
    id: String(m._id),
    conversationId: String(m.conversationId),
    seq: m.seq,
    side: m.side,
    mine: m.side === role,
    senderName: names.get(String(m.senderId)) ?? 'Member',
    body: m.body,
    createdAt: m.createdAt.toISOString(),
    readAt: m.side === role ? (m.readAt?.toISOString() ?? null) : null,
  }));
}

async function toConversationDTOs(
  userId: string,
  convs: ConversationDoc[],
): Promise<ConversationDTO[]> {
  if (convs.length === 0) return [];
  const farmIds = [...new Set(convs.map((c) => String(c.farmId)))].map(oid);
  const [farms, buyers, unread, blocks] = await Promise.all([
    Farm.find({ _id: { $in: farmIds } }).select('name'),
    nameMap(convs.map((c) => c.buyerId)),
    Message.aggregate<{ _id: { c: Types.ObjectId; side: ChatSide }; n: number }>([
      { $match: { conversationId: { $in: convs.map((c) => c._id) }, readAt: null } },
      { $group: { _id: { c: '$conversationId', side: '$side' }, n: { $sum: 1 } } },
    ]),
    ChatBlock.find({ $or: convs.map((c) => ({ farmId: c.farmId, buyerId: c.buyerId })) }),
  ]);
  const farmName = new Map(farms.map((f) => [String(f._id), f.name]));
  return convs.map((c) => {
    const role: ChatSide = String(c.buyerId) === userId ? 'buyer' : 'seller';
    const other: ChatSide = role === 'buyer' ? 'seller' : 'buyer';
    const mine = blocks.filter(
      (b) => String(b.farmId) === String(c.farmId) && String(b.buyerId) === String(c.buyerId),
    );
    const byMe = mine.some((b) => b.by === role);
    const byOther = mine.some((b) => b.by === other);
    return {
      id: String(c._id),
      farmId: String(c.farmId),
      farmName: farmName.get(String(c.farmId)) ?? 'Farm',
      myRole: role,
      counterpartName:
        role === 'buyer'
          ? (farmName.get(String(c.farmId)) ?? 'Farm')
          : (buyers.get(String(c.buyerId)) ?? 'Buyer'),
      subject: c.subject
        ? { type: c.subject.type, id: String(c.subject.id), title: c.subject.title }
        : null,
      lastMessage: c.lastMessage
        ? {
            preview: c.lastMessage.preview,
            at: c.lastMessage.at.toISOString(),
            side: c.lastMessage.side,
          }
        : null,
      // messages sent BY THE OTHER SIDE that nobody on my side has read
      unread: unread.find((u) => String(u._id.c) === String(c._id) && u._id.side === other)?.n ?? 0,
      blocked: byMe ? 'byYou' : byOther ? 'unavailable' : null,
      createdAt: c.createdAt.toISOString(),
    };
  });
}

// ---------------------------------------------------------------------------
// Rules for sending
// ---------------------------------------------------------------------------
async function assertMaySend(
  userId: string,
  conv: Pick<ConversationDoc, 'farmId' | 'buyerId'>,
): Promise<void> {
  if (await ChatRestriction.exists({ userId: oid(userId) }))
    throw forbidden('Messaging is restricted on your account', 'CHAT_RESTRICTED');
  // Either side's block stops both directions. The blocked person is not told who blocked or why.
  if (await ChatBlock.exists({ farmId: conv.farmId, buyerId: conv.buyerId }))
    throw forbidden('You cannot send messages in this conversation', 'CHAT_UNAVAILABLE');
  const farm = await Farm.findById(conv.farmId).select('status');
  if (!farm || farm.status === 'archived')
    throw conflict('This farm is not taking messages', 'FARM_UNAVAILABLE');
}

async function assertSendRate(userId: string): Promise<void> {
  const limit = await getNumberSetting('chat.messagesPerMinute', 1, 120);
  const recent = await Message.countDocuments({
    senderId: oid(userId),
    createdAt: { $gte: new Date(Date.now() - 60_000) },
  });
  if (recent >= limit)
    throw new HttpError(
      429,
      'CHAT_RATE_LIMITED',
      'You are sending messages too quickly. Please wait a moment.',
    );
}

const preview = (body: string) => body.replace(/\s+/g, ' ').slice(0, CHAT_LIMITS.preview);

// ---------------------------------------------------------------------------
// Conversations
// ---------------------------------------------------------------------------
export async function startConversation(
  actor: Actor,
  input: { listingId?: string | undefined; productId?: string | undefined; message: string },
): Promise<{ conversation: ConversationDTO; message: MessageDTO }> {
  let farmId: Types.ObjectId;
  let subject: { type: 'listing' | 'product'; id: Types.ObjectId; title: string };
  if (input.listingId) {
    const l = await Listing.findById(input.listingId).select('farmId title status');
    if (!l || l.status !== 'ACTIVE') throw notFound('Listing not found');
    farmId = l.farmId;
    subject = { type: 'listing', id: l._id, title: l.title };
  } else {
    const p = await Product.findById(input.productId).select('farmId title status');
    if (!p || p.status !== 'ACTIVE') throw notFound('Product not found');
    farmId = p.farmId;
    subject = { type: 'product', id: p._id, title: p.title };
  }
  if ((await sellerSideUserIds(farmId)).includes(actor.userId))
    throw conflict('You cannot message your own farm', 'OWN_FARM');

  const buyerId = oid(actor.userId);
  let conv = await Conversation.findOne({ buyerId, farmId });
  if (!conv) {
    const perDay = await getNumberSetting('chat.newConversationsPerDay', 1, 200);
    const started = await Conversation.countDocuments({
      buyerId,
      createdAt: { $gte: new Date(Date.now() - 24 * 3600_000) },
    });
    if (started >= perDay)
      throw new HttpError(
        429,
        'CHAT_RATE_LIMITED',
        'You have started too many conversations today',
      );
  }
  await assertMaySend(actor.userId, { farmId, buyerId });
  try {
    conv = await Conversation.findOneAndUpdate(
      { buyerId, farmId },
      {
        $set: { subject },
        $setOnInsert: {
          buyerId,
          farmId,
          messageSeq: 0,
          lastMessageAt: new Date(),
          createdAt: new Date(),
        },
      },
      { upsert: true, returnDocument: 'after' },
    );
  } catch (e) {
    if (!isDuplicate(e)) throw e;
    conv = await Conversation.findOne({ buyerId, farmId });
  }
  if (!conv) throw notFound('Conversation not found');
  const message = await sendMessage(actor, conv._id, { body: input.message });
  const refreshed = (await Conversation.findById(conv._id))!;
  return { conversation: (await toConversationDTOs(actor.userId, [refreshed]))[0]!, message };
}

export async function listConversations(
  actor: Actor,
  q: { cursor?: string | undefined; limit?: number | undefined; unread?: boolean | undefined },
): Promise<{ items: ConversationDTO[]; nextCursor?: string }> {
  const limit = q.limit ?? 20;
  const farmIds = await sellerFarmIds(actor.userId);
  const mine = {
    $or: [
      { buyerId: oid(actor.userId) },
      ...(farmIds.length ? [{ farmId: { $in: farmIds } }] : []),
    ],
  };
  const conds: object[] = [mine];
  if (q.cursor) {
    const [ts, id] = q.cursor.split('_') as [string, string];
    const at = new Date(Number(ts));
    conds.push({
      $or: [{ lastMessageAt: { $lt: at } }, { lastMessageAt: at, _id: { $lt: oid(id) } }],
    });
  }
  const rows = await Conversation.find({ $and: conds })
    .sort({ lastMessageAt: -1, _id: -1 })
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  let items = await toConversationDTOs(actor.userId, page);
  if (q.unread) items = items.filter((c) => c.unread > 0);
  const last = page[page.length - 1];
  return {
    items,
    ...(rows.length > limit && last
      ? { nextCursor: `${last.lastMessageAt.getTime()}_${last._id}` }
      : {}),
  };
}

export async function getConversation(actor: Actor, id: Types.ObjectId): Promise<ConversationDTO> {
  const { conv } = await loadAccess(actor, id);
  return (await toConversationDTOs(actor.userId, [conv]))[0]!;
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------
export async function listMessages(
  actor: Actor,
  id: Types.ObjectId,
  q: { before?: number | undefined; after?: number | undefined; limit?: number | undefined },
): Promise<MessagePage> {
  const { conv, role } = await loadAccess(actor, id);
  const limit = q.limit ?? 30;
  const filter: Record<string, unknown> = { conversationId: conv._id };
  let rows: MessageDoc[];
  let hasMore: boolean;
  if (q.after !== undefined) {
    // catching up after a gap (a dropped connection): everything newer than what the client already has
    rows = await Message.find({ ...filter, seq: { $gt: q.after } })
      .sort({ seq: 1 })
      .limit(limit + 1);
    hasMore = rows.length > limit;
    rows = rows.slice(0, limit);
  } else {
    if (q.before) filter['seq'] = { $lt: q.before };
    const found = await Message.find(filter)
      .sort({ seq: -1 })
      .limit(limit + 1);
    hasMore = found.length > limit;
    rows = found.slice(0, limit).reverse();
  }
  const names = await nameMap([...new Set(rows.map((m) => String(m.senderId)))].map(oid));
  return { items: toMessageDTOs(rows, role, names), hasMore };
}

export async function sendMessage(
  actor: Actor,
  id: Types.ObjectId,
  input: { body: string; clientId?: string | undefined },
): Promise<MessageDTO> {
  const { conv, role } = await loadAccess(actor, id);
  const sender = oid(actor.userId);
  if (input.clientId) {
    // A retried request (flaky connection) returns the original instead of sending twice.
    const prior = await Message.findOne({
      conversationId: conv._id,
      senderId: sender,
      clientId: input.clientId,
    });
    if (prior) return (await toMessageDTOs([prior], role, await nameMap([sender])))[0]!;
  }
  await assertMaySend(actor.userId, conv);
  await assertSendRate(actor.userId);

  const bumped = await Conversation.findOneAndUpdate(
    { _id: conv._id },
    { $inc: { messageSeq: 1 } },
    { returnDocument: 'after' },
  );
  if (!bumped) throw notFound('Conversation not found');
  let msg: MessageDoc;
  try {
    msg = await Message.create({
      conversationId: conv._id,
      farmId: conv.farmId,
      buyerId: conv.buyerId,
      seq: bumped.messageSeq,
      side: role,
      senderId: sender,
      body: input.body,
      clientId: input.clientId ?? null,
    });
  } catch (e) {
    if (isDuplicate(e) && input.clientId) {
      const prior = await Message.findOne({
        conversationId: conv._id,
        senderId: sender,
        clientId: input.clientId,
      });
      if (prior) return toMessageDTOs([prior], role, await nameMap([sender]))[0]!;
    }
    throw e;
  }
  await Conversation.updateOne(
    { _id: conv._id },
    {
      $set: {
        lastMessage: { preview: preview(input.body), side: role, at: msg.createdAt },
        lastMessageAt: msg.createdAt,
      },
    },
  );
  const names = await nameMap([sender]);
  const dto = toMessageDTOs([msg], role, names)[0]!;
  await announceMessage(conv, role, msg, names.get(String(sender)) ?? 'Member');
  return dto;
}

/** Notify the other side (folded into one notification per conversation while unread) and push to open tabs. */
async function announceMessage(
  conv: ConversationDoc,
  role: ChatSide,
  msg: MessageDoc,
  senderName: string,
): Promise<void> {
  const generic = {
    conversationId: String(conv._id),
    message: {
      id: String(msg._id),
      conversationId: String(conv._id),
      seq: msg.seq,
      side: msg.side,
      senderName,
      body: msg.body,
      createdAt: msg.createdAt.toISOString(),
    },
  };
  hub.toConversation(String(conv._id), REALTIME_EVENTS.message, generic);
  const recipients =
    role === 'buyer' ? await sellerSideUserIds(conv.farmId) : [String(conv.buyerId)];
  const farm = await Farm.findById(conv.farmId).select('name');
  const who = role === 'buyer' ? senderName : (farm?.name ?? 'the farm');
  await notify({
    to: recipients,
    exclude: [msg.senderId],
    type: 'message.new',
    params: { who, link: `/messages/${conv._id}` },
    groupKey: `msg:${conv._id}`,
  });
  for (const r of recipients) {
    hub.toUser(r, REALTIME_EVENTS.conversation, { conversationId: String(conv._id) });
    await pushUnread(r);
  }
}

/** Mark everything the other side sent as read. For the seller side the read state is shared by the whole team. */
export async function markConversationRead(
  actor: Actor,
  id: Types.ObjectId,
): Promise<{ updated: number }> {
  const { conv, role } = await loadAccess(actor, id);
  const other: ChatSide = role === 'buyer' ? 'seller' : 'buyer';
  const now = new Date();
  const res = await Message.updateMany(
    { conversationId: conv._id, side: other, readAt: null },
    { $set: { readAt: now } },
  );
  if (res.modifiedCount > 0) {
    hub.toConversation(String(conv._id), REALTIME_EVENTS.read, {
      conversationId: String(conv._id),
      readerSide: role,
      upToSeq: conv.messageSeq,
      at: now.toISOString(),
    });
    const mates = role === 'buyer' ? [actor.userId] : await sellerSideUserIds(conv.farmId);
    for (const u of mates) await pushUnread(u);
  }
  return { updated: res.modifiedCount };
}

// ---------------------------------------------------------------------------
// Blocking
// ---------------------------------------------------------------------------
export async function blockConversation(
  actor: Actor,
  id: Types.ObjectId,
): Promise<ConversationDTO> {
  const { conv, role } = await loadAccess(actor, id);
  try {
    await ChatBlock.create({
      farmId: conv.farmId,
      buyerId: conv.buyerId,
      by: role,
      actorId: oid(actor.userId),
    });
  } catch (e) {
    if (!isDuplicate(e)) throw e; // already blocked by this side: nothing to do
  }
  await recordAudit({
    actorId: actor.userId,
    action: 'chat.block',
    targetType: 'conversation',
    targetId: conv._id,
    metadata: { side: role },
    ...(actor.ip ? { ip: actor.ip } : {}),
  });
  return getConversation(actor, id);
}

export async function unblockConversation(
  actor: Actor,
  id: Types.ObjectId,
): Promise<ConversationDTO> {
  const { conv, role } = await loadAccess(actor, id);
  await ChatBlock.deleteOne({ farmId: conv.farmId, buyerId: conv.buyerId, by: role }); // you can only lift your own side's block
  await recordAudit({
    actorId: actor.userId,
    action: 'chat.unblock',
    targetType: 'conversation',
    targetId: conv._id,
    metadata: { side: role },
    ...(actor.ip ? { ip: actor.ip } : {}),
  });
  return getConversation(actor, id);
}
