import type { Types } from 'mongoose';
import type { CommentDTO, ContentStatus, CursorPage } from '@farmplus/shared-types';
import type { CreateCommentInput } from '@farmplus/validation';
import type { Actor } from '../../context';
import { conflict, notFound } from '../../lib/errors';
import { Comment, type CommentDoc } from '../../models';
import type { ModerationEntryAttrs } from '../../models/post.model';
import { recordAudit } from '../../services/audit.service';
import { bumpContainerComments, loadVisibleContainer, type CommentContainer } from './containers';
import { authorOf, authorsById, decodeCursor, encodeCursor, invalid, reactedSet } from './shared';

const MAX_EDIT_HISTORY = 10;

export async function toCommentDTOs(actor: Actor, comments: CommentDoc[]): Promise<CommentDTO[]> {
  const authors = await authorsById(comments.map((c) => c.authorId));
  const reacted = await reactedSet(
    actor.userId,
    'comment',
    comments.map((c) => c._id),
  );
  return comments.map((c) => {
    const shown = c.status === 'published';
    return {
      id: String(c._id),
      postId: String(c.postId),
      parentId: c.parentId ? String(c.parentId) : null,
      author: authorOf(authors, c.authorId),
      // A removed/hidden/deleted comment that still has replies stays as a placeholder without its text.
      body: shown ? c.body : '',
      status: c.status,
      reactionCount: c.reactionCount,
      replyCount: c.replyCount,
      createdAt: c.createdAt.toISOString(),
      editedAt: c.editedAt?.toISOString() ?? null,
      viewer: {
        reacted: reacted.has(String(c._id)),
        isAuthor: String(c.authorId) === actor.userId,
      },
    };
  });
}

/** A comment is reachable only through a post the caller may see. */
export async function loadVisibleComment(actor: Actor, id: Types.ObjectId): Promise<CommentDoc> {
  const comment = await Comment.findById(id);
  if (!comment || comment.status === 'deleted') throw notFound('Comment not found');
  await loadVisibleContainer(actor, comment.targetType ?? 'post', comment.postId);
  return comment;
}

/** Keep the denormalised counters in step with “published” comments. */
async function adjustCounts(
  comment: Pick<CommentDoc, 'postId' | 'parentId' | 'targetType'>,
  delta: 1 | -1,
) {
  await bumpContainerComments(comment.targetType ?? 'post', comment.postId, delta);
  if (comment.parentId)
    await Comment.updateOne({ _id: comment.parentId }, { $inc: { replyCount: delta } });
}

/**
 * Atomically move a comment between statuses. Only the request that actually performs the transition adjusts the
 * counters, so concurrent delete/hide/restore calls cannot double count.
 */
export async function transitionComment(
  id: Types.ObjectId,
  allowedFrom: ContentStatus[],
  to: ContentStatus,
  entry: ModerationEntryAttrs,
): Promise<{ before: CommentDoc; changed: boolean } | null> {
  const before = await Comment.findOneAndUpdate(
    { _id: id, status: { $in: allowedFrom } },
    {
      $set: { status: to, ...(to === 'deleted' ? { deletedAt: new Date() } : {}) },
      $push: { moderation: { ...entry, to } },
    },
    { returnDocument: 'before' },
  );
  if (!before) return null;
  const wasShown = before.status === 'published';
  const isShown = to === 'published';
  if (wasShown && !isShown) await adjustCounts(before, -1);
  if (!wasShown && isShown) await adjustCounts(before, 1);
  return { before, changed: before.status !== to };
}

const targetFilter = (type: CommentContainer): Record<string, unknown> =>
  type === 'video' ? { targetType: 'video' } : { targetType: { $ne: 'video' } };

