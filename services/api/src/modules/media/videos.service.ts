import type { Types } from 'mongoose';
import type {
  CursorPage,
  PlaybackInfo,
  VideoDTO,
  VideoFailureCode,
  VideoLimitsDTO,
  VideoUploadTicket,
  ViewResult,
} from '@farmplus/shared-types';
import { VIDEO_UPLOAD_MIME_TYPES } from '@farmplus/shared-types';
import type { ApiEnv } from '@farmplus/config/server';
import type { CreateVideoUploadInput } from '@farmplus/validation';
import type { Actor } from '../../context';
import { HttpError, conflict, notFound } from '../../lib/errors';
import { Follow, Media, VideoMetric, type MediaDoc } from '../../models';
import { recordAudit } from '../../services/audit.service';
import {
  MODERATION_NOTICE,
  authorOf,
  authorsById,
  decodeCursor,
  encodeCursor,
  followedSet,
  invalid,
  isDuplicateKey,
  reactedSet,
} from '../community/shared';
import { ProviderError, type ProviderAsset, type VideoProvider } from './provider';
import { loadVisibleVideo } from './video-access';

export const PLAYBACK_TTL_SECONDS = 3600;
const UPLOAD_URL_TTL_MS = 30 * 60_000;
const MAX_OPEN_UPLOADS = 5;
const MAX_UPLOADS_PER_DAY = 30;
const VIEW_WINDOW_MS = 24 * 3_600_000;
const EXTENSIONS: Record<string, string[]> = {
  'video/mp4': ['mp4', 'm4v'],
  'video/x-m4v': ['m4v', 'mp4'],
  'video/quicktime': ['mov'],
  'video/webm': ['webm'],
};

export interface VideoDeps {
  env: ApiEnv;
  video: VideoProvider;
}
export const maxUploadBytes = (env: ApiEnv): number => env.VIDEO_MAX_UPLOAD_MB * 1024 * 1024;

export const videoLimits = (env: ApiEnv, video: VideoProvider): VideoLimitsDTO => ({
  maxUploadBytes: maxUploadBytes(env),
  maxDurationSeconds: env.VIDEO_MAX_DURATION_SECONDS,
  mimeTypes: VIDEO_UPLOAD_MIME_TYPES,
  provider: video.name,
});

// ---------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------
export async function toVideoDTOs(actor: Actor, videos: MediaDoc[]): Promise<VideoDTO[]> {
  const authors = await authorsById(videos.map((v) => v.ownerId));
  const [reacted, followed] = await Promise.all([
    reactedSet(
      actor.userId,
      'video',
      videos.map((v) => v._id),
    ),
    followedSet(
      actor.userId,
      videos.map((v) => v.ownerId),
    ),
  ]);
  return videos.map((v) => {
    const isCreator = String(v.ownerId) === actor.userId;
    const notice = isCreator ? MODERATION_NOTICE[v.status] : undefined;
    return {
      id: String(v._id),
      creator: authorOf(authors, v.ownerId),
      title: v.title,
      caption: v.caption ?? null,
      visibility: v.visibility,
      status: v.status,
      processing: {
        state: v.processing.state,
        // Failure details are for the creator only.
        ...(isCreator && v.processing.failureCode
          ? {
              failure: {
                code: v.processing.failureCode,
                message: v.processing.failureMessage ?? 'The video could not be processed',
              },
            }
          : {}),
      },
      durationSeconds: v.durationSeconds ?? null,
      width: v.width ?? null,
      height: v.height ?? null,
      viewCount: v.viewCount,
      reactionCount: v.reactionCount,
      commentCount: v.commentCount,
      createdAt: v.createdAt.toISOString(),
      readyAt: v.readyAt?.toISOString() ?? null,
      viewer: {
        reacted: reacted.has(String(v._id)),
        isCreator,
        followsCreator: followed.has(String(v.ownerId)),
      },
      ...(notice ? { moderationNotice: notice } : {}),
    };
  });
}

const audit = (actor: Actor | null, action: string, video: MediaDoc, extra = {}) =>
  recordAudit({
    actorId: actor?.userId ?? null,
    action,
    targetType: 'video',
    targetId: video._id,
    metadata: extra,
    ...(actor?.ip ? { ip: actor.ip } : {}),
  });

