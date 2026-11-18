import { z } from 'zod';
import {
  LIVE_ACCESS,
  POST_VISIBILITIES,
  VIDEO_LIMITS,
  VIDEO_UPLOAD_MIME_TYPES,
} from '@farmplus/shared-types';

const objectId = z.string().regex(/^[0-9a-f]{24}$/, 'Invalid id');
// Same rule as posts: no control / bidi-override characters in user text.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F‪-‮⁦-⁩]/;
const plain = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `At most ${max} characters`)
    .refine((v) => !CONTROL.test(v), 'Contains characters that are not allowed');

/** What the client declares before uploading. The API checks it against server-side limits; the provider re-checks the bytes. */
export const createVideoUploadSchema = z
  .object({
    title: plain(VIDEO_LIMITS.title).min(1, 'Give the video a title'),
    caption: plain(VIDEO_LIMITS.caption).optional(),
    filename: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .refine((v) => !/[\\/]/.test(v), 'Invalid file name'),
    mimeType: z.enum(VIDEO_UPLOAD_MIME_TYPES, { error: 'Unsupported video type' }),
    sizeBytes: z.number().int().positive('The file is empty'),
    visibility: z.enum(POST_VISIBILITIES).default('public'),
  })
  .strict();

export const updateVideoSchema = z
  .object({
    title: plain(VIDEO_LIMITS.title).min(1).optional(),
    caption: plain(VIDEO_LIMITS.caption).nullable().optional(),
    visibility: z.enum(POST_VISIBILITIES).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to change' });

/** Client-reported watch time; the server decides whether it counts as a view. */
export const videoViewSchema = z.object({ watchedSeconds: z.number().min(0).max(3600) }).strict();

const limit = z.coerce.number().int().min(1).max(30).default(10);
const cursor = z.string().min(1).max(300).optional();

export const videoFeedQuerySchema = z
  .object({
    cursor,
    limit,
    scope: z.enum(['all', 'following']).default('all'),
    creatorId: objectId.optional(),
    /** The creator's own list: `mine=true` includes videos that are still processing or failed. */
    mine: z
      .enum(['true', 'false'])
      .transform((v) => v === 'true')
      .optional(),
  })
  .strict();

export const createLiveSchema = z
  .object({
    title: plain(VIDEO_LIMITS.liveTitle).min(1, 'Give the live stream a title'),
    description: plain(VIDEO_LIMITS.liveDescription).optional(),
    access: z.enum(LIVE_ACCESS).default('public'),
  })
  .strict();

export const liveListQuerySchema = z
  .object({
    cursor,
    limit,
    state: z.enum(['live', 'created', 'ended']).default('live'),
    hostId: objectId.optional(),
  })
  .strict();

export type CreateVideoUploadInput = z.infer<typeof createVideoUploadSchema>;
export type CreateLiveInput = z.infer<typeof createLiveSchema>;
