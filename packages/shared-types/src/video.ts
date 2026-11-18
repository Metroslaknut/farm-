/**
 * Short video & live streaming (Part 10). Files and streams live at an external video provider; FARM+ only stores
 * metadata, processing state and authorisation. Provider credentials never appear in any of these types.
 */
import type { ContentStatus, PostVisibility, PublicAuthor } from './community';

export const VIDEO_PROCESSING_STATES = ['pending_upload', 'processing', 'ready', 'failed'] as const;
export type VideoProcessingState = (typeof VIDEO_PROCESSING_STATES)[number];

export const VIDEO_FAILURE_CODES = [
  'upload_expired',
  'upload_cancelled',
  'processing_failed',
  'too_long',
  'unsupported_format',
  'provider_error',
] as const;
export type VideoFailureCode = (typeof VIDEO_FAILURE_CODES)[number];

/** Containers the API accepts for upload (checked on declaration; the provider validates the real bytes too). */
export const VIDEO_UPLOAD_MIME_TYPES = [
  'video/mp4',
  'video/quicktime',
  'video/webm',
  'video/x-m4v',
] as const;

export const LIVE_STATES = ['created', 'live', 'interrupted', 'ended', 'failed'] as const;
export type LiveState = (typeof LIVE_STATES)[number];
export const LIVE_ACCESS = ['public', 'followers'] as const;
export type LiveAccess = (typeof LIVE_ACCESS)[number];

export const VIDEO_LIMITS = {
  title: 120,
  caption: 500,
  liveTitle: 120,
  liveDescription: 500,
} as const;

/**
 * Returned by `GET /videos/:id/playback` and `GET /live/:id/playback`, after FARM+ authorised the caller. Clients ask for
 * the current and the adjacent videos only, so the feed itself stays cheap and tokens stay short-lived.
 */
export interface PlaybackInfo {
  /** HLS manifest (`.m3u8`) or a direct file URL; short-lived and personal to the caller. */
  url: string;
  thumbnailUrl?: string | undefined;
  expiresAt: string;
}

export interface VideoDTO {
  id: string;
  creator: PublicAuthor;
  title: string;
  caption?: string | null;
  visibility: PostVisibility;
  /** Moderation status (same values as posts). Only `published` + `ready` videos reach other users. */
  status: ContentStatus;
  processing: {
    state: VideoProcessingState;
    failure?: { code: VideoFailureCode; message: string } | undefined;
  };
  durationSeconds?: number | null;
  width?: number | null;
  height?: number | null;
  viewCount: number;
  reactionCount: number;
  commentCount: number;
  createdAt: string;
  readyAt?: string | null;
  viewer: { reacted: boolean; isCreator: boolean; followsCreator: boolean };
  moderationNotice?: string | undefined;
}

export interface VideoUploadTicket {
  video: VideoDTO;
  upload: {
    /** Where the client sends the file (one-time URL issued by the provider). */
    url: string;
    method: 'POST' | 'PUT';
    /** `multipart` = form field `file` (Cloudflare direct upload); `raw` = request body is the file. */
    encoding: 'multipart' | 'raw';
    expiresAt: string;
    maxBytes: number;
  };
}

export interface ViewResult {
  counted: boolean;
  viewCount: number;
}

export interface LiveDTO {
  id: string;
  host: PublicAuthor;
  title: string;
  description?: string | null;
  access: LiveAccess;
  state: LiveState;
  status: ContentStatus;
  startedAt?: string | null;
  endedAt?: string | null;
  createdAt: string;
  viewer: { isHost: boolean; followsHost: boolean };
  moderationNotice?: string | undefined;
}

/** Shown to the host only (never in lists or to viewers). */
export interface LiveIngest {
  rtmpsUrl: string;
  streamKey: string;
}

export interface VideoLimitsDTO {
  maxUploadBytes: number;
  maxDurationSeconds: number;
  mimeTypes: readonly string[];
  provider: string;
}
