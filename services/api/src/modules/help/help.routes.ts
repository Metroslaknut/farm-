import { Router } from 'express';
import { helpFeedbackSchema } from '@farmplus/validation';
import type { AppContext } from '../../context';
import { parse } from '../../lib/http';
import { rateLimits } from '../../middleware/rate-limit';
import { recordHelpFeedback } from './help.service';

/**
 * `/api/v1/help` — PUBLIC (no sign-in): the help centre is read before people have an account. The only route stores
 * an anonymous vote and returns nothing; it is rate limited per client (see test/qa/authz-allowlists.ts).
 */
export function helpRouter(ctx: AppContext): Router {
  const router = Router();
  const limits = rateLimits(ctx.env);
  router.post('/feedback', limits.helpFeedback, async (req, res) => {
    await recordHelpFeedback(parse(helpFeedbackSchema, req.body));
    res.status(204).end();
  });
  return router;
}
