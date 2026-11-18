import type { Types } from 'mongoose';
import type { ContentStatus, CursorPage, PostDTO, PostMedia } from '@farmplus/shared-types';
import type { CreatePostInput, UpdatePostInput } from '@farmplus/validation';
import type { Actor } from '../../context';
import { conflict, notFound } from '../../lib/errors';
import { Follow, Post, type PostDoc } from '../../models';
import { recordAudit } from '../../services/audit.service';
import { assertMediaUrlAllowed, type MediaPolicy } from '../animals/animals.service';
import {
  MODERATION_NOTICE,
  authorOf,
  authorsById,
  decodeCursor,
  encodeCursor,
  followedSet,
  invalid,
  reactedSet,
} from './shared';

const TRENDING_DAYS = 7;
const MAX_FOLLOWEES_IN_FEED = 2000;
const MAX_EDIT_HISTORY = 10;

// ---------------------------------------------------------------------------
// Visibility: ONE place decides who may see a post. Everything else (feed, by id, comments, reactions, reports)
// goes through `loadVisiblePost`, so a hidden/private post cannot leak through a side door.
// ---------------------------------------------------------------------------
export async function loadVisiblePost(actor: Actor, postId: Types.ObjectId): Promise<PostDoc> {
  const post = await Post.findById(postId);
  if (!post || post.status === 'deleted') throw notFound('Post not found');
  const isAuthor = String(post.authorId) === actor.userId;
  if (isAuthor) return post; // authors always see their own (also when moderated, with a notice)
  if (post.status !== 'published') throw notFound('Post not found');
  if (post.visibility === 'public') return post;
  if (post.visibility === 'followers') {
    const follows = await Follow.exists({ followerId: actor.userId, followeeId: post.authorId });
    if (follows) return post;
  }
  throw notFound('Post not found'); // private, or followers-only to a non-follower: indistinguishable from missing
}

export async function toPostDTOs(actor: Actor, posts: PostDoc[]): Promise<PostDTO[]> {
  const [authors, reacted, followed] = await Promise.all([
    authorsById(posts.map((p) => p.authorId)),
    reactedSet(
      actor.userId,
      'post',
      posts.map((p) => p._id),
    ),
    followedSet(
      actor.userId,
      posts.map((p) => p.authorId),
    ),
  ]);
  return posts.map((p) => {
    const isAuthor = String(p.authorId) === actor.userId;
    const notice = isAuthor ? MODERATION_NOTICE[p.status] : undefined;
    const media: PostMedia[] = p.media.map((m) => ({
      id: String(m._id),
      kind: m.kind,
      url: m.url,
      mimeType: m.mimeType ?? null,
      caption: m.caption ?? null,
    }));
    return {
      id: String(p._id),
      author: authorOf(authors, p.authorId),
      body: p.body,
      media,
      visibility: p.visibility,
      status: p.status,
      reactionCount: p.reactionCount,
      commentCount: p.commentCount,
      createdAt: p.createdAt.toISOString(),
      editedAt: p.editedAt?.toISOString() ?? null,
      viewer: {
        reacted: reacted.has(String(p._id)),
        isAuthor,
        followsAuthor: followed.has(String(p.authorId)),
      },
      ...(notice ? { moderationNotice: notice } : {}),
    };
  });
}

const audit = (actor: Actor, action: string, post: PostDoc, extra: Record<string, unknown> = {}) =>
  recordAudit({
    actorId: actor.userId,
    action,
    targetType: 'post',
    targetId: post._id,
    metadata: { visibility: post.visibility, ...extra },
    ip: actor.ip,
  });

function checkMedia(media: CreatePostInput['media'], policy: MediaPolicy): void {
  const seen = new Set<string>();
  media.forEach((m, i) => {
    assertMediaUrlAllowed(m.url, policy);
    if (seen.has(m.url)) throw invalid(`media.${i}.url`, 'This file is attached twice');
    seen.add(m.url);
  });
}

// ---------------------------------------------------------------------------
// Create / read / update / delete
// ---------------------------------------------------------------------------
export async function createPost(
  actor: Actor,
  input: CreatePostInput,
  policy: MediaPolicy,
): Promise<PostDTO> {
  checkMedia(input.media, policy);
  const post = await Post.create({
    authorId: actor.userId,
    body: input.body,
    media: input.media.map((m) => ({
      kind: m.kind,
      url: m.url,
      mimeType: m.mimeType ?? null,
      caption: m.caption ?? null,
    })),
    visibility: input.visibility,
  });
  await audit(actor, 'post.created', post, { media: post.media.length });
  return (await toPostDTOs(actor, [post]))[0]!;
}

export async function getPost(actor: Actor, id: Types.ObjectId): Promise<PostDTO> {
  return (await toPostDTOs(actor, [await loadVisiblePost(actor, id)]))[0]!;
}

async function loadOwnEditable(actor: Actor, id: Types.ObjectId): Promise<PostDoc> {
  const post = await Post.findById(id);
  // Not yours: same answer as a post that does not exist (no probing for private/hidden posts).
  if (!post || post.status === 'deleted' || String(post.authorId) !== actor.userId)
    throw notFound('Post not found');
  return post;
}

