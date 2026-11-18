import { Router } from 'express';
import type { AppContext } from '../../context';
import { authenticate } from '../../middleware/authenticate';
import { requirePermission } from '../../middleware/authorize';
import { parse, requireActor } from '../../lib/http';
import { submitRegistrationSchema } from '@farmplus/validation';
import { assertMediaUrlAllowed, type MediaPolicy } from '../animals/animals.service';
import { registrationsController as c } from './registrations.controller';
import * as registrations from './registrations.service';

/** Applicant-facing: `/api/v1/registrations` (any authenticated user, own records only). */
export function registrationsRouter(ctx: AppContext): Router {
  const router = Router();
  router.use(authenticate(ctx));
  // Reviewers open these document links, so they get the same host allow-list as every other user-supplied media URL:
  // an applicant cannot make an administrator's browser visit an arbitrary site.
  const policy: MediaPolicy = {
    allowedHosts: ctx.env.MEDIA_ALLOWED_HOSTS,
    production: ctx.env.NODE_ENV === 'production',
  };
  router.post('/', async (req, res) => {
    const body = parse(submitRegistrationSchema, req.body);
    for (const d of body.documents) assertMediaUrlAllowed(d.url, policy);
    res
      .status(201)
      .json({ registration: await registrations.submitRegistration(requireActor(req), body) });
  });
  router.get('/mine', c.mine);
  return router;
}

/** Reviewer-facing: mounted under `/admin/registrations` (already authenticated). */
export function adminRegistrationsRoutes(): Router {
  const router = Router();
  router.get('/', requirePermission('registrations.review'), c.list);
  router.get('/:id', requirePermission('registrations.review'), c.get);
  router.post('/:id/review', requirePermission('registrations.review'), c.review);
  router.post('/:id/approve', requirePermission('registrations.approve'), c.approve);
  router.post('/:id/reject', requirePermission('registrations.approve'), c.reject);
  router.post('/:id/suspend', requirePermission('registrations.approve'), c.suspend);
  router.post('/:id/reinstate', requirePermission('registrations.approve'), c.reinstate);
  return router;
}
