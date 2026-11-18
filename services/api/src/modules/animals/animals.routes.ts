import express, { Router } from 'express';
import { animalAssessmentsRouter } from '../ai/ai.routes';
import type { AppContext } from '../../context';
import { authenticate } from '../../middleware/authenticate';
import { rateLimits } from '../../middleware/rate-limit';
import { historyQuerySchema, lineageQuerySchema } from '@farmplus/validation';
import { parse } from '../../lib/http';
import { parseObjectId } from '../../lib/object-id';
import { lineageFor } from '../breeding/breeding.service';
import { growthFor } from '../animal-growth/growth.service';
import { farmContext } from '../farms/farms.controller';
import { animalHistory } from '../records/history.service';
import { animalsController } from './animals.controller';
import { PHOTO_MAX_BYTES, readPhoto } from './animals.service';

/** Nested under `/farms/:farmId/animals` (needs `mergeParams` to read :farmId). Auth is applied by the parent. */
export function farmAnimalsRouter(ctx: AppContext): Router {
  const router = Router({ mergeParams: true });
  const c = animalsController(ctx);
  router.post('/', c.create);
  router.get('/', c.list);
  // Per-animal views over the husbandry records (Part 08).
  router.use('/:animalId/assessments', animalAssessmentsRouter(ctx));
  router.get('/:animalId/history', async (req, res) => {
    const { access } = await farmContext(req);
    res.json(
      await animalHistory(
        access,
        parseObjectId(req.params['animalId']),
        parse(historyQuerySchema, req.query),
      ),
    );
  });
  router.get('/:animalId/growth', async (req, res) => {
    const { access } = await farmContext(req);
    res.json(await growthFor(access, parseObjectId(req.params['animalId'])));
  });
  router.get('/:animalId/lineage', async (req, res) => {
    const { access } = await farmContext(req);
    const { generations } = parse(lineageQuerySchema, req.query);
    res.json(await lineageFor(access, parseObjectId(req.params['animalId']), generations));
  });
  router.get('/:animalId', c.get);
  router.patch('/:animalId', c.update);
  router.post('/:animalId/archive', c.archive);
  router.post('/:animalId/restore', c.restore);
  router.post('/:animalId/media', c.addMedia);
  // A photo from the user's device: the body is the image itself (any Content-Type; the bytes are sniffed).
  router.post(
    '/:animalId/photos',
    rateLimits(ctx.env).upload,
    express.raw({ type: () => true, limit: PHOTO_MAX_BYTES }),
    c.uploadPhoto,
  );
  router.delete('/:animalId/media/:mediaId', c.removeMedia);
  return router;
}

/** `/api/v1/animals/:animalId` — read an animal knowing only its id (used by deep links). */
export function animalsRouter(ctx: AppContext): Router {
  const router = Router();
  router.use(authenticate(ctx));
  router.get('/:animalId', animalsController(ctx).getById);
  return router;
}

/**
 * `/api/v1/animal-photos/:key` — serves a photo uploaded from a device. Public like a CDN link: an <img> tag cannot
 * send a token, so the 192-bit random key in the URL is the capability (it is only ever shown to farm members).
 */
export function animalPhotosRouter(): Router {
  const router = Router();
  router.get('/:key', async (req, res) => {
    const photo = await readPhoto(String(req.params['key']));
    if (!photo) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not found' } });
      return;
    }
    res.setHeader('content-type', photo.mimeType);
    res.setHeader('content-length', photo.data.length);
    // Helmet defaults to same-origin; the web app may load it from another origin.
    res.setHeader('cross-origin-resource-policy', 'cross-origin');
    res.setHeader('cache-control', 'private, max-age=86400, immutable');
    res.end(photo.data);
  });
  return router;
}
