import { Types } from 'mongoose';
import type { CursorPage, LiveDTO, LiveIngest, PlaybackInfo } from '@farmplus/shared-types';
import type { CreateLiveInput } from '@farmplus/validation';
import type { Actor } from '../../context';
import { HttpError, forbidden, notFound } from '../../lib/errors';
import { ACTIVE_LIVE_STATES, Follow, LiveSession, type LiveSessionDoc } from '../../models';
import { recordAudit } from '../../services/audit.service';
import {
  MODERATION_NOTICE,
  authorOf,
  authorsById,
  decodeCursor,
  encodeCursor,
  followedSet,
  isDuplicateKey,
} from '../community/shared';
import { getBooleanSetting } from '../settings/settings.service';
import { loadVisibleLive } from './live-access';
import { ProviderError, type VideoProvider } from './provider';

const PLAYBACK_TTL_SECONDS = 3600;
/** An interrupted stream that has not reconnected within this time is over. */
export const RECONNECT_GRACE_MS = 5 * 60_000;
/** A session that never started (encoder never connected) is closed after this long. */
export const UNSTARTED_TTL_MS = 12 * 3_600_000;
/**
 * A stream still marked live after this long is closed by cleanup: it protects against a lost disconnect webhook leaving
 * a session "live" (and listed) forever. Longer broadcasts are ended and can be started again.
 */
export const MAX_LIVE_DURATION_MS = 12 * 3_600_000;
const HOST_ROLES = ['farm_owner', 'seller'];

export async function toLiveDTOs(actor: Actor, sessions: LiveSessionDoc[]): Promise<LiveDTO[]> {
  const hosts = await authorsById(sessions.map((s) => s.hostId));
  const followed = await followedSet(
    actor.userId,
    sessions.map((s) => s.hostId),
  );
  return sessions.map((s) => {
    const isHost = String(s.hostId) === actor.userId;
    const notice = isHost ? MODERATION_NOTICE[s.status] : undefined;
    return {
      id: String(s._id),
      host: authorOf(hosts, s.hostId),
      title: s.title,
      description: s.description ?? null,
      access: s.access,
      state: s.state,
      status: s.status,
      startedAt: s.startedAt?.toISOString() ?? null,
      endedAt: s.endedAt?.toISOString() ?? null,
      createdAt: s.createdAt.toISOString(),
      viewer: { isHost, followsHost: followed.has(String(s.hostId)) },
      ...(notice ? { moderationNotice: notice } : {}),
    };
  });
}

const audit = (actor: Actor | null, action: string, live: LiveSessionDoc, extra = {}) =>
  recordAudit({
    actorId: actor?.userId ?? null,
    action,
    targetType: 'live',
    targetId: live._id,
    metadata: extra,
    ...(actor?.ip ? { ip: actor.ip } : {}),
  });

const unavailable = () =>
  new HttpError(
    502,
    'PROVIDER_UNAVAILABLE',
    'The streaming service is unavailable, try again shortly',
  );

// ---------------------------------------------------------------------------
// Host authorisation
// ---------------------------------------------------------------------------
/** Going live is for farm owners / sellers (setting `live.requireHostRole`); nobody can host as someone else. */
async function mayHost(actor: Actor): Promise<boolean> {
  if (!(await getBooleanSetting('live.requireHostRole'))) return true;
  return HOST_ROLES.some((r) => actor.access.roleKeys.includes(r));
}

/** Whether the caller may start a live stream (the same rule as `createLive`), so the page can say so up front. */
export async function hostEligibility(actor: Actor): Promise<{ canHost: boolean }> {
  return { canHost: await mayHost(actor) };
}

async function assertMayHost(actor: Actor): Promise<void> {
  if (!(await mayHost(actor)))
    throw forbidden(
      'Only approved farm owners and sellers can start a live stream.',
      'LIVE_HOST_REQUIRED',
    );
}

