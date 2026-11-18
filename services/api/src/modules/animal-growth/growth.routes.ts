import { Router } from 'express';
import { createWeightSchema, weightListQuerySchema } from '@farmplus/validation';
import type { AppContext } from '../../context';
import { parse } from '../../lib/http';
import { mountCommonRecordRoutes, recordContext } from '../records/record-routes';
import { createWeight, listWeights, weightSpec } from './growth.service';

/** `/api/v1/farms/:farmId/weights` */
export function weightsRouter(ctx: AppContext): Router {
  const router = Router({ mergeParams: true });
  router.post('/', async (req, res) => {
    res.status(201).json({
      record: await createWeight(
        await recordContext(req, ctx),
        parse(createWeightSchema, req.body),
      ),
    });
  });
  router.get('/', async (req, res) => {
    const { access } = await recordContext(req, ctx);
    res.json(await listWeights(access, parse(weightListQuerySchema, req.query)));
  });
  mountCommonRecordRoutes(router, ctx, weightSpec);
  return router;
}
