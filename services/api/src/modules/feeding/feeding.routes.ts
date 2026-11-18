import { Router } from 'express';
import { createFeedingSchema, feedingListQuerySchema } from '@farmplus/validation';
import type { AppContext } from '../../context';
import { parse } from '../../lib/http';
import { mountCommonRecordRoutes, recordContext } from '../records/record-routes';
import { createFeeding, feedingSpec, listFeeding } from './feeding.service';

/** `/api/v1/farms/:farmId/feeding` */
export function feedingRouter(ctx: AppContext): Router {
  const router = Router({ mergeParams: true });
  router.post('/', async (req, res) => {
    res.status(201).json({
      record: await createFeeding(
        await recordContext(req, ctx),
        parse(createFeedingSchema, req.body),
      ),
    });
  });
  router.get('/', async (req, res) => {
    const { access } = await recordContext(req, ctx);
    res.json(await listFeeding(access, parse(feedingListQuerySchema, req.query)));
  });
  mountCommonRecordRoutes(router, ctx, feedingSpec);
  return router;
}
