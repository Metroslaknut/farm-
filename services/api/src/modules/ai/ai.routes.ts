import { Router } from 'express';
import {
  assessmentListQuerySchema,
  createAssessmentSchema,
  createCriteriaSchema,
  createMarketPointSchema,
  deactivateSchema,
  marketListQuerySchema,
  reviewAssessmentSchema,
  usageQuerySchema,
} from '@farmplus/validation';
import type { AppContext } from '../../context';
import { notFound } from '../../lib/errors';
import { parse, requireActor } from '../../lib/http';
import { parseObjectId } from '../../lib/object-id';
import { authenticate } from '../../middleware/authenticate';
import { requirePermission } from '../../middleware/authorize';
import { rateLimits } from '../../middleware/rate-limit';
import { farmContext } from '../farms/farms.controller';
import {
  createCriteria,
  createMarketPoint,
  deactivateCriteria,
  deactivateMarketPoint,
  listCriteria,
  listMarketPoints,
  usageSummary,
} from './admin.service';
import {
  createAssessment,
  dismissRecommendation,
  getAssessment,
  listAssessments,
  reviewAssessment,
  type AiDeps,
} from './ai.service';

const deps = (ctx: AppContext): AiDeps => ({
  provider: ctx.ai,
  timeoutMs: ctx.env.AI_TIMEOUT_MS,
  maxOutputTokens: ctx.env.AI_MAX_OUTPUT_TOKENS,
});

/** Nested under `/farms/:farmId`: assessments of the farm's animals. Every lookup includes the farm id (IDOR-safe). */
export function farmAssessmentsRouter(ctx: AppContext): Router {
  const router = Router({ mergeParams: true });
  const limits = rateLimits(ctx.env);

  router.get('/', async (req, res) => {
    const { access } = await farmContext(req);
    res.json(await listAssessments(access, parse(assessmentListQuerySchema, req.query)));
  });
  router.get('/:id', async (req, res) => {
    const { access } = await farmContext(req);
    res.setHeader('cache-control', 'no-store');
    res.json({ assessment: await getAssessment(access, parseObjectId(req.params['id'])) });
  });
  router.post('/:id/review', limits.assessment, async (req, res) => {
    const { actor, access } = await farmContext(req);
    const { decision, note } = parse(reviewAssessmentSchema, req.body);
    res.json({
      assessment: await reviewAssessment(
        actor,
        access,
        parseObjectId(req.params['id']),
        decision,
        note,
      ),
    });
  });
  router.post('/:id/recommendations/:recId/dismiss', limits.assessment, async (req, res) => {
    const { actor, access } = await farmContext(req);
    res.json({
      assessment: await dismissRecommendation(
        actor,
        access,
        parseObjectId(req.params['id']),
        String(req.params['recId']),
      ),
    });
  });
  return router;
}

/** `POST /farms/:farmId/animals/:animalId/assessments` — mounted by the animals router. */
export function animalAssessmentsRouter(ctx: AppContext): Router {
  const router = Router({ mergeParams: true });
  const limits = rateLimits(ctx.env);
  router.post('/', limits.assessment, async (req, res) => {
    const { actor, access } = await farmContext(req);
    const { includeAiExplanation } = parse(createAssessmentSchema, req.body ?? {});
    res.status(201).json({
      assessment: await createAssessment(
        actor,
        access,
        parseObjectId((req.params as Record<string, unknown>)['animalId']),
        { includeAiExplanation },
        deps(ctx),
      ),
    });
  });
  router.get('/', async (req, res) => {
    const { access } = await farmContext(req);
    const q = parse(assessmentListQuerySchema.omit({ animalId: true }), req.query);
    res.json(
      await listAssessments(
        access,
        {
          ...q,
          animalId: parseObjectId((req.params as Record<string, unknown>)['animalId']).toString(),
        },
        true,
      ),
    );
  });
  return router;
}

/** `/api/v1/admin/ai` — criteria, imported market data and usage monitoring. Each route names its own permission. */
export function adminAiRouter(ctx: AppContext): Router {
  const router = Router();
  const limits = rateLimits(ctx.env);
  router.use(authenticate(ctx));
  router.use((_req, res, next) => {
    res.setHeader('cache-control', 'no-store');
    next();
  });

  router.get('/criteria', requirePermission('animal_types.manage'), async (_req, res) => {
    res.json({ criteria: await listCriteria({}) });
  });
  router.post(
    '/criteria',
    requirePermission('animal_types.manage'),
    limits.assessment,
    async (req, res) => {
      res.status(201).json({
        criteria: await createCriteria(requireActor(req), parse(createCriteriaSchema, req.body)),
      });
    },
  );
  router.post(
    '/criteria/:id/deactivate',
    requirePermission('animal_types.manage'),
    async (req, res) => {
      res.json({
        criteria: await deactivateCriteria(
          requireActor(req),
          parseObjectId(req.params['id']),
          parse(deactivateSchema, req.body).reason,
        ),
      });
    },
  );

  router.get('/market-data', requirePermission('animal_types.manage'), async (req, res) => {
    res.json(await listMarketPoints(parse(marketListQuerySchema, req.query)));
  });
  router.post(
    '/market-data',
    requirePermission('animal_types.manage'),
    limits.assessment,
    async (req, res) => {
      res.status(201).json({
        point: await createMarketPoint(requireActor(req), parse(createMarketPointSchema, req.body)),
      });
    },
  );
  router.post(
    '/market-data/:id/deactivate',
    requirePermission('animal_types.manage'),
    async (req, res) => {
      res.json({
        point: await deactivateMarketPoint(
          requireActor(req),
          parseObjectId(req.params['id']),
          parse(deactivateSchema, req.body).reason,
        ),
      });
    },
  );

  router.get('/usage', requirePermission('reports.read'), async (req, res) => {
    const { days } = parse(usageQuerySchema, req.query);
    res.json({ usage: await usageSummary(days, ctx.ai) });
  });
  router.all('/{*rest}', () => {
    throw notFound();
  });
  return router;
}
