import type { IncomingHttpHeaders } from 'node:http';
import type { VideoFailureCode } from '@farmplus/shared-types';
import { hasHeader, verifyHmacHeader, verifySecretHeader } from './signature';
import {
  ProviderError,
  type DirectUpload,
  type DirectUploadInput,
  type LiveInput,
  type ProviderAsset,
  type ProviderEvent,
  type SignedPlayback,
  type VideoProvider,
} from './types';

export interface CloudflareConfig {
  accountId: string;
  apiToken: string;
  customerCode: string;
  webhookSecret: string;
  /** Injectable for tests. */
  fetch?: typeof fetch;
}

interface CfEnvelope<T> {
  success: boolean;
  result: T;
  errors?: { code: number; message: string }[];
}

interface CfVideo {
  uid: string;
  readyToStream?: boolean;
  duration?: number;
  size?: number;
  input?: { width?: number; height?: number };
  status?: { state?: string; errorReasonCode?: string; errorReasonText?: string };
}

const FAILURE_CODES: Record<string, VideoFailureCode> = {
  ERR_DURATION_EXCEED_CONSTRAINT: 'too_long',
  ERR_NON_VIDEO: 'unsupported_format',
  ERR_UNSUPPORTED_CODEC: 'unsupported_format',
  ERR_INVALID_INPUT: 'unsupported_format',
};

/** Cloudflare Stream adapter (direct creator uploads, live inputs, signed playback tokens). The API token never leaves the server. */
export class CloudflareStreamProvider implements VideoProvider {
  readonly name = 'cloudflare';
  private readonly http: typeof fetch;
  private readonly base: string;

  constructor(private readonly cfg: CloudflareConfig) {
    this.http = cfg.fetch ?? fetch;
    this.base = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(cfg.accountId)}/stream`;
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T | null> {
    let res: Response;
    try {
      res = await this.http(`${this.base}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${this.cfg.apiToken}`,
          'content-type': 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new ProviderError('The video provider is unreachable');
    }
    if (res.status === 404) return null;
    const json = (await res.json().catch(() => null)) as CfEnvelope<T> | null;
    if (!res.ok || !json?.success) {
      // Never include the provider's raw error body in what reaches clients.
      throw new ProviderError(`Video provider request failed (${res.status})`, res.status);
    }
    return json.result;
  }

  async createDirectUpload(input: DirectUploadInput): Promise<DirectUpload> {
    const result = await this.call<{ uploadURL: string; uid: string }>('POST', '/direct_upload', {
      maxDurationSeconds: input.maxDurationSeconds,
      expiry: input.expiresAt.toISOString(),
      creator: input.creatorId,
      // Every playback goes through a short-lived token that FARM+ issues after its own authorisation check.
      requireSignedURLs: true,
      meta: { farmplusVideoId: input.videoId },
    });
    if (!result) throw new ProviderError('Video provider returned no upload URL');
    return {
      providerAssetId: result.uid,
      url: result.uploadURL,
      method: 'POST',
      encoding: 'multipart',
    };
  }

  private toAsset(v: CfVideo): ProviderAsset {
    const state = v.status?.state;
    const base = {
      providerAssetId: v.uid,
      durationSeconds: v.duration && v.duration > 0 ? v.duration : undefined,
      width: v.input?.width && v.input.width > 0 ? v.input.width : undefined,
      height: v.input?.height && v.input.height > 0 ? v.input.height : undefined,
      sizeBytes: v.size,
    };
    if (state === 'error')
      return {
        ...base,
        state: 'failed',
        failure: {
          code: FAILURE_CODES[v.status?.errorReasonCode ?? ''] ?? 'processing_failed',
          message: v.status?.errorReasonText?.slice(0, 200) ?? 'The video could not be processed',
        },
      };
    if (state === 'ready' || v.readyToStream) return { ...base, state: 'ready' };
    if (state === 'pendingupload') return { ...base, state: 'pending_upload' };
    return { ...base, state: 'processing' };
  }

  async getAsset(id: string): Promise<ProviderAsset | null> {
    const v = await this.call<CfVideo>('GET', `/${encodeURIComponent(id)}`);
    return v ? this.toAsset(v) : null;
  }

  async deleteAsset(id: string): Promise<void> {
    await this.call('DELETE', `/${encodeURIComponent(id)}`); // 404 = already gone
  }

  async createLiveInput(input: { liveId: string; title: string }): Promise<LiveInput> {
    const r = await this.call<{ uid: string; rtmps: { url: string; streamKey: string } }>(
      'POST',
      '/live_inputs',
      {
        meta: { name: input.title.slice(0, 100), farmplusLiveId: input.liveId },
        recording: { mode: 'off' },
      },
    );
    if (!r?.rtmps) throw new ProviderError('Video provider returned no live input');
    return { providerInputId: r.uid, rtmpsUrl: r.rtmps.url, streamKey: r.rtmps.streamKey };
  }

  async getLiveInput(id: string): Promise<LiveInput | null> {
    const r = await this.call<{ uid: string; rtmps?: { url: string; streamKey: string } }>(
      'GET',
      `/live_inputs/${encodeURIComponent(id)}`,
    );
    return r?.rtmps
      ? { providerInputId: r.uid, rtmpsUrl: r.rtmps.url, streamKey: r.rtmps.streamKey }
      : null;
  }

  async deleteLiveInput(id: string): Promise<void> {
    await this.call('DELETE', `/live_inputs/${encodeURIComponent(id)}`);
  }

  async signedPlayback(
    target: { kind: 'asset' | 'live'; providerId: string },
    ttlSeconds: number,
  ): Promise<SignedPlayback> {
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
    const r = await this.call<{ token: string }>(
      'POST',
      `/${encodeURIComponent(target.providerId)}/token`,
      { exp: Math.floor(expiresAt.getTime() / 1000) },
    );
    if (!r?.token) throw new ProviderError('Video provider returned no playback token');
    const host = `https://customer-${this.cfg.customerCode}.cloudflarestream.com/${r.token}`;
    return {
      url: `${host}/manifest/video.m3u8`,
      thumbnailUrl: `${host}/thumbnails/thumbnail.jpg?height=600`,
      expiresAt,
    };
  }

  parseWebhook(rawBody: Buffer, headers: IncomingHttpHeaders, now = new Date()): ProviderEvent {
    // Stream webhooks are HMAC-signed; Cloudflare notification channels send the secret in a header instead.
    if (hasHeader(headers, 'webhook-signature'))
      verifyHmacHeader(this.cfg.webhookSecret, headers, rawBody, now);
    else verifySecretHeader(this.cfg.webhookSecret, headers, 'cf-webhook-auth');

    let body: Record<string, unknown>;
    try {
      body = JSON.parse(rawBody.toString('utf8')) as Record<string, unknown>;
    } catch {
      return { type: 'ignored', reason: 'invalid json' };
    }
    const data = (body['data'] ?? {}) as Record<string, unknown>;
    const eventType = typeof data['event_type'] === 'string' ? data['event_type'] : undefined;
    const inputId = typeof data['input_id'] === 'string' ? data['input_id'] : undefined;
    if (eventType && inputId) {
      if (eventType === 'live_input.connected')
        return { type: 'live.connected', providerInputId: inputId };
      if (eventType === 'live_input.disconnected' || eventType === 'live_input.errored')
        return { type: 'live.disconnected', providerInputId: inputId };
      return { type: 'ignored', reason: eventType };
    }
    if (typeof body['uid'] === 'string')
      return { type: 'asset.updated', asset: this.toAsset(body as unknown as CfVideo) };
    return { type: 'ignored', reason: 'unknown payload' };
  }
}
