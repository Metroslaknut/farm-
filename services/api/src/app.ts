import { Buffer } from 'node:buffer';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { API_PREFIX } from '@farmplus/config';
import type { ApiEnv } from '@farmplus/config/server';
import type { AppContext } from './context';
import { TokenSigner } from './lib/jwt';
import { devMediaRouter } from './modules/media/dev-media.routes';
import {
  MockVideoProvider,
  createVideoProvider,
  type VideoProvider,
} from './modules/media/provider';
import { videoWebhookRouter } from './modules/media/webhook.routes';
import { createAiProvider, type AiProvider } from './modules/ai/provider';
import { financeWebhookRouter } from './modules/finance/finance.routes';
import { createPaymentProvider, type PaymentProvider } from './modules/finance/provider';
import { commerceWebhookRouter } from './modules/orders/orders.routes';
import { createShippingProvider, type ShippingProvider } from './modules/shipping/provider';
import { errorHandler } from './middleware/error-handler';
import { notFoundHandler } from './middleware/not-found';
import { requestContext } from './middleware/request-context';
import { noStore, requireHttps } from './middleware/transport-security';
import { healthRouter, readinessRouter } from './routes/health';
import { v1Router } from './routes/v1';
import { AuthService } from './services/auth.service';
import { ConsoleNotifier, UnconfiguredNotifier, type Notifier } from './services/notifier';

export interface AppDeps {
  /** Email/SMS provider. Defaults: console in development, no-op in production. */
  notifier?: Notifier;
  /** Override the video provider (tests). Defaults to the one configured by VIDEO_PROVIDER. */
  video?: VideoProvider;
  /** Override the shipping provider (tests). */
  shipping?: ShippingProvider | null;
  /** Override the payment provider (tests). */
  payments?: PaymentProvider | null;
  /** Override the AI provider (tests). */
  ai?: AiProvider | null;
}

export function createContext(env: ApiEnv, deps: AppDeps = {}): AppContext {
  return {
    env,
    signer: TokenSigner.fromEnv(env),
    notifier:
      deps.notifier ??
      (env.NODE_ENV === 'development' ? new ConsoleNotifier() : new UnconfiguredNotifier()),
    mfaKey: Buffer.from(env.MFA_ENCRYPTION_KEY, 'base64'),
    video: deps.video ?? createVideoProvider(env),
    shipping: deps.shipping === undefined ? createShippingProvider(env) : deps.shipping,
    payments: deps.payments === undefined ? createPaymentProvider(env) : deps.payments,
    ai: deps.ai === undefined ? createAiProvider(env) : deps.ai,
  };
}

export function createApp(env: ApiEnv, deps: AppDeps = {}): Express {
  const ctx = createContext(env, deps);
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', env.TRUST_PROXY);
  const production = env.NODE_ENV === 'production';
  // Request id + one access-log line per request (no bodies, no query strings). Probes are not logged.
  app.use(
    requestContext({
      skipPaths: ['/health', '/ready', `${API_PREFIX}/health`, `${API_PREFIX}/ready`],
    }),
  );
  app.use(
    helmet({
      // HSTS only where TLS is guaranteed: 180 days, subdomains included. (No `preload`: that is an irreversible opt-in.)
      strictTransportSecurity: production ? { maxAge: 15_552_000, includeSubDomains: true } : false,
      referrerPolicy: { policy: 'no-referrer' },
    }),
  );
  // Probes next: orchestrators call them over plain HTTP on the private network.
  app.use('/health', healthRouter(env));
  app.use('/ready', readinessRouter());
  if (production) app.use(requireHttps());
  app.use(
    cors({
      origin: env.CORS_ORIGINS, // exact origins only (production validation refuses wildcards, http and localhost)
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key', 'X-Request-Id'],
      // Browsers can only read these cross-origin response headers if they are listed (the CSV export uses the last two).
      exposedHeaders: ['X-Request-Id', 'X-Export-Truncated', 'Content-Disposition'],
      credentials: false, // tokens travel in the Authorization header; no cookies, so no ambient authority
      maxAge: 600,
    }),
  );
  app.use(API_PREFIX, noStore);
  // Raw-body routes first: webhook signatures cover the exact bytes, and dev uploads are binary.
  app.use(`${API_PREFIX}/webhooks`, videoWebhookRouter(ctx));
  app.use(`${API_PREFIX}/webhooks`, commerceWebhookRouter(ctx));
  app.use(`${API_PREFIX}/webhooks`, financeWebhookRouter(ctx));
  if (ctx.video instanceof MockVideoProvider && env.NODE_ENV !== 'production')
    app.use(`${API_PREFIX}/media/dev`, devMediaRouter(ctx, ctx.video));
  app.use(express.json({ limit: '100kb' }));

  app.use(API_PREFIX, v1Router(ctx, new AuthService(ctx)));

  app.use(notFoundHandler);
  app.use(errorHandler(env));

  return app;
}
