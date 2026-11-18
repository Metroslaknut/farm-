import { Router } from 'express';
import {
  breedingListQuerySchema,
  confirmPregnancySchema,
  createBreedingSchema,
  failBreedingSchema,
  recordDeliverySchema,
} from '@farmplus/validation';
import type { AppContext } from '../../context';
import { parse } from '../../lib/http';
import { parseObjectId } from '../../lib/object-id';
import { mountCommonRecordRoutes, recordContext } from '../records/record-routes';
import {
  addOffspring,
  breedingSpec,
  confirmPregnancy,
  createBreeding,
  failBreeding,
  listBreeding,
  recordDelivery,
} from './breeding.service';

const addOffspringSchema = recordDeliverySchema.pick({ offspring: true }).required();

/** `/api/v1/farms/:farmId/breeding` */
export function breedingRouter(ctx: AppContext): Router {
  const router = Router({ mergeParams: true });
  router.post('/', async (req, res) => {
    res.status(201).json({
      record: await createBreeding(
        await recordContext(req, ctx),
        parse(createBreedingSchema, req.body),
      ),
    });
  });
  router.get('/', async (req, res) => {
    const { access } = await recordContext(req, ctx);
    res.json(await listBreeding(access, parse(breedingListQuerySchema, req.query)));
  });
  const id = (req: { params: Record<string, unknown> }) => parseObjectId(req.params['id']);
  router.post('/:id/pregnancy', async (req, res) => {
    res.json({
      record: await confirmPregnancy(
        await recordContext(req, ctx),
        id(req),
        parse(confirmPregnancySchema, req.body),
      ),
    });
  });
  router.post('/:id/failure', async (req, res) => {
    res.json({
      record: await failBreeding(
        await recordContext(req, ctx),
        id(req),
        parse(failBreedingSchema, req.body),
      ),
    });
  });
  router.post('/:id/delivery', async (req, res) => {
    res.status(201).json({
      record: await recordDelivery(
        await recordContext(req, ctx),
        id(req),
        parse(recordDeliverySchema, req.body),
      ),
    });
  });
  router.post('/:id/offspring', async (req, res) => {
    res.status(201).json({
      record: await addOffspring(
        await recordContext(req, ctx),
        id(req),
        parse(addOffspringSchema, req.body),
      ),
    });
  });
  mountCommonRecordRoutes(router, ctx, breedingSpec);
  return router;
}
