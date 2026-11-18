import { Types } from 'mongoose';
import type {
  ChatSide,
  MessageReportAction,
  MessageReportDTO,
  MessageReportStatus,
  ReportReason,
} from '@farmplus/shared-types';
import type { Actor } from '../../context';
import { conflict, forbidden, notFound } from '../../lib/errors';
import { ChatRestriction, Message, MessageReport, User, type MessageReportDoc } from '../../models';
import { recordAudit } from '../../services/audit.service';
import { notify } from '../notifications/service';
import { accessConversation } from './chat.service';

const oid = (v: string | Types.ObjectId) => (typeof v === 'string' ? new Types.ObjectId(v) : v);
const isDuplicate = (e: unknown): boolean => (e as { code?: number })?.code === 11000;
const CONTEXT_MESSAGES = 4;

/**
 * A participant reports the other side. The reported message and a few before it are COPIED into the report: it is
 * the only chat text a moderator ever sees, and only because a participant chose to share it. Moderators cannot
 * browse conversations.
 */
export async function reportMessage(
  actor: Actor,
  conversationId: Types.ObjectId,
  input: { reason: ReportReason; details?: string | undefined; messageId?: string | undefined },
): Promise<{ id: string }> {
  const access = await accessConversation(actor.userId, conversationId);
  if (!access) throw notFound('Conversation not found');
  const { conv, role } = access;
  const other: ChatSide = role === 'buyer' ? 'seller' : 'buyer';

  const target = input.messageId
    ? await Message.findOne({ _id: input.messageId, conversationId: conv._id })
    : await Message.findOne({ conversationId: conv._id, side: other }).sort({ seq: -1 });
  if (!target) throw notFound('Message not found');
  if (target.side !== other)
    throw conflict('You can only report messages from the other side', 'OWN_MESSAGE');

  const context = await Message.find({ conversationId: conv._id, seq: { $lte: target.seq } })
    .sort({ seq: -1 })
    .limit(CONTEXT_MESSAGES + 1);
  try {
    const report = await MessageReport.create({
      reporterId: oid(actor.userId),
      reporterSide: role,
      conversationId: conv._id,
      farmId: conv.farmId,
      buyerId: conv.buyerId,
      reportedUserId: target.senderId,
      messageId: target._id,
      reason: input.reason,
      details: input.details ?? null,
      evidence: context.reverse().map((m) => ({
        side: m.side,
        senderId: m.senderId,
        body: m.body,
        at: m.createdAt,
        reported: String(m._id) === String(target._id),
      })),
    });
    await recordAudit({
      actorId: actor.userId,
      action: 'chat.report',
      targetType: 'conversation',
      targetId: conv._id,
      metadata: { reportId: String(report._id), reason: input.reason },
      ...(actor.ip ? { ip: actor.ip } : {}),
    });
    return { id: String(report._id) };
  } catch (e) {
    if (isDuplicate(e))
      throw conflict('You already have an open report about this conversation', 'ALREADY_REPORTED');
    throw e;
  }
}

async function toDTOs(rows: MessageReportDoc[]): Promise<MessageReportDTO[]> {
  const ids = new Set<string>();
  for (const r of rows) {
    ids.add(String(r.reporterId));
    ids.add(String(r.reportedUserId));
    for (const e of r.evidence) ids.add(String(e.senderId));
  }
  const users = await User.find({ _id: { $in: [...ids].map(oid) } }).select('displayName');
  const name = new Map(users.map((u) => [String(u._id), u.displayName]));
  return rows.map((r) => ({
    id: String(r._id),
    status: r.status,
    reason: r.reason,
    details: r.details ?? null,
    reporterName: name.get(String(r.reporterId)) ?? 'Member',
    reportedName: name.get(String(r.reportedUserId)) ?? 'Member',
    reportedUserId: String(r.reportedUserId),
    evidence: r.evidence.map((e) => ({
      side: e.side,
      senderName: name.get(String(e.senderId)) ?? 'Member',
      body: e.body,
      at: e.at.toISOString(),
      reported: e.reported,
    })),
    resolution: r.resolution
      ? {
          action: r.resolution.action,
          note: r.resolution.note ?? null,
          at: r.resolution.at.toISOString(),
        }
      : null,
    createdAt: r.createdAt.toISOString(),
  }));
}

