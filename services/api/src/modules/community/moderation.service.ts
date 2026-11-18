import type { Types } from 'mongoose';
import { notify } from '../notifications/service';
import type {
  ContentStatus,
  CursorPage,
  ModerationAction,
  ModerationHistoryDTO,
  ReportDTO,
  ReportReason,
  ReportStatus,
  ReportTarget,
} from '@farmplus/shared-types';
import type { Actor } from '../../context';
import { conflict, forbidden, notFound } from '../../lib/errors';
import {
  ACTIVE_LIVE_STATES,
  Comment,
  ContentReport,
  LiveSession,
  Media,
  Post,
  type ContentReportDoc,
} from '../../models';
import { loadVisibleLive } from '../media/live-access';
import type { VideoProvider } from '../media/provider';
import { loadVisibleVideo } from '../media/video-access';
import type { ModerationEntryAttrs } from '../../models/post.model';
import { recordAudit } from '../../services/audit.service';
import { loadVisibleComment, transitionComment } from './comments.service';
import { loadVisiblePost } from './posts.service';
import {
  authorOf,
  authorsById,
  decodeCursor,
  encodeCursor,
  isDuplicateKey,
  toModerationEntry,
} from './shared';

const actorId = (a: Actor) => a.userId as unknown as Types.ObjectId;

// ---------------------------------------------------------------------------
// Reporting (any member who can see the content)
// ---------------------------------------------------------------------------
export async function reportContent(
  actor: Actor,
  targetType: ReportTarget,
  targetId: Types.ObjectId,
  input: { reason: ReportReason; details?: string | undefined },
): Promise<{ reported: true }> {
  let postId: Types.ObjectId;
  let authorId: Types.ObjectId;
  let body: string;
  let media: { kind: string; url: string }[] = [];
  let containerType: 'post' | 'video' | 'live' = 'post';
  if (targetType === 'post') {
    const post = await loadVisiblePost(actor, targetId);
    if (post.status !== 'published') throw notFound('Post not found');
    postId = post._id;
    authorId = post.authorId;
    body = post.body;
    media = post.media.map((m) => ({ kind: m.kind, url: m.url }));
  } else if (targetType === 'video') {
    const video = await loadVisibleVideo(actor, targetId);
    if (video.status !== 'published') throw notFound('Video not found');
    postId = video._id;
    authorId = video.ownerId;
    body = [video.title, video.caption].filter(Boolean).join('\n');
    containerType = 'video';
  } else if (targetType === 'live') {
    const live = await loadVisibleLive(actor, targetId);
    if (live.status !== 'published') throw notFound('Live stream not found');
    postId = live._id;
    authorId = live.hostId;
    body = [live.title, live.description].filter(Boolean).join('\n');
    containerType = 'live';
  } else {
    const comment = await loadVisibleComment(actor, targetId);
    if (comment.status !== 'published') throw notFound('Comment not found');
    postId = comment.postId;
    authorId = comment.authorId;
    body = comment.body;
    containerType = comment.targetType ?? 'post';
  }
  if (String(authorId) === actor.userId)
    throw conflict('You cannot report your own content', 'CANNOT_REPORT_OWN');
  try {
    const report = await ContentReport.create({
      reporterId: actor.userId,
      targetType,
      targetId,
      postId,
      containerType,
      targetAuthorId: authorId,
      reason: input.reason,
      details: input.details ?? null,
      snapshot: { body, media },
    });
    await recordAudit({
      actorId: actor.userId,
      action: 'content.reported',
      targetType,
      targetId,
      metadata: { reportId: String(report._id), reason: input.reason },
      ip: actor.ip,
    });
  } catch (error) {
    if (isDuplicateKey(error)) throw conflict('You have already reported this', 'ALREADY_REPORTED');
    throw error;
  }
  return { reported: true };
}

