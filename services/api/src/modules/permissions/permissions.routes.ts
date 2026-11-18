import { Router, type RequestHandler } from 'express';
import { requirePermission } from '../../middleware/authorize';
import { permissionMatrix } from '../../services/role.service';

const list = (async (_req, res) => {
  res.json({ permissions: await permissionMatrix() });
}) satisfies RequestHandler;

/** Mounted under `/admin/permissions`. Read-only: the catalogue is defined in code; roles map to it. */
export function permissionsRoutes(): Router {
  const router = Router();
  router.get('/', requirePermission('roles.read'), list);
  return router;
}
