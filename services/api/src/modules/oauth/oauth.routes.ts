import { Router } from 'express';
import {
  oauthCallbackQuerySchema,
  oauthExchangeSchema,
  oauthStartQuerySchema,
} from '@farmplus/validation';
import type { AppContext } from '../../context';
import { parse, requestMeta } from '../../lib/http';
import { rateLimits } from '../../middleware/rate-limit';
import type { AuthService } from '../../services/auth.service';
import { OAuthService } from './oauth.service';
import { createOAuthProviders, type OAuthProvider } from './providers';

/**
 * `/api/v1/auth/oauth` — social sign-in (Google / Facebook).
 *   GET  /providers                 which buttons to show
 *   GET  /:provider/start           browser → provider (returnTo must be in OAUTH_RETURN_URLS)
 *   GET  /:provider/callback        provider → browser → returnTo?ticket=… (or ?error=…)
 *   POST /exchange {ticket,verifier} → the same response as POST /auth/login
 */
export function oauthRouter(
  ctx: AppContext,
  auth: AuthService,
  providers: ReturnType<typeof createOAuthProviders> = createOAuthProviders(ctx.env),
): Router {
  const router = Router();
  const limits = rateLimits(ctx.env);
  const service = new OAuthService(ctx, auth, providers);
  router.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  router.get('/providers', (_req, res) => {
    res.json({ providers: service.enabled() });
  });
  router.get('/:provider/start', limits.login, async (req, res) => {
    const target = await service.start(
      String(req.params['provider']),
      parse(oauthStartQuerySchema, req.query),
    );
    res.redirect(302, target);
  });
  router.get('/:provider/callback', limits.login, async (req, res) => {
    const target = await service.callback(
      String(req.params['provider']),
      parse(oauthCallbackQuerySchema, req.query),
      requestMeta(req),
    );
    res.redirect(302, target);
  });
  router.post('/exchange', limits.login, async (req, res) => {
    res.json(await service.exchange(parse(oauthExchangeSchema, req.body), requestMeta(req)));
  });
  return router;
}

export type { OAuthProvider };