export async function listReports(q: {
  status?: MessageReportStatus | undefined;
  cursor?: string | undefined;
  limit?: number | undefined;
}): Promise<{ items: MessageReportDTO[]; nextCursor?: string }> {
  const limit = q.limit ?? 20;
  const rows = await MessageReport.find({
    ...(q.status ? { status: q.status } : {}),
    ...(q.cursor ? { _id: { $lt: oid(q.cursor) } } : {}),
  })
    .sort({ _id: -1 })
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  return {
    items: await toDTOs(page),
    ...(rows.length > limit ? { nextCursor: String(page[page.length - 1]!._id) } : {}),
  };
}

export async function getReport(id: Types.ObjectId): Promise<MessageReportDTO> {
  const r = await MessageReport.findById(id);
  if (!r) throw notFound('Report not found');
  return (await toDTOs([r]))[0]!;
}

export async function resolveReport(
  actor: Actor,
  id: Types.ObjectId,
  input: { action: MessageReportAction; note?: string | undefined },
): Promise<MessageReportDTO> {
  const r = await MessageReport.findById(id);
  if (!r) throw notFound('Report not found');
  // A moderator who is part of the conversation (reporter, reported, or any participant of either side, e.g. a
  // manager of the farm) cannot judge its report.
  if (
    String(r.reporterId) === actor.userId ||
    String(r.reportedUserId) === actor.userId ||
    (await accessConversation(actor.userId, r.conversationId))
  )
    throw forbidden('You cannot resolve a report you are part of', 'SELF_MODERATION');
  const now = new Date();
  const done = await MessageReport.findOneAndUpdate(
    { _id: id, status: 'open' },
    {
      $set: {
        status: input.action === 'dismiss' ? 'dismissed' : 'actioned',
        resolvedBy: oid(actor.userId),
        resolution: { action: input.action, note: input.note ?? null, at: now },
      },
    },
    { returnDocument: 'after' },
  );
  if (!done) throw conflict('This report was already resolved', 'ALREADY_RESOLVED');
  if (input.action === 'restrict_messaging')
    await ChatRestriction.updateOne(
      { userId: r.reportedUserId },
      {
        $setOnInsert: {
          userId: r.reportedUserId,
          reason: `Report ${r._id}: ${r.reason}`,
          by: oid(actor.userId),
          createdAt: now,
        },
      },
      { upsert: true },
    );
  await recordAudit({
    actorId: actor.userId,
    action: 'chat.report_resolved',
    targetType: 'message_report',
    targetId: r._id,
    metadata: { action: input.action, reportedUserId: String(r.reportedUserId) },
    ...(actor.ip ? { ip: actor.ip } : {}),
  });
  await notify({
    to: [r.reporterId],
    type: 'moderation.message_report_resolved',
    params: { outcome: input.action === 'dismiss' ? 'no action needed' : 'action taken' },
    eventKey: `msgreport:${r._id}`,
  });
  if (input.action !== 'dismiss')
    await notify({
      to: [r.reportedUserId],
      type: 'moderation.message_warning',
      params: undefined as never,
      eventKey: `msgwarn:${r._id}`,
    });
  return (await toDTOs([done]))[0]!;
}

export async function liftRestriction(actor: Actor, userId: Types.ObjectId): Promise<void> {
  if (String(userId) === actor.userId)
    throw forbidden('You cannot lift a restriction on yourself', 'SELF_MODERATION');
  const res = await ChatRestriction.deleteOne({ userId });
  if (res.deletedCount !== 1) throw notFound('No restriction on this user');
  await recordAudit({
    actorId: actor.userId,
    action: 'chat.restriction_lifted',
    targetType: 'user',
    targetId: userId,
    ...(actor.ip ? { ip: actor.ip } : {}),
  });
}
