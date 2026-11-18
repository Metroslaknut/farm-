import type { Express } from 'express';
import request from 'supertest';
import type { ApiEnv } from '@farmplus/config/server';
import {
  MockVideoProvider,
  ProviderError,
  signWebhook,
  type ProviderAsset,
} from '../src/modules/media/provider';
import { WEBHOOK_SECRET, type Session } from './helpers';

export const API = '/api/v1';

/** Responses carry absolute URLs (built from the request's Host); supertest wants the path. */
export const pathOf = (url: string): string => {
  const u = new URL(url, 'http://x');
  return u.pathname + u.search;
};

/** The mock provider plus failure injection and call recording. */
export class TestProvider extends MockVideoProvider {
  failUpload = false;
  failSign = false;
  failDelete = false;
  failGetAsset = false;
  failLive = false;
  deleted: string[] = [];
  liveDeleted: string[] = [];
  override = new Map<string, ProviderAsset | null>();

  constructor(env: ApiEnv) {
    super(env.VIDEO_WEBHOOK_SECRET!);
  }
  override async createDirectUpload(...a: Parameters<MockVideoProvider['createDirectUpload']>) {
    if (this.failUpload) throw new ProviderError('down');
    return super.createDirectUpload(...a);
  }
  override async signedPlayback(...a: Parameters<MockVideoProvider['signedPlayback']>) {
    if (this.failSign) throw new ProviderError('down');
    return super.signedPlayback(...a);
  }
  override async deleteAsset(id: string) {
    if (this.failDelete) throw new ProviderError('down');
    this.deleted.push(id);
    return super.deleteAsset(id);
  }
  override async getAsset(id: string) {
    if (this.failGetAsset) throw new ProviderError('down');
    if (this.override.has(id)) return this.override.get(id) ?? null;
    return super.getAsset(id);
  }
  override async createLiveInput(...a: Parameters<MockVideoProvider['createLiveInput']>) {
    if (this.failLive) throw new ProviderError('down');
    return super.createLiveInput(...a);
  }
  override async deleteLiveInput(id: string) {
    this.liveDeleted.push(id);
    return super.deleteLiveInput(id);
  }
}

export const videoBody = (over: Record<string, unknown> = {}) => ({
  title: 'Calf playing',
  filename: 'calf.mp4',
  mimeType: 'video/mp4',
  sizeBytes: 1000,
  ...over,
});

export async function requestTicket(
  app: Express,
  user: Session,
  over: Record<string, unknown> = {},
  expectStatus = 201,
) {
  const res = await request(app).post(`${API}/videos/uploads`).set(user.auth).send(videoBody(over));
  if (res.status !== expectStatus)
    throw new Error(`ticket ${res.status} ${JSON.stringify(res.body)}`);
  return res.body as {
    video: { id: string; processing: { state: string } };
    upload: { url: string; method: string; encoding: string; maxBytes: number };
  };
}

export const sendFile = (
  app: Express,
  url: string,
  type = 'video/mp4',
  bytes = Buffer.from('fake-video-bytes'),
) => request(app).post(pathOf(url)).set('content-type', type).send(bytes);

/** Ticket + upload through the dev route; the mock "processes" instantly, so the video is ready afterwards. */
export async function readyVideo(app: Express, user: Session, over: Record<string, unknown> = {}) {
  const t = await requestTicket(app, user, over);
  const up = await sendFile(app, t.upload.url);
  if (up.status !== 201) throw new Error(`upload ${up.status} ${JSON.stringify(up.body)}`);
  return t.video.id;
}

export function postWebhook(
  app: Express,
  event: object,
  opts: { secret?: string; time?: number; tamper?: boolean; header?: string | null } = {},
) {
  const body = JSON.stringify(event);
  const time = opts.time ?? Math.floor(Date.now() / 1000);
  const sig = signWebhook(opts.secret ?? WEBHOOK_SECRET, time, body);
  const r = request(app).post(`${API}/webhooks/video`).set('content-type', 'application/json');
  if (opts.header !== null) r.set('webhook-signature', opts.header ?? `time=${time},sig1=${sig}`);
  return r.send(opts.tamper ? body.replace('asset', 'asseT') : body);
}

export const assetEvent = (providerAssetId: string, over: Partial<ProviderAsset> = {}) => ({
  type: 'asset.updated',
  asset: { providerAssetId, state: 'ready', ...over },
});
