import {
  ProviderError,
  WebhookAuthError,
  type DirectUpload,
  type LiveInput,
  type ProviderAsset,
  type ProviderEvent,
  type SignedPlayback,
  type VideoProvider,
} from './types';

/**
 * `VIDEO_PROVIDER=none`: no streaming account is configured. Creating a video or a live stream is refused before
 * anything is recorded (see `requireVideoProvider` in media.routes.ts); anything that still reaches the provider fails
 * like an outage, and every webhook is rejected because there is no secret to verify it with.
 */
export class DisabledVideoProvider implements VideoProvider {
  readonly name = 'none';

  private off(): never {
    throw new ProviderError('Video streaming is not configured (VIDEO_PROVIDER=none)', 503);
  }

  createDirectUpload(): Promise<DirectUpload> {
    return Promise.resolve().then(() => this.off());
  }
  getAsset(): Promise<ProviderAsset | null> {
    return Promise.resolve(null);
  }
  deleteAsset(): Promise<void> {
    return Promise.resolve();
  }
  createLiveInput(): Promise<LiveInput> {
    return Promise.resolve().then(() => this.off());
  }
  getLiveInput(): Promise<LiveInput | null> {
    return Promise.resolve(null);
  }
  deleteLiveInput(): Promise<void> {
    return Promise.resolve();
  }
  signedPlayback(): Promise<SignedPlayback> {
    return Promise.resolve().then(() => this.off());
  }
  parseWebhook(): ProviderEvent {
    throw new WebhookAuthError('Video webhooks are not accepted: VIDEO_PROVIDER=none');
  }
}
