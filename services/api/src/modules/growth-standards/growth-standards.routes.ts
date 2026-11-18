import { Router } from 'express';
import {
  createGrowthStandardSchema,
  growthStandardListQuerySchema,
  updateGrowthStandardSchema,
} from '@farmplus/validation';
import type { AppContext } from '../../context';
import { parse, requireActor } from '../../lib/http';
import { parseObjectId } from '../../lib/object-id';
import { authenticate } from '../../middleware/authenticate';
import { requirePermission } from '../../middleware/authorize';
import * as standards from './growth-standards.service';

/**
 * `/api/v1/growth-standards` — admin management of growth criteria (species configuration, like animal types).
 * Farm users never call this: the criteria that apply to an animal come with its growth endpoint.
 */
export function growthStandardsRouter(ctx: AppContext): Router {
  const router = Router();
  router.use(authenticate(ctx), requirePermission('animal_types.manage'));
  router.get('/', async (req, res) => {
    res.json({
      standards: await standards.listGrowthStandards(
        parse(growthStandardListQuerySchema, req.query),
      ),
    });
  });
  router.post('/', async (req, res) => {
    res.status(201).json({
      standard: await standards.createGrowthStandard(
        requireActor(req),
        parse(createGrowthStandardSchema, req.body),
      ),
    });
  });
  router.patch('/:id', async (req, res) => {
    res.json({
      standard: await standards.updateGrowthStandard(
        requireActor(req),
        parseObjectId(req.params['id']),
        parse(updateGrowthStandardSchema, req.body),
      ),
    });
  });
  return router;
}
