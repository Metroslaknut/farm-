import { Router } from 'express';
import { assistantAskSchema } from '@farmplus/validation';
import type { Actor, AppContext } from '../../context';
import { parse } from '../../lib/http';
import { authenticateToken } from '../../middleware/authenticate';
import { rateLimits } from '../../middleware/rate-limit';
import { ask } from './assistant.service';

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
  return router;
}
