import { Router } from 'express';
import { requirePermission } from '../../middleware/authorize';
import { rolesController as c } from './roles.controller';

/** Mounted under `/admin/roles`. Changing permissions inside also needs `permissions.manage` (service-enforced). */
export function rolesRoutes(): Router {
  const router = Router();
  router.get('/', requirePermission('roles.read'), c.list);
  router.get('/:id', requirePermission('roles.read'), c.get);
  router.post('/', requirePermission('roles.manage'), c.create);
  router.patch('/:id', requirePermission('roles.manage'), c.update);
  return router;
}
