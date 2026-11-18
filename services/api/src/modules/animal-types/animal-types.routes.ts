import { Router } from 'express';
import type { AppContext } from '../../context';
import { authenticate } from '../../middleware/authenticate';
import { requirePermission } from '../../middleware/authorize';
import { animalTypesController as c } from './animal-types.controller';

/** `/api/v1/animal-types` — read for any signed-in user, changes need `animal_types.manage`. */
export function animalTypesRouter(ctx: AppContext): Router {
  const router = Router();
  router.use(authenticate(ctx));
  router.get('/', c.list);
  router.post('/', requirePermission('animal_types.manage'), c.create);
  router.patch('/:id', requirePermission('animal_types.manage'), c.update);
  router.post('/:id/breeds', requirePermission('animal_types.manage'), c.addBreed);
  router.patch('/:id/breeds/:breedKey', requirePermission('animal_types.manage'), c.updateBreed);
  return router;
}
