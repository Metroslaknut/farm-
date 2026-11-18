import type { Types } from 'mongoose';
import type { Actor } from '../../context';
import { notFound } from '../../lib/errors';
import { ACTIVE_LIVE_STATES, Follow, LiveSession, type LiveSessionDoc } from '../../models';

/**
 * ONE place decides who may see a live session. The host always sees their own (any state, with moderation notice).
 * Viewers need: published, not over / not failed, and the access rule (`public`, or `followers` → must follow the host).
 * Anything else is a plain 404 (a followers-only stream is indistinguishable from a missing one).
 */
export async function loadVisibleLive(actor: Actor, id: Types.ObjectId): Promise<LiveSessionDoc> {
  const live = await LiveSession.findById(id);
  if (!live) throw notFound('Live stream not found');
  if (String(live.hostId) === actor.userId) return live;
  if (live.status !== 'published' || !ACTIVE_LIVE_STATES.includes(live.state))
    throw notFound('Live stream not found');
  if (live.access === 'followers') {
    const follows = await Follow.exists({ followerId: actor.userId, followeeId: live.hostId });
    if (!follows) throw notFound('Live stream not found');
  }
  return live;
}
