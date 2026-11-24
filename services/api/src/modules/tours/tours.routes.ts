import { Router } from 'express';
import { tourIdSchema, tourProgressSchema } from '@farmplus/validation';
import type { AppContext } from '../../context';
import { parse, requireActor } from '../../lib/http';
import { authenticate } from '../../middleware/authenticate';
import { listMyTours, saveMyTour } from './tours.service';

/** `/api/v1/me/tours` — the signed-in user's own guided-tour progress (no one else's can be read or written). */
export function meToursRouter(ctx: AppContext): Router {
  const router = Router();
  router.use(authenticate(ctx));
  router.get('/', async (req, res) => {
    res.json({ tours: await listMyTours(requireActor(req).userId) });
  });
  router.put('/:tourId', async (req, res) => {
    const tourId = parse(tourIdSchema, req.params['tourId']);
    res.json({
      tour: await saveMyTour(requireActor(req).userId, tourId, parse(tourProgressSchema, req.body)),
    });
  });
  return router;
}
