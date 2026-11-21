import type { RequestHandler } from 'express';
import {
  addBreedGroupSchema,
  addBreedSchema,
  addRearingTypeSchema,
  updateBreedGroupSchema,
  updateRearingTypeSchema,
  animalTypeListQuerySchema,
  createAnimalTypeSchema,
  updateAnimalTypeSchema,
  updateBreedSchema,
} from '@farmplus/validation';
import { forbidden } from '../../lib/errors';
import { parse, requireActor } from '../../lib/http';
import { parseObjectId } from '../../lib/object-id';
import * as types from './animal-types.service';

export const animalTypesController = {
  /** Any signed-in user may read the catalogue (it feeds the animal forms). Inactive entries need the manage permission. */
  list: (async (req, res) => {
    const actor = requireActor(req);
    const { includeInactive } = parse(animalTypeListQuerySchema, req.query);
    if (includeInactive === 'true' && !actor.access.permissions.has('animal_types.manage'))
      throw forbidden();
    res.json({ animalTypes: await types.listAnimalTypes(includeInactive === 'true') });
  }) satisfies RequestHandler,

  create: (async (req, res) => {
    res.status(201).json({
      animalType: await types.createAnimalType(
        requireActor(req),
        parse(createAnimalTypeSchema, req.body),
      ),
    });
  }) satisfies RequestHandler,

  update: (async (req, res) => {
    res.json({
      animalType: await types.updateAnimalType(
        requireActor(req),
        parseObjectId(req.params['id']),
        parse(updateAnimalTypeSchema, req.body),
      ),
    });
  }) satisfies RequestHandler,

  addBreed: (async (req, res) => {
    res.status(201).json({
      animalType: await types.addBreed(
        requireActor(req),
        parseObjectId(req.params['id']),
        parse(addBreedSchema, req.body),
      ),
    });
  }) satisfies RequestHandler,

  updateBreed: (async (req, res) => {
    const animalType = await types.updateBreed(
      requireActor(req),
      parseObjectId(req.params['id']),
      String(req.params['breedKey'] ?? ''),
      parse(updateBreedSchema, req.body),
    );
    res.json({ animalType });
  }) satisfies RequestHandler,

  addRearingType: (async (req, res) => {
    res.status(201).json({
      animalType: await types.addRearingType(
        requireActor(req),
        parseObjectId(req.params['id']),
        parse(addRearingTypeSchema, req.body),
      ),
    });
  }) satisfies RequestHandler,

  updateRearingType: (async (req, res) => {
    res.json({
      animalType: await types.updateRearingType(
        requireActor(req),
        parseObjectId(req.params['id']),
        String(req.params['key'] ?? ''),
        parse(updateRearingTypeSchema, req.body),
      ),
    });
  }) satisfies RequestHandler,

  addBreedGroup: (async (req, res) => {
    res.status(201).json({
      animalType: await types.addBreedGroup(
        requireActor(req),
        parseObjectId(req.params['id']),
        parse(addBreedGroupSchema, req.body),
      ),
    });
  }) satisfies RequestHandler,

  updateBreedGroup: (async (req, res) => {
    res.json({
      animalType: await types.updateBreedGroup(
        requireActor(req),
        parseObjectId(req.params['id']),
        String(req.params['key'] ?? ''),
        parse(updateBreedGroupSchema, req.body),
      ),
    });
  }) satisfies RequestHandler,
};