// ---------------------------------------------------------------------------
// Upload: declare → signed URL → client uploads straight to the provider → webhook/refresh marks it ready
// ---------------------------------------------------------------------------
export async function createUpload(
  actor: Actor,
  input: CreateVideoUploadInput,
  deps: VideoDeps,
): Promise<VideoUploadTicket> {
  const max = maxUploadBytes(deps.env);
  if (input.sizeBytes > max)
    throw new HttpError(
      413,
      'FILE_TOO_LARGE',
      `Videos can be at most ${deps.env.VIDEO_MAX_UPLOAD_MB} MB`,
    );
  const ext = input.filename.split('.').pop()?.toLowerCase() ?? '';
  if (!(EXTENSIONS[input.mimeType] ?? []).includes(ext))
    throw invalid('filename', 'The file extension does not match the video type');

  const now = new Date();
  const [open, today] = await Promise.all([
    Media.countDocuments({
      ownerId: actor.userId,
      'processing.state': 'pending_upload',
      uploadExpiresAt: { $gt: now },
    }),
    Media.countDocuments({
      ownerId: actor.userId,
      createdAt: { $gt: new Date(now.getTime() - 86_400_000) },
    }),
  ]);
  if (open >= MAX_OPEN_UPLOADS)
    throw new HttpError(429, 'UPLOAD_LIMIT', 'Finish or cancel your pending uploads first');
  if (today >= MAX_UPLOADS_PER_DAY)
    throw new HttpError(429, 'UPLOAD_LIMIT', 'Daily upload limit reached');

  const expiresAt = new Date(now.getTime() + UPLOAD_URL_TTL_MS);
  const video = await Media.create({
    ownerId: actor.userId,
    title: input.title,
    caption: input.caption ?? null,
    visibility: input.visibility,
    provider: deps.video.name,
    declared: { filename: input.filename, mimeType: input.mimeType, sizeBytes: input.sizeBytes },
    uploadExpiresAt: expiresAt,
  });
  try {
    const upload = await deps.video.createDirectUpload({
      videoId: String(video._id),
      creatorId: actor.userId,
      maxBytes: max,
      maxDurationSeconds: deps.env.VIDEO_MAX_DURATION_SECONDS,
      expiresAt,
    });
    video.providerAssetId = upload.providerAssetId;
    await video.save();
    await audit(actor, 'video.upload_requested', video, { sizeBytes: input.sizeBytes });
    return {
      video: (await toVideoDTOs(actor, [video]))[0]!,
      upload: {
        url: upload.url,
        method: upload.method,
        encoding: upload.encoding,
        expiresAt: expiresAt.toISOString(),
        maxBytes: max,
      },
    };
  } catch (error) {
    await failVideo(video._id, 'provider_error', 'The video service is unavailable');
    if (error instanceof ProviderError)
      throw new HttpError(
        502,
        'PROVIDER_UNAVAILABLE',
        'The video service is unavailable, try again shortly',
      );
    throw error;
  }
}

async function failVideo(
  id: Types.ObjectId,
  code: VideoFailureCode,
  message: string,
): Promise<void> {
  await Media.updateOne(
    { _id: id, 'processing.state': { $in: ['pending_upload', 'processing'] } },
    {
      $set: {
        'processing.state': 'failed',
        'processing.failureCode': code,
        'processing.failureMessage': message,
        'processing.updatedAt': new Date(),
      },
    },
  );
}

/**
 * Apply a provider-reported asset state. Idempotent and monotonic: duplicate or out-of-order notifications cannot move
 * a video backwards (`ready` and `failed` are final), and a late "ready" for a video we already gave up on is ignored.
 */
export async function applyAsset(
  asset: ProviderAsset,
  deps: VideoDeps,
): Promise<{ applied: boolean; video?: MediaDoc }> {
  const video = await Media.findOne({
    provider: deps.video.name,
    providerAssetId: asset.providerAssetId,
  });
  if (!video || video.status === 'deleted') return { applied: false };
  const from = video.processing.state;
  if (from === 'ready' || from === 'failed') return { applied: false, video };

  if (asset.state === 'pending_upload') return { applied: false, video };
  if (asset.state === 'failed') {
    await failVideo(
      video._id,
      asset.failure?.code ?? 'processing_failed',
      asset.failure?.message ?? 'The video could not be processed',
    );
    await audit(null, 'video.failed', video, { code: asset.failure?.code });
    return { applied: true, video: (await Media.findById(video._id)) ?? video };
  }
  if (asset.state === 'processing') {
    await Media.updateOne(
      { _id: video._id, 'processing.state': 'pending_upload' },
      { $set: { 'processing.state': 'processing', 'processing.updatedAt': new Date() } },
    );
    return { applied: true, video: (await Media.findById(video._id)) ?? video };
  }

  // ready: re-check the limits against what the provider really received (declared values can be wrong or false)
  if (asset.sizeBytes && asset.sizeBytes > maxUploadBytes(deps.env)) {
    await failVideo(video._id, 'unsupported_format', 'The file is larger than allowed');
    await deps.video.deleteAsset(asset.providerAssetId).catch(() => undefined);
    return { applied: true, video: (await Media.findById(video._id)) ?? video };
  }
  if (asset.durationSeconds && asset.durationSeconds > deps.env.VIDEO_MAX_DURATION_SECONDS + 1) {
    await failVideo(
      video._id,
      'too_long',
      `Videos can be at most ${deps.env.VIDEO_MAX_DURATION_SECONDS} seconds`,
    );
    await deps.video.deleteAsset(asset.providerAssetId).catch(() => undefined);
    return { applied: true, video: (await Media.findById(video._id)) ?? video };
  }
  const updated = await Media.findOneAndUpdate(
    { _id: video._id, 'processing.state': { $in: ['pending_upload', 'processing'] } },
    {
      $set: {
        'processing.state': 'ready',
        'processing.failureCode': null,
        'processing.failureMessage': null,
        'processing.updatedAt': new Date(),
        durationSeconds: asset.durationSeconds ?? null,
        width: asset.width ?? null,
        height: asset.height ?? null,
        sizeBytes: asset.sizeBytes ?? null,
        readyAt: new Date(),
      },
    },
    { returnDocument: 'after' },
  );
  if (updated)
    await audit(null, 'video.ready', updated, { durationSeconds: asset.durationSeconds });
  return { applied: Boolean(updated), video: updated ?? video };
}

