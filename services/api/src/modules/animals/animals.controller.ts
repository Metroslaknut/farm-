import type { RequestHandler } from 'express';
import {
  addMediaSchema,
  animalListQuerySchema,
  archiveSchema,
  createAnimalSchema,
  updateAnimalSchema,
} from '@farmplus/validation';
import type { AppContext } from '../../context';
import { parse, requireActor } from '../../lib/http';
import { parseObjectId } from '../../lib/object-id';
import { farmContext } from '../farms/farms.controller';
import * as animals from './animals.service';

export function animalsController(ctx: AppContext) {
  const policy: animals.MediaPolicy = {
    allowedHosts: ctx.env.MEDIA_ALLOWED_HOSTS,
    production: ctx.env.NODE_ENV === 'production',
  };
  const animalId = (req: Parameters<RequestHandler>[0]) => parseObjectId(req.params['animalId']);

  return {
    create: (async (req, res) => {
      const { actor, access } = await farmContext(req);
      res.status(201).json({
        animal: await animals.createAnimal(actor, access, parse(createAnimalSchema, req.body)),
      });
    }) satisfies RequestHandler,

    list: (async (req, res) => {
      const { access } = await farmContext(req);
      res.json(await animals.listAnimals(access, parse(animalListQuerySchema, req.query)));
    }) satisfies RequestHandler,

    get: (async (req, res) => {
      const { access } = await farmContext(req);
      res.json({ animal: await animals.getAnimal(access, animalId(req)) });
    }) satisfies RequestHandler,

    update: (async (req, res) => {
      const { actor, access } = await farmContext(req);
      res.json({
        animal: await animals.updateAnimal(
          actor,
          access,
          animalId(req),
          parse(updateAnimalSchema, req.body),
        ),
      });
    }) satisfies RequestHandler,

    archive: (async (req, res) => {
      const { actor, access } = await farmContext(req);
      const { reason } = parse(archiveSchema, req.body ?? {});
      res.json({
        animal: await animals.setAnimalArchived(actor, access, animalId(req), true, reason),
      });
    }) satisfies RequestHandler,

    restore: (async (req, res) => {
      const { actor, access } = await farmContext(req);
      res.json({ animal: await animals.setAnimalArchived(actor, access, animalId(req), false) });
    }) satisfies RequestHandler,

    addMedia: (async (req, res) => {
      const { actor, access } = await farmContext(req);
      res.status(201).json({
        animal: await animals.addMedia(
          actor,
          access,
          animalId(req),
          parse(addMediaSchema, req.body),
          policy,
        ),
      });
    }) satisfies RequestHandler,

    /** Raw image bytes in the body (see the route for the parser and size limit). */
    uploadPhoto: (async (req, res) => {
      const { actor, access } = await farmContext(req);
      const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      res.status(201).json({
        animal: await animals.uploadPhoto(actor, access, animalId(req), bytes, ctx.photos),
      });
    }) satisfies RequestHandler,

    removeMedia: (async (req, res) => {
      const { actor, access } = await farmContext(req);
      res.json({
        animal: await animals.removeMedia(
          actor,
          access,
          animalId(req),
          parseObjectId(req.params['mediaId']),
          ctx.photos,
        ),
      });
    }) satisfies RequestHandler,

    /** `/animals/:animalId` for deep links: access is derived from the animal's farm. */
    getById: (async (req, res) => {
      res.json({ animal: await animals.getAnimalById(requireActor(req), animalId(req)) });
    }) satisfies RequestHandler,
  };
}
