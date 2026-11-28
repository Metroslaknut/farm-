import { Router } from 'express';
import type { AppContext } from '../../context';
import { authenticate } from '../../middleware/authenticate';
import { requirePermission } from '../../middleware/authorize';
import { rateLimits } from '../../middleware/rate-limit';
import { auditLogsRoutes } from '../audit-logs/audit-logs.routes';
import { permissionsRoutes } from '../permissions/permissions.routes';
import { adminRegistrationsRoutes } from '../registrations/registrations.routes';
import { rolesRoutes } from '../roles/roles.routes';
import { settingsRoutes } from '../settings/settings.routes';
import { adminController as c, adminOrdersController } from './admin.controller';

/**
 * Everything under `/api/v1/admin`. Authentication is applied once here; EVERY route below also declares
 * its own specific permission (no endpoint relies on "being an admin"). Admin permissions only become
 * effective in an MFA-verified session (see rbac/access.ts).
 *
 * Finance staff work under `/admin/finance` (finance module). Orders are read-only here (`payments.read`, the
 * permission finance staff already hold to work refunds); order state and money never change through this router.
 */
export function adminModuleRouter(ctx: AppContext): Router {
  const router = Router();
  router.use(authenticate(ctx));

  router.get('/dashboard', requirePermission('reports.read'), c.dashboard);

  router.get('/users', requirePermission('users.read'), c.listUsers);
  router.get('/users/:id', requirePermission('users.read'), c.getUser);
  router.patch('/users/:id/status', requirePermission('users.suspend'), c.setUserStatus);

  const orders = adminOrdersController(ctx);
  router.get('/orders', requirePermission('payments.read'), orders.list);
  router.get('/orders/:id', requirePermission('payments.read'), orders.get);
  router.post(
    '/orders/:id/contact',
    requirePermission('payments.read'),
    rateLimits(ctx.env).orderContact,
    orders.contact,
  );

  router.use('/registrations', adminRegistrationsRoutes());
  router.use('/roles', rolesRoutes());
  router.use('/permissions', permissionsRoutes());
  router.use('/audit-logs', auditLogsRoutes());
  router.use('/settings', settingsRoutes());
  return router;
}
