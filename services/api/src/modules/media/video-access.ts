import type { Types } from 'mongoose';
import type { Actor } from '../../context';
import { notFound } from '../../lib/errors';
import { Follow, Media, type MediaDoc } from '../../models';

/** True when `viewerId` may see a published video of `ownerId` with this visibility. */
export async function mayViewVisibility(
  viewerId: string,
  ownerId: Types.ObjectId,
  visibility: 'public' | 'followers' | 'private',
): Promise<boolean> {
  if (visibility === 'public') return true;
  if (visibility === 'followers')
    return Boolean(await Follow.exists({ followerId: viewerId, followeeId: ownerId }));
  return false;
}

/**
 * ONE place decides who may see a video. The creator always sees their own (with processing/moderation state);
 * everyone else needs: published, finished processing, and the visibility rule. Anything else is a plain 404.
 */
export async function loadVisibleVideo(actor: Actor, id: Types.ObjectId): Promise<MediaDoc> {
  const video = await Media.findById(id);
  if (!video || video.status === 'deleted') throw notFound('Video not found');
  if (String(video.ownerId) === actor.userId) return video;
  if (video.status !== 'published' || video.processing.state !== 'ready')
    throw notFound('Video not found');
  if (!(await mayViewVisibility(actor.userId, video.ownerId, video.visibility)))
    throw notFound('Video not found');
  return video;
}

/** Comments/likes are open only on a published video that finished processing. */
export const isVideoOpen = (video: Pick<MediaDoc, 'status' | 'processing'>): boolean =>
  video.status === 'published' && video.processing.state === 'ready';
