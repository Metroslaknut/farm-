import { Router } from 'express';
import type { AppContext } from '../../context';
import { authenticate } from '../../middleware/authenticate';
import { rateLimits } from '../../middleware/rate-limit';
import { weightsRouter } from '../animal-growth/growth.routes';
import { farmAnimalsRouter } from '../animals/animals.routes';
import { breedingRouter } from '../breeding/breeding.routes';
import { expensesRouter } from '../farm-expenses/expenses.routes';
import { feedingRouter } from '../feeding/feeding.routes';
import { healthRouter } from '../health/health.routes';
import { farmListingsRouter, farmNegotiationsRouter } from '../marketplace/marketplace.routes';
import { farmDashboardRouter } from '../analytics/analytics.routes';
import { farmAssessmentsRouter } from '../ai/ai.routes';
import { farmProductsRouter } from '../products/products.routes';
import { farmOrdersRouter } from '../orders/orders.routes';
import { farmsController as c } from './farms.controller';

/**
 * `/api/v1/farms`. Authentication is applied here; authorisation is per farm and per action
 * (see farm-access.ts): every handler resolves the caller's access to :farmId first.
 */
export function farmsRouter(ctx: AppContext): Router {
  const router = Router();
  const limit = rateLimits(ctx.env);
  router.use(authenticate(ctx));

  router.post('/', c.create);
  router.get('/', c.list);
  router.get('/me', c.me); // before /:farmId
  router.get('/:farmId', c.get);
  router.get('/:farmId/summary', c.summary);
  router.patch('/:farmId', c.update);
  router.post('/:farmId/archive', c.archive);
  router.post('/:farmId/restore', c.restore);

  router.get('/:farmId/members', c.listMembers);
  router.post('/:farmId/members', limit.members, c.addMember);
  router.patch('/:farmId/members/:memberId', c.updateMember);
  router.delete('/:farmId/members/:memberId', c.removeMember);

  router.use('/:farmId/animals', farmAnimalsRouter(ctx));
  router.use('/:farmId/breeding', breedingRouter(ctx));
  router.use('/:farmId/health', healthRouter(ctx));
  router.use('/:farmId/feeding', feedingRouter(ctx));
  router.use('/:farmId/weights', weightsRouter(ctx));
  router.use('/:farmId/expenses', expensesRouter(ctx));
  router.use('/:farmId/listings', farmListingsRouter(ctx));
  router.use('/:farmId/negotiations', farmNegotiationsRouter());
  router.use('/:farmId/orders', farmOrdersRouter(ctx));
  router.use('/:farmId/products', farmProductsRouter(ctx));
  router.use('/:farmId/assessments', farmAssessmentsRouter(ctx));
  router.use('/:farmId/dashboard', farmDashboardRouter(ctx));
  return router;
}
