import type { IncomingHttpHeaders } from 'node:http';
import type { VideoFailureCode } from '@farmplus/shared-types';

/**
 * What FARM+ needs from a video streaming provider. Everything provider-specific (URLs, auth, payload formats,
 * webhook signatures) stays behind this interface, so swapping Cloudflare Stream for Mux or another service means
 * writing one adapter. No media is ever stored or transcoded by FARM+ itself.
 */
export interface DirectUploadInput {
  videoId: string;
  creatorId: string;
  maxBytes: number;
  maxDurationSeconds: number;
  expiresAt: Date;
}
export interface DirectUpload {
  providerAssetId: string;
  url: string;
  method: 'POST' | 'PUT';
  encoding: 'multipart' | 'raw';
}

export type ProviderAssetState = 'pending_upload' | 'processing' | 'ready' | 'failed';
export interface ProviderAsset {
  providerAssetId: string;
  state: ProviderAssetState;
  durationSeconds?: number | undefined;
  width?: number | undefined;
  height?: number | undefined;
  sizeBytes?: number | undefined;
  failure?: { code: VideoFailureCode; message: string } | undefined;
}

export interface LiveInput {
  providerInputId: string;
  rtmpsUrl: string;
  streamKey: string;
}

export interface SignedPlayback {
  url: string;
  thumbnailUrl?: string | undefined;
  expiresAt: Date;
}

/** Provider notifications, normalised. */
export type ProviderEvent =
  | { type: 'asset.updated'; asset: ProviderAsset }
  | { type: 'asset.deleted'; providerAssetId: string }
  | { type: 'live.connected'; providerInputId: string }
  | { type: 'live.disconnected'; providerInputId: string }
  | { type: 'ignored'; reason: string };

export class WebhookAuthError extends Error {
  constructor(message = 'Invalid webhook signature') {
    super(message);
    this.name = 'WebhookAuthError';
  }
}
export class ProviderError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export interface VideoProvider {
  readonly name: string;
  createDirectUpload(input: DirectUploadInput): Promise<DirectUpload>;
  getAsset(providerAssetId: string): Promise<ProviderAsset | null>;
  deleteAsset(providerAssetId: string): Promise<void>;
  createLiveInput(input: { liveId: string; title: string }): Promise<LiveInput>;
  /** Re-read the ingest address (the stream key is never stored in FARM+'s database). */
  getLiveInput(providerInputId: string): Promise<LiveInput | null>;
  deleteLiveInput(providerInputId: string): Promise<void>;
  /** Short-lived playback URL for one viewer. Called only after FARM+ authorised that viewer. */
  signedPlayback(
    target: { kind: 'asset' | 'live'; providerId: string },
    ttlSeconds: number,
  ): Promise<SignedPlayback>;
  /** Authenticate (throws `WebhookAuthError`) and normalise a webhook request. `rawBody` is the exact bytes received. */
  parseWebhook(rawBody: Buffer, headers: IncomingHttpHeaders, now?: Date): ProviderEvent;
}
