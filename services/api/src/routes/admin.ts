import { Router } from 'express';
import type { AppContext } from '../context';
import { adminController as c } from '../controllers/admin.controller';
import { authenticate } from '../middleware/authenticate';
import { requirePermission } from '../middleware/authorize';

/** Roles, permissions and audit logs. Mounted at the /api/v1 root. */
export function adminRouter(ctx: AppContext): Router {
  const router = Router();
  // Authenticate per route (not router.use): this router sits at the /api/v1 root, and a blanket
  // guard would turn unknown paths into 401 instead of 404.
  const requireAuth = authenticate(ctx);
  router.get('/roles', requireAuth, requirePermission('roles.read'), c.roles);
  router.get('/permissions', requireAuth, requirePermission('roles.read'), c.permissions);
  router.put(
    '/roles/:key/permissions',
    requireAuth,
    requirePermission('permissions.manage'),
    c.setRolePermissions,
  );
  router.get('/audit-logs', requireAuth, requirePermission('audit_logs.read'), c.auditLogs);
  return router;
}
