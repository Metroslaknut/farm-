/**
 * Community feed (Part 09). Everything here is what the API returns / accepts; clients never see e-mails or
 * internal moderation notes of other users.
 */

export const POST_VISIBILITIES = ['public', 'followers', 'private'] as const;
export type PostVisibility = (typeof POST_VISIBILITIES)[number];

/** `published` is the only status shown to others. `hidden`/`removed` are set by moderators, `deleted` by the author. */
export const CONTENT_STATUSES = ['published', 'hidden', 'removed', 'deleted'] as const;
export type ContentStatus = (typeof CONTENT_STATUSES)[number];

export const POST_MEDIA_KINDS = ['image', 'video'] as const;
export type PostMediaKind = (typeof POST_MEDIA_KINDS)[number];

export const REACTION_TYPES = ['like'] as const;
export type ReactionType = (typeof REACTION_TYPES)[number];

export const FEED_SCOPES = ['all', 'following'] as const;
export type FeedScope = (typeof FEED_SCOPES)[number];
/** `recent`: newest first. `trending`: last 7 days, ordered by engagement (reactions + 2 × comments). */
export const FEED_SORTS = ['recent', 'trending'] as const;
export type FeedSort = (typeof FEED_SORTS)[number];

export const REPORT_TARGETS = ['post', 'comment', 'video', 'live'] as const;
export type ReportTarget = (typeof REPORT_TARGETS)[number];
export const REPORT_REASONS = [
  'spam',
  'abuse',
  'misinformation',
  'animal_cruelty',
  'illegal',
  'other',
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];
export const REPORT_STATUSES = ['open', 'actioned', 'dismissed'] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];
/** What a moderator may do when resolving a report. */
export const MODERATION_ACTIONS = ['dismiss', 'hide', 'remove'] as const;
export type ModerationAction = (typeof MODERATION_ACTIONS)[number];

export const POST_LIMITS = { body: 2000, media: 4, comment: 1000, caption: 200 } as const;

export interface CursorPage<T> {
  items: T[];
  /** Pass back as `cursor` to get the next page; absent on the last page. */
  nextCursor?: string;
}

export interface PublicAuthor {
  id: string;
  displayName: string;
  avatarUrl?: string | null;
}

export interface PostMedia {
  id: string;
  kind: PostMediaKind;
  url: string;
  mimeType?: string | null;
  caption?: string | null;
}

export interface ModerationEntry {
  at: string;
  by: string;
  action: string;
  reason?: string | null;
}

export interface ViewerState {
  reacted: boolean;
}

export interface PostDTO {
  id: string;
  author: PublicAuthor;
  body: string;
  media: PostMedia[];
  visibility: PostVisibility;
  status: ContentStatus;
  reactionCount: number;
  commentCount: number;
  createdAt: string;
  editedAt?: string | null;
  viewer: ViewerState & { isAuthor: boolean; followsAuthor: boolean };
  /** Only for the author: why their post is not visible (never other users' internal notes). */
  moderationNotice?: string;
}

export interface CommentDTO {
  id: string;
  postId: string;
  parentId?: string | null;
  author: PublicAuthor;
  body: string;
  status: ContentStatus;
  reactionCount: number;
  replyCount: number;
  createdAt: string;
  editedAt?: string | null;
  viewer: ViewerState & { isAuthor: boolean };
}

export interface ReactionResult {
  reacted: boolean;
  reactionCount: number;
}

export interface UserProfileDTO {
  id: string;
  displayName: string;
  avatarUrl?: string | null;
  joinedAt: string;
  postCount: number;
  videoCount: number;
  followerCount: number;
  followingCount: number;
  isSelf: boolean;
  isFollowing: boolean;
}

export interface FollowResult {
  following: boolean;
  followerCount: number;
}

export interface ReportDTO {
  id: string;
  targetType: ReportTarget;
  targetId: string;
  /** Id of the post/video the reported content belongs to (the target itself for posts, videos, live). */
  postId: string;
  containerType: 'post' | 'video' | 'live';
  reason: ReportReason;
  details?: string | null;
  status: ReportStatus;
  createdAt: string;
  reporter: PublicAuthor;
  /** What was reported, as it was when reported — evidence even if the author edits or deletes it later. */
  snapshot: { body: string; author: PublicAuthor; media: PostMedia[] };
  targetStatus: ContentStatus;
  /** How many open reports exist for the same target. */
  reportsOnTarget: number;
  resolution?: {
    action: ModerationAction;
    note?: string | null;
    by: string;
    at: string;
  };
}

export interface ModerationHistoryDTO {
  entries: (ModerationEntry & { byName: string })[];
}