async function loadOwned(actor: Actor, id: Types.ObjectId): Promise<MediaDoc> {
  const video = await Media.findById(id);
  if (!video || video.status === 'deleted' || String(video.ownerId) !== actor.userId)
    throw notFound('Video not found');
  return video;
}

/** Creator-triggered re-check against the provider (covers a missed or delayed webhook). */
export async function refreshVideo(
  actor: Actor,
  id: Types.ObjectId,
  deps: VideoDeps,
): Promise<VideoDTO> {
  const video = await loadOwned(actor, id);
  if (['pending_upload', 'processing'].includes(video.processing.state) && video.providerAssetId) {
    try {
      const asset = await deps.video.getAsset(video.providerAssetId);
      if (asset) await applyAsset(asset, deps);
      else if (video.uploadExpiresAt < new Date())
        await failVideo(video._id, 'upload_expired', 'The upload was never completed');
    } catch (error) {
      if (!(error instanceof ProviderError)) throw error;
      throw new HttpError(
        502,
        'PROVIDER_UNAVAILABLE',
        'The video service is unavailable, try again shortly',
      );
    }
  }
  return getVideo(actor, id);
}

// ---------------------------------------------------------------------------
// Read / update / delete
// ---------------------------------------------------------------------------
export async function getVideo(actor: Actor, id: Types.ObjectId): Promise<VideoDTO> {
  return (await toVideoDTOs(actor, [await loadVisibleVideo(actor, id)]))[0]!;
}

export async function updateVideo(
  actor: Actor,
  id: Types.ObjectId,
  input: {
    title?: string | undefined;
    caption?: string | null | undefined;
    visibility?: 'public' | 'followers' | 'private' | undefined;
  },
): Promise<VideoDTO> {
  const video = await loadOwned(actor, id);
  if (video.status !== 'published')
    throw conflict('Moderated videos can no longer be edited', 'CONTENT_LOCKED');
  if (input.title !== undefined) video.title = input.title;
  if (input.caption !== undefined) video.caption = input.caption;
  if (input.visibility !== undefined) video.visibility = input.visibility;
  await video.save();
  await audit(actor, 'video.updated', video);
  return getVideo(actor, id);
}

