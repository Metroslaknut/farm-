import { Router } from 'express';
import type { AppContext } from '../../context';
import { authenticate } from '../../middleware/authenticate';
import { requirePermission } from '../../middleware/authorize';
import { auditLogsRoutes } from '../audit-logs/audit-logs.routes';
import { permissionsRoutes } from '../permissions/permissions.routes';
import { adminRegistrationsRoutes } from '../registrations/registrations.routes';
import { rolesRoutes } from '../roles/roles.routes';
import { settingsRoutes } from '../settings/settings.routes';
import { adminController as c } from './admin.controller';

/**
 * Everything under `/api/v1/admin`. Authentication is applied once here; EVERY route below also declares
 * its own specific permission (no endpoint relies on "being an admin"). Admin permissions only become
 * effective in an MFA-verified session (see rbac/access.ts).
 *
 * Payments, refunds, withdrawals, wallet, commissions, farms, listings, orders and products are NOT
 * routed here yet: those business modules do not exist, and money movement must not be re-implemented
 * as ad-hoc admin database updates. They plug in here when their modules land.
 */
export function adminModuleRouter(ctx: AppContext): Router {
  const router = Router();
  router.use(authenticate(ctx));

  router.get('/dashboard', requirePermission('reports.read'), c.dashboard);

  router.get('/users', requirePermission('users.read'), c.listUsers);
  router.get('/users/:id', requirePermission('users.read'), c.getUser);
  router.patch('/users/:id/status', requirePermission('users.suspend'), c.setUserStatus);

  router.use('/registrations', adminRegistrationsRoutes());
  router.use('/roles', rolesRoutes());
  router.use('/permissions', permissionsRoutes());
  router.use('/audit-logs', auditLogsRoutes());
  router.use('/settings', settingsRoutes());
  return router;
}