async function loadHosted(actor: Actor, id: Types.ObjectId): Promise<LiveSessionDoc> {
  const live = await LiveSession.findById(id);
  // Not yours = not found: another user's session cannot be probed, ended or read.
  if (!live || String(live.hostId) !== actor.userId) throw notFound('Live stream not found');
  return live;
}

// ---------------------------------------------------------------------------
// Create / end
// ---------------------------------------------------------------------------
export async function createLive(
  actor: Actor,
  input: CreateLiveInput,
  video: VideoProvider,
): Promise<{ live: LiveDTO; ingest: LiveIngest }> {
  await assertMayHost(actor);
  if (await LiveSession.exists({ hostId: actor.userId, state: { $in: ACTIVE_LIVE_STATES } }))
    throw new HttpError(
      409,
      'LIVE_ALREADY_ACTIVE',
      'You already have a live stream that is not over',
    );

  const id = new Types.ObjectId();
  let ingest;
  try {
    ingest = await video.createLiveInput({ liveId: String(id), title: input.title });
  } catch (error) {
    if (error instanceof ProviderError) throw unavailable();
    throw error;
  }
  try {
    const live = await LiveSession.create({
      _id: id,
      hostId: actor.userId,
      title: input.title,
      description: input.description ?? null,
      access: input.access,
      provider: video.name,
      providerInputId: ingest.providerInputId,
    });
    await audit(actor, 'live.created', live, { access: input.access });
    return {
      live: (await toLiveDTOs(actor, [live]))[0]!,
      ingest: { rtmpsUrl: ingest.rtmpsUrl, streamKey: ingest.streamKey },
    };
  } catch (error) {
    // Don't leave an orphaned provider input behind (also covers losing the one-active-session race).
    await video.deleteLiveInput(ingest.providerInputId).catch(() => undefined);
    if (isDuplicateKey(error))
      throw new HttpError(
        409,
        'LIVE_ALREADY_ACTIVE',
        'You already have a live stream that is not over',
      );
    throw error;
  }
}

/** Re-read the ingest address. Host only, audited; the stream key is never stored or listed anywhere else. */
export async function getIngest(
  actor: Actor,
  id: Types.ObjectId,
  video: VideoProvider,
): Promise<LiveIngest> {
  const live = await loadHosted(actor, id);
  if (!ACTIVE_LIVE_STATES.includes(live.state) || live.status !== 'published')
    throw new HttpError(409, 'LIVE_OVER', 'This live stream is over');
  try {
    const ingest = await video.getLiveInput(live.providerInputId);
    if (!ingest) throw unavailable();
    await audit(actor, 'live.ingest_viewed', live);
    return { rtmpsUrl: ingest.rtmpsUrl, streamKey: ingest.streamKey };
  } catch (error) {
    if (error instanceof ProviderError) throw unavailable();
    throw error;
  }
}

/** Atomically close a session (only the request that performs the transition does the follow-up work). */
export async function closeSession(
  id: Types.ObjectId,
  reason: 'host' | 'moderator' | 'timeout' | 'provider',
  video: VideoProvider,
): Promise<LiveSessionDoc | null> {
  const before = await LiveSession.findOneAndUpdate(
    { _id: id, state: { $in: ACTIVE_LIVE_STATES } },
    { $set: { state: 'ended', endedAt: new Date(), endReason: reason } },
    { returnDocument: 'before' },
  );
  if (!before) return null;
  await video.deleteLiveInput(before.providerInputId).catch(() => undefined);
  return before;
}

export async function endLive(
  actor: Actor,
  id: Types.ObjectId,
  video: VideoProvider,
): Promise<LiveDTO> {
  const live = await loadHosted(actor, id);
  const closed = await closeSession(live._id, 'host', video);
  if (closed) await audit(actor, 'live.ended', closed, { reason: 'host' });
  return (await toLiveDTOs(actor, [(await LiveSession.findById(live._id)) ?? live]))[0]!;
}

