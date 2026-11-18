import { createHmac, randomBytes } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';
import { safeEqual, verifyHmacHeader } from './signature';
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

interface StoredAsset {
  id: string;
  state: ProviderAsset['state'];
  maxBytes: number;
  expiresAt: Date;
  bytes?: Buffer;
  mimeType?: string;
}

/**
 * DEVELOPMENT / TEST STAND-IN for a real provider (refused in production by the env schema). It keeps uploaded files in
 * memory and serves them through signed URLs so the whole flow can be exercised without credentials. It is not
 * media infrastructure: nothing is transcoded, persisted or scaled.
 */
export class MockVideoProvider implements VideoProvider {
  readonly name = 'mock';
  private readonly assets = new Map<string, StoredAsset>();
  private readonly inputs = new Map<string, LiveInput>();
  private readonly signingKey = randomBytes(32);

  constructor(private readonly webhookSecret: string) {}

  async createDirectUpload(input: DirectUploadInput): Promise<DirectUpload> {
    const id = randomBytes(16).toString('hex');
    this.assets.set(id, {
      id,
      state: 'pending_upload',
      maxBytes: input.maxBytes,
      expiresAt: input.expiresAt,
    });
    return {
      providerAssetId: id,
      url: `/api/v1/media/dev/uploads/${id}`,
      method: 'POST',
      encoding: 'raw',
    };
  }

  /** Called by the dev upload route. Returns the asset after the (instant) "processing". */
  receiveUpload(id: string, bytes: Buffer, mimeType: string): ProviderAsset {
    const asset = this.assets.get(id);
    if (!asset || asset.state !== 'pending_upload' || asset.expiresAt < new Date())
      throw new ProviderError('Unknown or expired upload', 404);
    if (bytes.length > asset.maxBytes) throw new ProviderError('File too large', 413);
    asset.bytes = bytes;
    asset.mimeType = mimeType;
    asset.state = 'ready';
    return this.describe(asset);
  }

  private describe(a: StoredAsset): ProviderAsset {
    return { providerAssetId: a.id, state: a.state, sizeBytes: a.bytes?.length };
  }

  async getAsset(id: string): Promise<ProviderAsset | null> {
    const a = this.assets.get(id);
    return a ? this.describe(a) : null;
  }
  async deleteAsset(id: string): Promise<void> {
    this.assets.delete(id);
  }
  readFile(id: string): { bytes: Buffer; mimeType: string } | null {
    const a = this.assets.get(id);
    return a?.bytes ? { bytes: a.bytes, mimeType: a.mimeType ?? 'video/mp4' } : null;
  }

  async createLiveInput(input: { liveId: string; title: string }): Promise<LiveInput> {
    const id = `mock-live-${input.liveId}`;
    const created = {
      providerInputId: id,
      rtmpsUrl: 'rtmps://live.mock.invalid:443/live/',
      streamKey: randomBytes(12).toString('hex'),
    };
    this.inputs.set(id, created);
    return created;
  }
  async getLiveInput(id: string): Promise<LiveInput | null> {
    return this.inputs.get(id) ?? null;
  }
  async deleteLiveInput(id: string): Promise<void> {
    this.inputs.delete(id);
  }

  private token(kind: string, id: string, exp: number): string {
    return createHmac('sha256', this.signingKey).update(`${kind}.${id}.${exp}`).digest('hex');
  }
  /** Used by the dev file route. */
  verifyFileToken(id: string, exp: number, token: string): boolean {
    return exp * 1000 > Date.now() && safeEqual(token, this.token('asset', id, exp));
  }

  async signedPlayback(
    target: { kind: 'asset' | 'live'; providerId: string },
    ttlSeconds: number,
  ): Promise<SignedPlayback> {
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
    const exp = Math.floor(expiresAt.getTime() / 1000);
    const t = this.token(target.kind, target.providerId, exp);
    return {
      url: `/api/v1/media/dev/files/${target.providerId}?exp=${exp}&token=${t}`,
      expiresAt,
    };
  }

  parseWebhook(rawBody: Buffer, headers: IncomingHttpHeaders, now = new Date()): ProviderEvent {
    verifyHmacHeader(this.webhookSecret, headers, rawBody, now);
    let body: {
      type?: string;
      providerAssetId?: string;
      providerInputId?: string;
      asset?: ProviderAsset;
    };
    try {
      body = JSON.parse(rawBody.toString('utf8'));
    } catch {
      return { type: 'ignored', reason: 'invalid json' };
    }
    if (body.type === 'asset.updated' && body.asset)
      return { type: 'asset.updated', asset: body.asset };
    if (body.type === 'asset.deleted' && body.providerAssetId)
      return { type: 'asset.deleted', providerAssetId: body.providerAssetId };
    if (body.type === 'live.connected' && body.providerInputId)
      return { type: 'live.connected', providerInputId: body.providerInputId };
    if (body.type === 'live.disconnected' && body.providerInputId)
      return { type: 'live.disconnected', providerInputId: body.providerInputId };
    return { type: 'ignored', reason: 'unknown event' };
  }
}