export async function updatePost(
  actor: Actor,
  id: Types.ObjectId,
  input: UpdatePostInput,
  policy: MediaPolicy,
): Promise<PostDTO> {
  const post = await loadOwnEditable(actor, id);
  if (post.status !== 'published')
    throw conflict('Moderated posts can no longer be edited', 'CONTENT_LOCKED');

  const body = input.body ?? post.body;
  const media =
    input.media ??
    post.media.map((m) => ({
      kind: m.kind,
      url: m.url,
      mimeType: m.mimeType ?? undefined,
      caption: m.caption ?? undefined,
    }));
  if (body.length === 0 && media.length === 0)
    throw invalid('body', 'Write something or attach a photo or video');
  if (input.media) checkMedia(input.media, policy);

  const bodyChanged = input.body !== undefined && input.body !== post.body;
  const mediaChanged =
    input.media !== undefined &&
    JSON.stringify(input.media.map((m) => m.url)) !== JSON.stringify(post.media.map((m) => m.url));
  const visibilityChanged = input.visibility !== undefined && input.visibility !== post.visibility;
  if (!bodyChanged && !mediaChanged && !visibilityChanged) return getPost(actor, id);

  if (bodyChanged) {
    post.edits.push({ at: new Date(), body: post.body });
    while (post.edits.length > MAX_EDIT_HISTORY) post.edits.shift();
    post.body = body;
  }
  if (input.media && mediaChanged) {
    post.set(
      'media',
      input.media.map((m) => ({
        kind: m.kind,
        url: m.url,
        mimeType: m.mimeType ?? null,
        caption: m.caption ?? null,
      })),
    );
  }
  if (input.visibility) post.visibility = input.visibility;
  if (bodyChanged || mediaChanged) post.editedAt = new Date();
  await post.save();
  await audit(actor, 'post.updated', post, {
    bodyChanged,
    mediaChanged,
    visibilityChanged,
  });
  return getPost(actor, id);
}

/** Soft delete: the author's content disappears for everyone, but moderators keep the evidence of earlier reports. */
export async function deletePost(actor: Actor, id: Types.ObjectId): Promise<void> {
  const post = await loadOwnEditable(actor, id);
  const previous = post.status;
  post.status = 'deleted';
  post.deletedAt = new Date();
  post.moderation.push({
    at: new Date(),
    by: actor.userId as unknown as Types.ObjectId,
    action: 'author_deleted',
    from: previous,
    to: 'deleted',
  });
  await post.save();
  await audit(actor, 'post.deleted', post, { previous });
}

// ---------------------------------------------------------------------------
// Feed
// ---------------------------------------------------------------------------
export interface FeedQuery {
  cursor?: string | undefined;
  limit: number;
  scope: 'all' | 'following';
  sort: 'recent' | 'trending';
  authorId?: string | undefined;
}

export async function listFeed(actor: Actor, query: FeedQuery): Promise<CursorPage<PostDTO>> {
  const me = actor.userId;
  const and: Record<string, unknown>[] = [];
  const own = query.authorId === me;

  if (query.authorId) {
    and.push({ authorId: query.authorId });
    if (own) {
      // Your own profile also shows what a moderator hid, so you know about it.
      and.push({ status: { $in: ['published', 'hidden', 'removed'] } });
    } else {
      and.push({ status: 'published' });
      const follows = await Follow.exists({ followerId: me, followeeId: query.authorId });
      and.push({ visibility: follows ? { $in: ['public', 'followers'] } : 'public' });
    }
  } else {
    and.push({ status: 'published' });
    const follows = await Follow.find({ followerId: me })
      .sort({ _id: -1 })
      .limit(MAX_FOLLOWEES_IN_FEED)
      .select('followeeId');
    const followeeIds = follows.map((f) => f.followeeId);
    if (query.scope === 'following') {
      and.push({ authorId: { $in: [...followeeIds, me] } });
    }
    and.push({
      $or: [
        { visibility: 'public' },
        { authorId: me },
        { visibility: 'followers', authorId: { $in: followeeIds } },
      ],
    });
  }

  const cursor = decodeCursor(query.cursor);
  let sort: Record<string, 1 | -1>;
  if (query.sort === 'trending') {
    and.push({ createdAt: { $gte: new Date(Date.now() - TRENDING_DAYS * 86_400_000) } });
    sort = { engagement: -1, _id: -1 };
    if (cursor)
      and.push({
        $or: [{ engagement: { $lt: cursor.k } }, { engagement: cursor.k, _id: { $lt: cursor.id } }],
      });
  } else {
    sort = { createdAt: -1, _id: -1 };
    if (cursor)
      and.push({
        $or: [
          { createdAt: { $lt: new Date(cursor.k) } },
          { createdAt: new Date(cursor.k), _id: { $lt: cursor.id } },
        ],
      });
  }

  const rows = await Post.find({ $and: and })
    .sort(sort)
    .limit(query.limit + 1);
  const page = rows.slice(0, query.limit);
  const last = page[page.length - 1];
  const nextCursor =
    rows.length > query.limit && last
      ? encodeCursor(
          query.sort === 'trending' ? last.engagement : last.createdAt.getTime(),
          last._id,
        )
      : undefined;
  return { items: await toPostDTOs(actor, page), ...(nextCursor ? { nextCursor } : {}) };
}

export type { ContentStatus };
