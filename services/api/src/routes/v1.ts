import { Router } from 'express';
import type { AppContext } from '../context';
import type { AuthService } from '../services/auth.service';
import { adminModuleRouter } from '../modules/admin/admin.routes';
import { animalTypesRouter } from '../modules/animal-types/animal-types.routes';
import { growthStandardsRouter } from '../modules/growth-standards/growth-standards.routes';
import { animalPhotosRouter, animalsRouter } from '../modules/animals/animals.routes';
import { commentsRouter, postsRouter } from '../modules/community/community.routes';
import { moderationRouter } from '../modules/community/moderation.routes';
import { liveRouter, videosRouter } from '../modules/media/media.routes';
import { marketplaceRouter } from '../modules/marketplace/marketplace.routes';
import {
  adminFinanceRouter,
  paymentsRouter,
  walletRouter,
} from '../modules/finance/finance.routes';
import {
  adminAnalyticsRouter,
  analyticsDefinitionsRouter,
} from '../modules/analytics/analytics.routes';
import {
  adminChatRouter,
  conversationsRouter,
  notificationsRouter,
} from '../modules/chat/chat.routes';
import { adminAiRouter } from '../modules/ai/ai.routes';
import { shopRouter } from '../modules/products/products.routes';
import { ordersRouter, shippingRouter } from '../modules/orders/orders.routes';
import { farmsRouter } from '../modules/farms/farms.routes';
import { helpRouter } from '../modules/help/help.routes';
import { assistantRouter, meAssistantTipsRouter } from '../modules/assistant/assistant.routes';
import { meToursRouter } from '../modules/tours/tours.routes';
import { myFarmInvitationsRouter } from '../modules/farms/invitations.routes';
import { registrationsRouter } from '../modules/registrations/registrations.routes';
import { adminRouter } from './admin';
import { authRouter } from './auth';
import { oauthRouter } from '../modules/oauth/oauth.routes';
import { healthRouter, readinessRouter } from './health';
import { usersRouter } from './users';

/** Root router for `/api/v1`. Feature routers get mounted here in later Parts. */
export function v1Router(ctx: AppContext, auth: AuthService): Router {
  const router = Router();
  router.use('/health', healthRouter(ctx.env));
  router.use('/ready', readinessRouter());
  router.use('/auth/oauth', oauthRouter(ctx, auth)); // before /auth: its routes are public
  router.use('/auth', authRouter(ctx, auth));
  router.use('/help', helpRouter(ctx)); // public: the help centre needs no account
  router.use('/assistant', assistantRouter(ctx)); // public search; AI answers only when signed in
  router.use('/me/tours', meToursRouter(ctx)); // the caller's own guided-tour progress
  router.use('/me/assistant-tips', meAssistantTipsRouter(ctx)); // the caller's own tip choices
  router.use('/users', usersRouter(ctx));
  router.use('/registrations', registrationsRouter(ctx));
  router.use('/farms', farmsRouter(ctx));
  router.use('/farm-invitations', myFarmInvitationsRouter(ctx));
  router.use('/animals', animalsRouter(ctx));
  router.use('/animal-photos', animalPhotosRouter(ctx));
  router.use('/animal-types', animalTypesRouter(ctx));
  router.use('/growth-standards', growthStandardsRouter(ctx));
  router.use('/posts', postsRouter(ctx));
  router.use('/comments', commentsRouter(ctx));
  router.use('/moderation', moderationRouter(ctx));
  router.use('/marketplace', marketplaceRouter(ctx));
  router.use('/shop', shopRouter(ctx));
  router.use('/orders', ordersRouter(ctx));
  router.use('/shipping', shippingRouter(ctx));
  router.use('/videos', videosRouter(ctx));
  router.use('/live', liveRouter(ctx));
  router.use('/payments', paymentsRouter(ctx));
  router.use('/wallet', walletRouter(ctx));
  router.use('/admin/finance', adminFinanceRouter(ctx));
  router.use('/notifications', notificationsRouter(ctx));
  router.use('/conversations', conversationsRouter(ctx));
  router.use('/admin/chat', adminChatRouter(ctx));
  router.use('/admin/ai', adminAiRouter(ctx));
  router.use('/admin/analytics', adminAnalyticsRouter(ctx));
  router.use('/analytics', analyticsDefinitionsRouter(ctx));
  router.use('/admin', adminModuleRouter(ctx));
  router.use(adminRouter(ctx));
  return router;
}
