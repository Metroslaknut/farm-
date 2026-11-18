import type { Types } from 'mongoose';
import type { ReactionResult, ReactionType } from '@farmplus/shared-types';
import type { Actor } from '../../context';
import { conflict } from '../../lib/errors';
import { Comment, Media, Post, Reaction } from '../../models';
import { isVideoOpen, loadVisibleVideo } from '../media/video-access';
import { loadVisibleComment } from './comments.service';
import { loadVisibleContainer } from './containers';
import { loadVisiblePost } from './posts.service';
import { isDuplicateKey } from './shared';

type Target = 'post' | 'comment' | 'video';

async function assertReactable(actor: Actor, type: Target, id: Types.ObjectId) {
  if (type === 'post') {
    const post = await loadVisiblePost(actor, id);
    if (post.status !== 'published')
      throw conflict('This post is not open for reactions', 'CONTENT_LOCKED');
    return;
  }
  if (type === 'video') {
    const video = await loadVisibleVideo(actor, id);
    if (!isVideoOpen(video))
      throw conflict('This video is not open for reactions', 'CONTENT_LOCKED');
    return;
  }
  const comment = await loadVisibleComment(actor, id);
  const container = await loadVisibleContainer(actor, comment.targetType ?? 'post', comment.postId);
  if (comment.status !== 'published' || !container.open)
    throw conflict('This comment is not open for reactions', 'CONTENT_LOCKED');
}

async function bump(type: Target, id: Types.ObjectId, delta: 1 | -1): Promise<number> {
  if (type === 'post') {
    const post = await Post.findByIdAndUpdate(
      id,
      { $inc: { reactionCount: delta, engagement: delta } },
      { returnDocument: 'after' },
    );
    return Math.max(0, post?.reactionCount ?? 0);
  }
  if (type === 'video') {
    const video = await Media.findByIdAndUpdate(
      id,
      { $inc: { reactionCount: delta } },
      { returnDocument: 'after' },
    );
    return Math.max(0, video?.reactionCount ?? 0);
  }
  const comment = await Comment.findByIdAndUpdate(
    id,
    { $inc: { reactionCount: delta } },
    { returnDocument: 'after' },
  );
  return Math.max(0, comment?.reactionCount ?? 0);
}

async function currentCount(type: Target, id: Types.ObjectId): Promise<number> {
  const doc =
    type === 'post'
      ? await Post.findById(id).select('reactionCount')
      : type === 'video'
        ? await Media.findById(id).select('reactionCount')
        : await Comment.findById(id).select('reactionCount');
  return doc?.reactionCount ?? 0;
}

/**
 * Idempotent “like”: the unique (target, user) index is the source of truth. The counter only moves when a row was
 * really inserted/removed, so repeated or concurrent requests can never inflate or deflate it.
 */
export async function react(
  actor: Actor,
  type: Target,
  id: Types.ObjectId,
  reaction: ReactionType,
): Promise<ReactionResult> {
  await assertReactable(actor, type, id);
  try {
    const res = await Reaction.updateOne(
      { targetType: type, targetId: id, userId: actor.userId },
      { $setOnInsert: { type: reaction, createdAt: new Date() } },
      { upsert: true },
    );
    if (res.upsertedCount === 1) return { reacted: true, reactionCount: await bump(type, id, 1) };
  } catch (error) {
    if (!isDuplicateKey(error)) throw error; // lost a race with the same user's other request: already reacted
  }
  return { reacted: true, reactionCount: await currentCount(type, id) };
}

export async function unreact(
  actor: Actor,
  type: Target,
  id: Types.ObjectId,
): Promise<ReactionResult> {
  const own = { targetType: type, targetId: id, userId: actor.userId };
  // Removing your own like needs no visibility check beyond the target existing for you.
  await assertReactable(actor, type, id).catch(async (e: unknown) => {
    // Allow un-liking content that was meanwhile moderated (locked, or hidden from you): only the owner of the row
    // is affected. Without a reaction of yours, hidden content stays indistinguishable from missing.
    if ((e as { code?: string }).code === 'CONTENT_LOCKED') return;
    if (!(await Reaction.exists(own))) throw e;
  });
  const res = await Reaction.deleteOne(own);
  if (res.deletedCount === 1) return { reacted: false, reactionCount: await bump(type, id, -1) };
  return { reacted: false, reactionCount: await currentCount(type, id) };
}
