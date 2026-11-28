import { Router } from 'express';
import {
  assistantAskSchema,
  assistantSuggestionsQuerySchema,
  assistantTipKeySchema,
  assistantTipStateSchema,
} from '@farmplus/validation';
import type { Actor, AppContext } from '../../context';
import { parse, requireActor } from '../../lib/http';
import { authenticate, authenticateToken } from '../../middleware/authenticate';
import { rateLimits } from '../../middleware/rate-limit';
import { ask } from './assistant.service';
import { saveTipState, suggestions } from './tips.service';

/**
 * `/api/v1/assistant` — PUBLIC with optional sign-in (see test/qa/authz-allowlists.ts). Guests get help-article search
 * only (no AI call, no data). A valid access token unlocks AI answers within the platform's limits; an invalid one is
 * refused as everywhere else, so a stale session is noticed. The answer never contains anyone's data.
 */
export function assistantRouter(ctx: AppContext): Router {
  const router = Router();
  const limits = rateLimits(ctx.env);
  router.post('/ask', limits.assistant, async (req, res) => {
    const input = parse(assistantAskSchema, req.body);
    const token = /^Bearer\s+(\S+)$/i.exec(req.get('authorization') ?? '')?.[1];
    let actor: Actor | null = null;
    if (token) {
      const { exp, ...a } = await authenticateToken(ctx, token, req.ip);
      void exp;
      actor = a;
    }
    res.json(await ask(actor, input, ctx.ai));
  });
  /** Contextual tips: signed in only; a `farmId` the caller cannot see is 404 (farm-access check first). */
  router.get('/suggestions', authenticate(ctx), async (req, res) => {
    const query = parse(assistantSuggestionsQuerySchema, req.query);
    res.json({ tips: await suggestions(requireActor(req), query) });
  });
  return router;
}

/** `/api/v1/me/assistant-tips` — the caller's own "hide" / "remind me in 7 days" choices (no one else's). */
export function meAssistantTipsRouter(ctx: AppContext): Router {
  const router = Router();
  router.use(authenticate(ctx));
  router.put('/:key', async (req, res) => {
    const key = parse(assistantTipKeySchema, req.params['key']);
    const { action } = parse(assistantTipStateSchema, req.body);
    res.json({ tip: await saveTipState(requireActor(req).userId, key, action) });
  });
  return router;
}