export async function deleteVideo(
  actor: Actor,
  id: Types.ObjectId,
  deps: VideoDeps,
): Promise<void> {
  const video = await loadOwned(actor, id);
  const previous = video.status;
  video.status = 'deleted';
  video.deletedAt = new Date();
  video.moderation.push({
    at: new Date(),
    by: actor.userId as unknown as Types.ObjectId,
    action: 'author_deleted',
    from: previous,
    to: 'deleted',
  });
  await video.save();
  await audit(actor, 'video.deleted', video, { previous });
  // Best effort now; the cleanup job retries anything the provider could not delete.
  if (video.providerAssetId) {
    await deps.video
      .deleteAsset(video.providerAssetId)
      .then(() => Media.updateOne({ _id: video._id }, { $set: { providerDeletedAt: new Date() } }))
      .catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// Feed (cursor pagination, newest first)
// ---------------------------------------------------------------------------
export interface VideoFeedQuery {
  cursor?: string | undefined;
  limit: number;
  scope: 'all' | 'following';
  creatorId?: string | undefined;
  mine?: boolean | undefined;
}

export async function listVideos(
  actor: Actor,
  query: VideoFeedQuery,
): Promise<CursorPage<VideoDTO>> {
  const me = actor.userId;
  const and: Record<string, unknown>[] = [];
  const own = query.creatorId === me;

  if (query.mine) {
    // "My videos" shows everything of mine (processing, failed, hidden…), but never deleted ones.
    and.push({ ownerId: me }, { status: { $in: ['published', 'hidden', 'removed'] } });
  } else {
    and.push({ status: 'published', 'processing.state': 'ready' });
    if (query.creatorId) {
      and.push({ ownerId: query.creatorId });
      if (!own) {
        const follows = await Follow.exists({ followerId: me, followeeId: query.creatorId });
        and.push({ visibility: follows ? { $in: ['public', 'followers'] } : 'public' });
      }
    } else {
      const follows = await Follow.find({ followerId: me })
        .sort({ _id: -1 })
        .limit(2000)
        .select('followeeId');
      const ids = follows.map((f) => f.followeeId);
      if (query.scope === 'following') and.push({ ownerId: { $in: [...ids, me] } });
      and.push({
        $or: [
          { visibility: 'public' },
          { ownerId: me },
          { visibility: 'followers', ownerId: { $in: ids } },
        ],
      });
    }
  }
  const cursor = decodeCursor(query.cursor);
  if (cursor)
    and.push({
      $or: [
        { createdAt: { $lt: new Date(cursor.k) } },
        { createdAt: new Date(cursor.k), _id: { $lt: cursor.id } },
      ],
    });
  const rows = await Media.find({ $and: and })
    .sort({ createdAt: -1, _id: -1 })
    .limit(query.limit + 1);
  const page = rows.slice(0, query.limit);
  const last = page[page.length - 1];
  const nextCursor =
    rows.length > query.limit && last
      ? encodeCursor(last.createdAt.getTime(), last._id)
      : undefined;
  return { items: await toVideoDTOs(actor, page), ...(nextCursor ? { nextCursor } : {}) };
}

// ---------------------------------------------------------------------------
// Playback + views
// ---------------------------------------------------------------------------
export async function videoPlayback(
  actor: Actor,
  id: Types.ObjectId,
  deps: VideoDeps,
): Promise<PlaybackInfo> {
  const video = await loadVisibleVideo(actor, id);
  if (video.processing.state !== 'ready' || !video.providerAssetId)
    throw conflict('This video is not ready to play yet', 'NOT_READY');
  if (video.status !== 'published' && String(video.ownerId) !== actor.userId)
    throw notFound('Video not found');
  try {
    const p = await deps.video.signedPlayback(
      { kind: 'asset', providerId: video.providerAssetId },
      PLAYBACK_TTL_SECONDS,
    );
    return { url: p.url, thumbnailUrl: p.thumbnailUrl, expiresAt: p.expiresAt.toISOString() };
  } catch (error) {
    if (error instanceof ProviderError)
      throw new HttpError(
        502,
        'PROVIDER_UNAVAILABLE',
        'Playback is unavailable, try again shortly',
      );
    throw error;
  }
}

/** A view counts once per viewer per 24 h, only after real watch time, never for the creator's own plays. */
export async function recordView(
  actor: Actor,
  id: Types.ObjectId,
  watchedSeconds: number,
): Promise<ViewResult> {
  const video = await loadVisibleVideo(actor, id);
  const current = { counted: false, viewCount: video.viewCount };
  if (video.status !== 'published' || video.processing.state !== 'ready') return current;
  if (String(video.ownerId) === actor.userId) return current;
  const needed = Math.min(3, (video.durationSeconds ?? 3) / 2);
  if (watchedSeconds < needed) return current;

  const now = new Date();
  const key = { videoId: video._id, viewerId: actor.userId, kind: 'view' as const };
  let counted = false;
  const renewed = await VideoMetric.updateOne(
    { ...key, lastCountedAt: { $lte: new Date(now.getTime() - VIEW_WINDOW_MS) } },
    { $set: { lastCountedAt: now }, $inc: { count: 1 } },
  );
  if (renewed.modifiedCount === 1) counted = true;
  else {
    try {
      await VideoMetric.create({ ...key, lastCountedAt: now, count: 1 });
      counted = true;
    } catch (error) {
      if (!isDuplicateKey(error)) throw error; // already counted in this window (or a parallel request won)
    }
  }
  if (!counted) return current;
  const updated = await Media.findByIdAndUpdate(
    video._id,
    { $inc: { viewCount: 1 } },
    { returnDocument: 'after' },
  );
  return { counted: true, viewCount: updated?.viewCount ?? video.viewCount + 1 };
}
