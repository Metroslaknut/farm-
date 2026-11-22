import { Router, type RequestHandler } from 'express';
import { createJoinRequestSchema, farmInvitationListQuerySchema } from '@farmplus/validation';
import type { AppContext } from '../../context';
import { parse, requireActor } from '../../lib/http';
import { parseObjectId } from '../../lib/object-id';
import { authenticate } from '../../middleware/authenticate';
import { rateLimits } from '../../middleware/rate-limit';
import * as invitations from './invitations.service';

/**
 * The signed-in person's side of farm invitations: invitations they received and join requests they sent.
 * Every lookup is scoped to the caller (someone else's invitation id is 404).
 */
export function myFarmInvitationsRouter(ctx: AppContext): Router {
  const router = Router();
  const limit = rateLimits(ctx.env);
  router.use(authenticate(ctx));
  const answer =
    (fn: typeof invitations.acceptInvitation): RequestHandler =>
    async (req, res) => {
      const actor = requireActor(req);
      res.json({ invitation: await fn(actor, parseObjectId(req.params['invitationId'])) });
    };

  router.get('/', async (req, res) => {
    const actor = requireActor(req);
    const { status } = parse(farmInvitationListQuerySchema, req.query);
    res.json({ invitations: await invitations.listMine(actor, status) });
  });
  router.post('/requests', limit.members, async (req, res) => {
    const actor = requireActor(req);
    res.status(201).json({
      invitation: await invitations.requestToJoin(actor, parse(createJoinRequestSchema, req.body)),
    });
  });
  router.post('/:invitationId/accept', answer(invitations.acceptInvitation));
  router.post('/:invitationId/decline', answer(invitations.declineInvitation));
  router.post('/:invitationId/cancel', answer(invitations.cancelMyRequest));
  return router;
}
