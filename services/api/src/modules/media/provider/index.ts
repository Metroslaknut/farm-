import type { ApiEnv } from '@farmplus/config/server';
import { CloudflareStreamProvider } from './cloudflare';
import { DisabledVideoProvider } from './disabled';
import { MockVideoProvider } from './mock';
import type { VideoProvider } from './types';

export * from './types';
export { CloudflareStreamProvider } from './cloudflare';
export { MockVideoProvider } from './mock';
export { DisabledVideoProvider } from './disabled';
export { signWebhook } from './signature';

/** Picks the provider from the environment. Credentials are read here, on the server, and nowhere else. */
export function createVideoProvider(env: ApiEnv): VideoProvider {
  if (env.VIDEO_PROVIDER === 'none') return new DisabledVideoProvider();
  if (env.VIDEO_PROVIDER === 'cloudflare') {
    return new CloudflareStreamProvider({
      accountId: env.CLOUDFLARE_ACCOUNT_ID!,
      apiToken: env.CLOUDFLARE_STREAM_API_TOKEN!,
      customerCode: env.CLOUDFLARE_STREAM_CUSTOMER_CODE!,
      webhookSecret: env.VIDEO_WEBHOOK_SECRET!,
    });
  }
  return new MockVideoProvider(
    env.VIDEO_WEBHOOK_SECRET ?? 'dev-only-webhook-secret-not-for-production',
  );
}
