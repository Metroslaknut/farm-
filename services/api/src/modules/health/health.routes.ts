import { Router } from 'express';
import { createHealthSchema, healthListQuerySchema } from '@farmplus/validation';
import type { AppContext } from '../../context';
import { parse } from '../../lib/http';
import { mountCommonRecordRoutes, recordContext } from '../records/record-routes';
import { createHealth, healthSpec, listHealth } from './health.service';

/** `/api/v1/farms/:farmId/health` (auth is applied by the farms router). */
export function healthRouter(ctx: AppContext): Router {
  const router = Router({ mergeParams: true });
  router.post('/', async (req, res) => {
    res.status(201).json({
      record: await createHealth(
        await recordContext(req, ctx),
        parse(createHealthSchema, req.body),
      ),
    });
  });
  router.get('/', async (req, res) => {
    const { access } = await recordContext(req, ctx);
    res.json(await listHealth(access, parse(healthListQuerySchema, req.query)));
  });
  mountCommonRecordRoutes(router, ctx, healthSpec);
  return router;
}
