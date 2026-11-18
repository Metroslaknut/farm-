import { z } from 'zod';
import {
  FEED_SCOPES,
  FEED_SORTS,
  MODERATION_ACTIONS,
  POST_LIMITS,
  POST_MEDIA_KINDS,
  POST_VISIBILITIES,
  REACTION_TYPES,
  REPORT_REASONS,
  REPORT_STATUSES,
  REPORT_TARGETS,
} from '@farmplus/shared-types';

const objectId = z.string().regex(/^[0-9a-f]{24}$/, 'Invalid id');
// Control characters (except newline/tab) have no place in a social post and are used to spoof text.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F‪-‮⁦-⁩]/;
const plainText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `At most ${max} characters`)
    .refine((v) => !CONTROL.test(v), 'Contains characters that are not allowed');

export const postMediaInputSchema = z
  .object({
    kind: z.enum(POST_MEDIA_KINDS),
    /** Location of a file already uploaded to the external object store (https only). */
    url: z.url({ protocol: /^https$/ }).max(1000),
    mimeType: z
      .string()
      .trim()
      .regex(/^[a-z]+\/[a-z0-9.+-]+$/i, 'Invalid MIME type')
      .max(100)
      .optional(),
    caption: plainText(POST_LIMITS.caption).optional(),
  })
  .strict()
  .superRefine((m, ctx) => {
    if (!m.mimeType) return;
    const prefix = m.kind === 'image' ? 'image/' : 'video/';
    if (!m.mimeType.toLowerCase().startsWith(prefix))
      ctx.addIssue({
        code: 'custom',
        path: ['mimeType'],
        message: `A ${m.kind} must be ${prefix}*`,
      });
  });

const mediaList = z.array(postMediaInputSchema).max(POST_LIMITS.media);

const hasContent = (v: { body?: string | undefined; media?: unknown[] | undefined }) =>
  (v.body && v.body.length > 0) || (v.media && v.media.length > 0);

export const createPostSchema = z
  .object({
    body: plainText(POST_LIMITS.body).default(''),
    media: mediaList.default([]),
    visibility: z.enum(POST_VISIBILITIES).default('public'),
  })
  .strict()
  .refine(hasContent, { message: 'Write something or attach a photo or video', path: ['body'] });

export const updatePostSchema = z
  .object({
    body: plainText(POST_LIMITS.body).optional(),
    media: mediaList.optional(),
    visibility: z.enum(POST_VISIBILITIES).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to change' });

export const createCommentSchema = z
  .object({
    body: plainText(POST_LIMITS.comment).min(1, 'Write a comment'),
    /** Reply to a comment. Replies to replies attach to the top-level comment (one level of nesting). */
    parentId: objectId.optional(),
  })
  .strict();

export const updateCommentSchema = z
  .object({ body: plainText(POST_LIMITS.comment).min(1, 'Write a comment') })
  .strict();

export const reactionSchema = z.object({ type: z.enum(REACTION_TYPES).default('like') }).strict();

export const reportSchema = z
  .object({ reason: z.enum(REPORT_REASONS), details: plainText(500).optional() })
  .strict();

const limit = z.coerce.number().int().min(1).max(50).default(20);
const cursor = z.string().min(1).max(300).optional();

export const feedQuerySchema = z
  .object({
    cursor,
    limit,
    scope: z.enum(FEED_SCOPES).default('all'),
    sort: z.enum(FEED_SORTS).default('recent'),
    authorId: objectId.optional(),
  })
  .strict();

export const commentListQuerySchema = z
  .object({ cursor, limit, parentId: objectId.optional() })
  .strict();

export const reportListQuerySchema = z
  .object({ cursor, limit, status: z.enum(REPORT_STATUSES).default('open') })
  .strict();

export const resolveReportSchema = z
  .object({ action: z.enum(MODERATION_ACTIONS), note: plainText(500).optional() })
  .strict();

export const moderateContentSchema = z
  .object({
    status: z.enum(['published', 'hidden', 'removed']),
    reason: plainText(500).min(3, 'Give a reason'),
  })
  .strict();

export const moderationTargetSchema = z.enum(REPORT_TARGETS);

export type CreatePostInput = z.infer<typeof createPostSchema>;
export type UpdatePostInput = z.infer<typeof updatePostSchema>;
export type CreateCommentInput = z.infer<typeof createCommentSchema>;