// ---------------------------------------------------------------------------
// Moderator queue (route layer requires `content.moderate`)
// ---------------------------------------------------------------------------
async function toReportDTOs(reports: ContentReportDoc[]): Promise<ReportDTO[]> {
  const people = await authorsById([
    ...reports.map((r) => r.reporterId),
    ...reports.map((r) => r.targetAuthorId),
  ]);
  const posts = await Post.find({
    _id: { $in: reports.filter((r) => r.targetType === 'post').map((r) => r.targetId) },
  }).select('status');
  const comments = await Comment.find({
    _id: { $in: reports.filter((r) => r.targetType === 'comment').map((r) => r.targetId) },
  }).select('status');
  const videos = await Media.find({
    _id: { $in: reports.filter((r) => r.targetType === 'video').map((r) => r.targetId) },
  }).select('status');
  const lives = await LiveSession.find({
    _id: { $in: reports.filter((r) => r.targetType === 'live').map((r) => r.targetId) },
  }).select('status');
  const status = new Map<string, ContentStatus>(
    [...posts, ...comments, ...videos, ...lives].map((d) => [String(d._id), d.status]),
  );
  const counts = new Map<string, number>();
  await Promise.all(
    reports.map(async (r) => {
      const key = `${r.targetType}:${String(r.targetId)}`;
      if (!counts.has(key))
        counts.set(
          key,
          await ContentReport.countDocuments({
            targetType: r.targetType,
            targetId: r.targetId,
            status: 'open',
          }),
        );
    }),
  );
  const resolvers = await authorsById(reports.flatMap((r) => (r.resolvedBy ? [r.resolvedBy] : [])));
  return reports.map((r) => ({
    id: String(r._id),
    targetType: r.targetType,
    targetId: String(r.targetId),
    postId: String(r.postId),
    containerType: r.containerType ?? 'post',
    reason: r.reason,
    details: r.details ?? null,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
    reporter: authorOf(people, r.reporterId),
    snapshot: {
      body: r.snapshot.body,
      author: authorOf(people, r.targetAuthorId),
      media: r.snapshot.media.map((m, i) => ({
        id: String(i),
        kind: m.kind as 'image' | 'video',
        url: m.url,
      })),
    },
    targetStatus: status.get(String(r.targetId)) ?? 'deleted',
    reportsOnTarget: counts.get(`${r.targetType}:${String(r.targetId)}`) ?? 0,
    ...(r.resolution && r.resolvedAt && r.resolvedBy
      ? {
          resolution: {
            action: r.resolution.action,
            note: r.resolution.note ?? null,
            by: authorOf(resolvers, r.resolvedBy).displayName,
            at: r.resolvedAt.toISOString(),
          },
        }
      : {}),
  }));
}

export async function listReports(query: {
  cursor?: string | undefined;
  limit: number;
  status: ReportStatus;
}): Promise<CursorPage<ReportDTO>> {
  const cursor = decodeCursor(query.cursor);
  const and: Record<string, unknown>[] = [{ status: query.status }];
  if (cursor)
    and.push({
      $or: [
        { createdAt: { $lt: new Date(cursor.k) } },
        { createdAt: new Date(cursor.k), _id: { $lt: cursor.id } },
      ],
    });
  const rows = await ContentReport.find({ $and: and })
    .sort({ createdAt: -1, _id: -1 })
    .limit(query.limit + 1);
  const page = rows.slice(0, query.limit);
  const last = page[page.length - 1];
  const nextCursor =
    rows.length > query.limit && last
      ? encodeCursor(last.createdAt.getTime(), last._id)
      : undefined;
  return { items: await toReportDTOs(page), ...(nextCursor ? { nextCursor } : {}) };
}

export async function getReport(id: Types.ObjectId): Promise<ReportDTO> {
  const report = await ContentReport.findById(id);
  if (!report) throw notFound('Report not found');
  return (await toReportDTOs([report]))[0]!;
}

