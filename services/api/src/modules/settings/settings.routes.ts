import { Router } from 'express';
import { requirePermission } from '../../middleware/authorize';
import { settingsController as c } from './settings.controller';

/** Mounted under `/admin/settings` (already authenticated). */
export function settingsRoutes(): Router {
  const router = Router();
  router.get('/', requirePermission('settings.read'), c.list);
  router.patch('/', requirePermission('settings.manage'), c.update);
  return router;
}