// ---------------------------------------------------------------------------
// Read / list / playback
// ---------------------------------------------------------------------------
export async function getLive(actor: Actor, id: Types.ObjectId): Promise<LiveDTO> {
  return (await toLiveDTOs(actor, [await loadVisibleLive(actor, id)]))[0]!;
}

export async function listLive(
  actor: Actor,
  query: {
    cursor?: string | undefined;
    limit: number;
    state: 'live' | 'created' | 'ended';
    hostId?: string | undefined;
  },
): Promise<CursorPage<LiveDTO>> {
  const me = actor.userId;
  const and: Record<string, unknown>[] = [];
  if (query.state === 'live') {
    and.push({ state: { $in: ['live', 'interrupted'] }, status: 'published' });
    if (query.hostId) and.push({ hostId: query.hostId });
    const follows = await Follow.find({ followerId: me })
      .sort({ _id: -1 })
      .limit(2000)
      .select('followeeId');
    and.push({
      $or: [
        { access: 'public' },
        { hostId: me },
        { access: 'followers', hostId: { $in: follows.map((f) => f.followeeId) } },
      ],
    });
  } else {
    // Sessions that have not started or are over are listed for their host only.
    and.push({ hostId: me, state: query.state });
  }
  const cursor = decodeCursor(query.cursor);
  if (cursor)
    and.push({
      $or: [
        { createdAt: { $lt: new Date(cursor.k) } },
        { createdAt: new Date(cursor.k), _id: { $lt: cursor.id } },
      ],
    });
  const rows = await LiveSession.find({ $and: and })
    .sort({ createdAt: -1, _id: -1 })
    .limit(query.limit + 1);
  const page = rows.slice(0, query.limit);
  const last = page[page.length - 1];
  const nextCursor =
    rows.length > query.limit && last
      ? encodeCursor(last.createdAt.getTime(), last._id)
      : undefined;
  return { items: await toLiveDTOs(actor, page), ...(nextCursor ? { nextCursor } : {}) };
}

export async function livePlayback(
  actor: Actor,
  id: Types.ObjectId,
  video: VideoProvider,
): Promise<PlaybackInfo> {
  const live = await loadVisibleLive(actor, id);
  if (!ACTIVE_LIVE_STATES.includes(live.state) || live.status !== 'published')
    throw new HttpError(409, 'LIVE_OVER', 'This live stream is not available');
  if (live.state === 'created' && String(live.hostId) !== actor.userId)
    throw new HttpError(409, 'NOT_LIVE_YET', 'This live stream has not started yet');
  try {
    const p = await video.signedPlayback(
      { kind: 'live', providerId: live.providerInputId },
      PLAYBACK_TTL_SECONDS,
    );
    return { url: p.url, thumbnailUrl: p.thumbnailUrl, expiresAt: p.expiresAt.toISOString() };
  } catch (error) {
    if (error instanceof ProviderError) throw unavailable();
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Provider events (driven by authenticated webhooks)
// ---------------------------------------------------------------------------
export async function onLiveConnected(providerInputId: string, provider: string): Promise<boolean> {
  const res = await LiveSession.updateOne(
    { provider, providerInputId, state: { $in: ['created', 'interrupted'] }, status: 'published' },
    [
      {
        $set: {
          state: 'live',
          lastDisconnectedAt: null,
          startedAt: { $ifNull: ['$startedAt', '$$NOW'] },
        },
      },
    ],
    { updatePipeline: true },
  );
  return res.modifiedCount === 1;
}

export async function onLiveDisconnected(
  providerInputId: string,
  provider: string,
): Promise<boolean> {
  const res = await LiveSession.updateOne(
    { provider, providerInputId, state: 'live' },
    { $set: { state: 'interrupted', lastDisconnectedAt: new Date() } },
  );
  return res.modifiedCount === 1;
}
