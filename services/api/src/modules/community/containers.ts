import type { Types } from 'mongoose';
import type { Actor } from '../../context';
import { Media, Post } from '../../models';
import { isVideoOpen, loadVisibleVideo } from '../media/video-access';
import { loadVisiblePost } from './posts.service';

export type CommentContainer = 'post' | 'video';

export interface ContainerInfo {
  /** Whether new comments / likes are accepted right now. */
  open: boolean;
  authorId: Types.ObjectId;
}

/** Resolve (and authorise) the post or video a comment/reaction belongs to. */
export async function loadVisibleContainer(
  actor: Actor,
  type: CommentContainer,
  id: Types.ObjectId,
): Promise<ContainerInfo> {
  if (type === 'video') {
    const video = await loadVisibleVideo(actor, id);
    return { open: isVideoOpen(video), authorId: video.ownerId };
  }
  const post = await loadVisiblePost(actor, id);
  return { open: post.status === 'published', authorId: post.authorId };
}

/** Keep the denormalised comment counter of the container in step. */
export async function bumpContainerComments(
  type: CommentContainer,
  id: Types.ObjectId,
  delta: 1 | -1,
): Promise<void> {
  if (type === 'video') await Media.updateOne({ _id: id }, { $inc: { commentCount: delta } });
  else await Post.updateOne({ _id: id }, { $inc: { commentCount: delta, engagement: 2 * delta } });
}
