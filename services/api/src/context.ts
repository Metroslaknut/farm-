import type { ApiEnv } from '@farmplus/config/server';
import type { TokenSigner } from './lib/jwt';
import type { Access } from './rbac/access';
import type { VideoProvider } from './modules/media/provider';
import type { PaymentProvider } from './modules/finance/provider';
import type { ShippingProvider } from './modules/shipping/provider';
import type { AiProvider } from './modules/ai/provider';
import type { Notifier } from './services/notifier';

export interface AppContext {
  env: ApiEnv;
  signer: TokenSigner;
  notifier: Notifier;
  /** AES-256 key protecting TOTP secrets at rest. */
  mfaKey: Buffer;
  /** Video/live streaming provider (credentials stay inside the adapter). */
  video: VideoProvider;
  /** Optional rate provider (null = only the seller's own shipping terms quote). */
  shipping: ShippingProvider | null;
  /** Payment provider (null = online payment disabled). Credentials stay inside the adapter. */
  payments: PaymentProvider | null;
  /** AI provider (null = no AI explanation). The API key never leaves the adapter. */
  ai: AiProvider | null;
}

export interface RequestMeta {
  ip?: string | undefined;
  userAgent?: string | undefined;
}

/** The authenticated caller, as established by the `authenticate` middleware. */
export interface Actor {
  userId: string;
  sessionId: string;
  mfaVerified: boolean;
  access: Access;
  ip?: string | undefined;
}
