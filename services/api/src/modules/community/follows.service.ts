import type { Types } from 'mongoose';
import type { FollowResult, UserProfileDTO } from '@farmplus/shared-types';
import type { Actor } from '../../context';
import { badRequest, notFound } from '../../lib/errors';
import { Follow, Media, Post, User } from '../../models';
import { recordAudit } from '../../services/audit.service';
import { isDuplicateKey } from './shared';

async function activeUser(id: Types.ObjectId) {
  const user = await User.findById(id).select('displayName avatarUrl status createdAt');
  // Suspended/unknown accounts have no public profile and cannot be followed.
  if (!user || user.status !== 'active') throw notFound('User not found');
  return user;
}

const followerCount = (id: Types.ObjectId) => Follow.countDocuments({ followeeId: id });

export async function follow(actor: Actor, targetId: Types.ObjectId): Promise<FollowResult> {
  if (String(targetId) === actor.userId)
    throw badRequest('You cannot follow yourself', 'CANNOT_FOLLOW_SELF');
  await activeUser(targetId);
  try {
    const res = await Follow.updateOne(
      { followerId: actor.userId, followeeId: targetId },
      { $setOnInsert: { createdAt: new Date() } },
      { upsert: true },
    );
    if (res.upsertedCount === 1)
      await recordAudit({
        actorId: actor.userId,
        action: 'user.followed',
        targetType: 'user',
        targetId,
        ip: actor.ip,
      });
  } catch (error) {
    if (!isDuplicateKey(error)) throw error;
  }
  return { following: true, followerCount: await followerCount(targetId) };
}

export async function unfollow(actor: Actor, targetId: Types.ObjectId): Promise<FollowResult> {
  const res = await Follow.deleteOne({ followerId: actor.userId, followeeId: targetId });
  if (res.deletedCount === 1)
    await recordAudit({
      actorId: actor.userId,
      action: 'user.unfollowed',
      targetType: 'user',
      targetId,
      ip: actor.ip,
    });
  return { following: false, followerCount: await followerCount(targetId) };
}

export async function profileOf(actor: Actor, id: Types.ObjectId): Promise<UserProfileDTO> {
  const user = await activeUser(id);
  const [followers, following, posts, videos, isFollowing] = await Promise.all([
    followerCount(id),
    Follow.countDocuments({ followerId: id }),
    // Only what anyone may see: the profile must not leak how many private / followers-only posts exist.
    Post.countDocuments({ authorId: id, status: 'published', visibility: 'public' }),
    Media.countDocuments({
      ownerId: id,
      status: 'published',
      visibility: 'public',
      'processing.state': 'ready',
    }),
    Follow.exists({ followerId: actor.userId, followeeId: id }),
  ]);
  return {
    id: String(user._id),
    displayName: user.displayName,
    avatarUrl: user.avatarUrl ?? null,
    joinedAt: user.createdAt.toISOString(),
    postCount: posts,
    videoCount: videos,
    followerCount: followers,
    followingCount: following,
    isSelf: String(user._id) === actor.userId,
    isFollowing: Boolean(isFollowing),
  };
}