// ---------------------------------------------------------------------------
// Acting on content
// ---------------------------------------------------------------------------
type ModStatus = 'published' | 'hidden' | 'removed';

/** Change what everyone sees. Never resurrects something the author deleted. */
export async function moderateContent(
  actor: Actor,
  targetType: ReportTarget,
  id: Types.ObjectId,
  to: ModStatus,
  reason: string,
  video?: VideoProvider,
): Promise<{ status: ContentStatus; changed: boolean }> {
  const entry: ModerationEntryAttrs = {
    at: new Date(),
    by: actorId(actor),
    action: to === 'published' ? 'restored' : to,
    reason,
  };
  const from: ContentStatus[] = ['published', 'hidden', 'removed'];
  let authorId: Types.ObjectId;
  let changed: boolean;
  if (targetType === 'post') {
    const doc = await Post.findById(id).select('authorId status');
    if (!doc) throw notFound('Post not found');
    authorId = doc.authorId;
    if (String(authorId) === actor.userId)
      throw forbidden('You cannot moderate your own content', 'SELF_MODERATION');
    if (doc.status === 'deleted') throw conflict('The author deleted this', 'ALREADY_DELETED');
    const before = await Post.findOneAndUpdate(
      { _id: id, status: { $in: from } },
      { $set: { status: to }, $push: { moderation: { ...entry, to } } },
      { returnDocument: 'before' },
    );
    if (!before) throw conflict('The author deleted this', 'ALREADY_DELETED');
    changed = before.status !== to;
  } else if (targetType === 'video') {
    const doc = await Media.findById(id).select('ownerId status');
    if (!doc) throw notFound('Video not found');
    authorId = doc.ownerId;
    if (String(authorId) === actor.userId)
      throw forbidden('You cannot moderate your own content', 'SELF_MODERATION');
    if (doc.status === 'deleted') throw conflict('The author deleted this', 'ALREADY_DELETED');
    const before = await Media.findOneAndUpdate(
      { _id: id, status: { $in: from } },
      { $set: { status: to }, $push: { moderation: { ...entry, to } } },
      { returnDocument: 'before' },
    );
    if (!before) throw conflict('The author deleted this', 'ALREADY_DELETED');
    changed = before.status !== to;
  } else if (targetType === 'live') {
    const doc = await LiveSession.findById(id);
    if (!doc) throw notFound('Live stream not found');
    authorId = doc.hostId;
    if (String(authorId) === actor.userId)
      throw forbidden('You cannot moderate your own content', 'SELF_MODERATION');
    // Taking a stream down also stops it: the provider input is removed so the encoder can no longer broadcast.
    const stopping = to !== 'published' && ACTIVE_LIVE_STATES.includes(doc.state);
    const before = await LiveSession.findOneAndUpdate(
      { _id: id },
      {
        $set: {
          status: to,
          ...(stopping ? { state: 'ended', endedAt: new Date(), endReason: 'moderator' } : {}),
        },
        $push: { moderation: { ...entry, to } },
      },
      { returnDocument: 'before' },
    );
    changed = before?.status !== to;
    if (stopping && video) await video.deleteLiveInput(doc.providerInputId).catch(() => undefined);
  } else {
    const doc = await Comment.findById(id).select('authorId status');
    if (!doc) throw notFound('Comment not found');
    authorId = doc.authorId;
    if (String(authorId) === actor.userId)
      throw forbidden('You cannot moderate your own content', 'SELF_MODERATION');
    if (doc.status === 'deleted') throw conflict('The author deleted this', 'ALREADY_DELETED');
    const result = await transitionComment(id, from, to, entry);
    if (!result) throw conflict('The author deleted this', 'ALREADY_DELETED');
    changed = result.changed;
  }
  await recordAudit({
    actorId: actor.userId,
    action: `moderation.${entry.action}`,
    targetType,
    targetId: id,
    metadata: { authorId: String(authorId), reason, changed },
    ip: actor.ip,
  });
  if (changed) {
    const kind = targetType === 'live' ? 'live stream' : targetType;
    await notify(
      to === 'published'
        ? { to: [authorId], type: 'moderation.content_restored', params: { kind } }
        : {
            to: [authorId],
            type: to === 'hidden' ? 'moderation.content_hidden' : 'moderation.content_removed',
            params: { kind, reason },
          },
    );
  }
  return { status: to, changed };
}