export async function listComments(
  actor: Actor,
  postId: Types.ObjectId,
  query: { cursor?: string | undefined; limit: number; parentId?: string | undefined },
  type: CommentContainer = 'post',
): Promise<CursorPage<CommentDTO>> {
  await loadVisibleContainer(actor, type, postId);
  const cursor = decodeCursor(query.cursor);
  const and: Record<string, unknown>[] = [{ postId }, targetFilter(type)];
  if (query.parentId) {
    and.push({ parentId: query.parentId, status: 'published' });
  } else {
    and.push({ parentId: null, $or: [{ status: 'published' }, { replyCount: { $gt: 0 } }] });
  }
  if (cursor)
    and.push({
      $or: [
        { createdAt: { $gt: new Date(cursor.k) } },
        { createdAt: new Date(cursor.k), _id: { $gt: cursor.id } },
      ],
    });
  const rows = await Comment.find({ $and: and })
    .sort({ createdAt: 1, _id: 1 })
    .limit(query.limit + 1);
  const page = rows.slice(0, query.limit);
  const last = page[page.length - 1];
  const nextCursor =
    rows.length > query.limit && last
      ? encodeCursor(last.createdAt.getTime(), last._id)
      : undefined;
  return { items: await toCommentDTOs(actor, page), ...(nextCursor ? { nextCursor } : {}) };
}

export async function createComment(
  actor: Actor,
  postId: Types.ObjectId,
  input: CreateCommentInput,
  type: CommentContainer = 'post',
): Promise<CommentDTO> {
  const container = await loadVisibleContainer(actor, type, postId);
  if (!container.open) throw conflict('Comments are closed here', 'CONTENT_LOCKED');

  let parentId: Types.ObjectId | null = null;
  if (input.parentId) {
    const parent = await Comment.findOne({
      $and: [{ _id: input.parentId, postId }, targetFilter(type)],
    });
    if (!parent || parent.status !== 'published') throw notFound('Comment not found');
    // One level of nesting: a reply to a reply is attached to the top-level comment.
    parentId = parent.parentId ?? parent._id;
  }
  const comment = await Comment.create({
    postId,
    targetType: type,
    parentId,
    authorId: actor.userId,
    body: input.body,
  });
  await adjustCounts(comment, 1);
  await recordAudit({
    actorId: actor.userId,
    action: 'comment.created',
    targetType: 'comment',
    targetId: comment._id,
    metadata: { postId: String(postId), reply: Boolean(parentId) },
    ip: actor.ip,
  });
  return (await toCommentDTOs(actor, [comment]))[0]!;
}

export async function updateComment(
  actor: Actor,
  id: Types.ObjectId,
  body: string,
): Promise<CommentDTO> {
  const comment = await Comment.findById(id);
  if (!comment || comment.status === 'deleted' || String(comment.authorId) !== actor.userId)
    throw notFound('Comment not found');
  if (comment.status !== 'published')
    throw conflict('Moderated comments can no longer be edited', 'CONTENT_LOCKED');
  // The post/video must still be visible and open: no edits under deleted or moderated content.
  const container = await loadVisibleContainer(actor, comment.targetType ?? 'post', comment.postId);
  if (!container.open) throw conflict('Comments here can no longer be edited', 'CONTENT_LOCKED');
  if (body === comment.body) throw invalid('body', 'Nothing to change');
  comment.edits.push({ at: new Date(), body: comment.body });
  while (comment.edits.length > MAX_EDIT_HISTORY) comment.edits.shift();
  comment.body = body;
  comment.editedAt = new Date();
  await comment.save();
  await recordAudit({
    actorId: actor.userId,
    action: 'comment.updated',
    targetType: 'comment',
    targetId: comment._id,
    ip: actor.ip,
  });
  return (await toCommentDTOs(actor, [comment]))[0]!;
}

export async function deleteComment(actor: Actor, id: Types.ObjectId): Promise<void> {
  const comment = await Comment.findById(id);
  if (!comment || comment.status === 'deleted' || String(comment.authorId) !== actor.userId)
    throw notFound('Comment not found');
  await transitionComment(id, ['published', 'hidden', 'removed'], 'deleted', {
    at: new Date(),
    by: actor.userId as unknown as Types.ObjectId,
    action: 'author_deleted',
  });
  await recordAudit({
    actorId: actor.userId,
    action: 'comment.deleted',
    targetType: 'comment',
    targetId: id,
    ip: actor.ip,
  });
}
