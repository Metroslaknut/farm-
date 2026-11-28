import { Router } from 'express';
import type { AppContext } from '../../context';
import { authenticate } from '../../middleware/authenticate';
import { requireAnyPermission, requirePermission } from '../../middleware/authorize';
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
 * Payments, refunds, withdrawals, wallet, commissions, listings, orders and products are NOT
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

  // Read-only in phase 1 (docs/architecture/admin-farms-orders-reports.md §2). `:id`, not `:farmId`: these are
  // platform routes guarded by permission, not farm routes decided by membership.
  router.get('/farms', requireAnyPermission('farms.read', 'farms.manage'), c.listFarms);
  router.get('/farms/:id', requireAnyPermission('farms.read', 'farms.manage'), c.getFarm);

  router.use('/registrations', adminRegistrationsRoutes());
  router.use('/roles', rolesRoutes());
  router.use('/permissions', permissionsRoutes());
  router.use('/audit-logs', auditLogsRoutes());
  router.use('/settings', settingsRoutes());
  return router;
}