export async function resolveReport(
  actor: Actor,
  id: Types.ObjectId,
  input: { action: ModerationAction; note?: string | undefined },
  video?: VideoProvider,
): Promise<ReportDTO> {
  const report = await ContentReport.findById(id);
  if (!report) throw notFound('Report not found');
  if (report.status !== 'open')
    throw conflict('This report was already resolved', 'ALREADY_RESOLVED');
  if (String(report.reporterId) === actor.userId)
    throw forbidden('You cannot resolve a report you filed', 'SELF_MODERATION');
  // Acting on content checks the author in moderateContent; dismissing must not let an author clear reports about their own content.
  if (String(report.targetAuthorId) === actor.userId)
    throw forbidden('You cannot moderate your own content', 'SELF_MODERATION');

  const resolution = { action: input.action, note: input.note ?? null };
  const final = input.action === 'dismiss' ? 'dismissed' : 'actioned';
  // Claim this report before acting, so two moderators resolving it at once cannot both act on the content.
  const mine = await ContentReport.findOneAndUpdate(
    { _id: id, status: 'open' },
    { $set: { status: final, resolvedBy: actor.userId, resolvedAt: new Date(), resolution } },
  );
  if (!mine) throw conflict('This report was already resolved', 'ALREADY_RESOLVED');

  if (input.action !== 'dismiss') {
    try {
      await moderateContent(
        actor,
        report.targetType,
        report.targetId,
        input.action === 'hide' ? 'hidden' : 'removed',
        input.note ?? `Report: ${report.reason}`,
        video,
      );
    } catch (error) {
      // Author already deleted it: the report is still resolved (nothing left to act on).
      if ((error as { code?: string }).code !== 'ALREADY_DELETED') {
        // The action failed: hand the report back so it can be resolved again.
        await ContentReport.updateOne(
          { _id: id, status: final, resolvedBy: actor.userId },
          { $set: { status: 'open', resolvedBy: null, resolvedAt: null, resolution: null } },
        );
        throw error;
      }
    }
  }

  // An action also settles every other open report about the same content.
  const others =
    input.action === 'dismiss'
      ? { modifiedCount: 0 }
      : await ContentReport.updateMany(
          { targetType: report.targetType, targetId: report.targetId, status: 'open' },
          { $set: { status: final, resolvedBy: actor.userId, resolvedAt: new Date(), resolution } },
        );
  const claimed = { modifiedCount: 1 + others.modifiedCount };
  await recordAudit({
    actorId: actor.userId,
    action: 'report.resolved',
    targetType: report.targetType,
    targetId: report.targetId,
    metadata: { reportId: String(id), action: input.action, settled: claimed.modifiedCount },
    ip: actor.ip,
  });
  return getReport(id);
}

export async function moderationHistory(
  targetType: ReportTarget,
  id: Types.ObjectId,
): Promise<ModerationHistoryDTO> {
  const doc =
    targetType === 'post'
      ? await Post.findById(id).select('moderation')
      : targetType === 'video'
        ? await Media.findById(id).select('moderation')
        : targetType === 'live'
          ? await LiveSession.findById(id).select('moderation')
          : await Comment.findById(id).select('moderation');
  if (!doc) throw notFound('Content not found');
  const names = await authorsById(doc.moderation.map((m) => m.by));
  return {
    entries: doc.moderation.map((m) => ({
      ...toModerationEntry(m),
      byName: authorOf(names, m.by).displayName,
    })),
  };
}
