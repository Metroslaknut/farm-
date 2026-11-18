import { Router } from 'express';
import type { AppContext } from '../context';
import { userController as c } from '../controllers/user.controller';
import { parseObjectId } from '../lib/object-id';
import { authenticate } from '../middleware/authenticate';
import { requireOwnerOrPermission, requirePermission } from '../middleware/authorize';
import { mountUserCommunityRoutes } from '../modules/community/community.routes';

/** For user resources the "owner" is the user themself. */
const ownerOrPermission = (permission: 'users.read' | 'users.update' | 'roles.read') =>
  requireOwnerOrPermission({
    load: async (req) => ({ ownerId: String(parseObjectId(req.params['id'])) }),
    bypassPermission: permission,
  });

export function usersRouter(ctx: AppContext): Router {
  const router = Router();
  router.use(authenticate(ctx));

  router.get('/', requirePermission('users.read'), c.list);
  router.get('/me', c.me);
  router.patch('/me', c.updateMe);

  mountUserCommunityRoutes(router, ctx);
  router.get('/:id', ownerOrPermission('users.read'), c.get);
  router.patch('/:id', ownerOrPermission('users.update'), c.update);
  router.put('/:id/status', requirePermission('users.suspend'), c.setStatus);

  router.get('/:id/roles', ownerOrPermission('roles.read'), c.roles);
  router.post('/:id/roles', requirePermission('roles.manage'), c.assignRole);
  router.delete('/:id/roles/:roleKey', requirePermission('roles.manage'), c.revokeRole);
  return router;
}
