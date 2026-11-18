import type { RequestHandler } from 'express';
import {
  registrationDecisionSchema,
  registrationListQuerySchema,
  submitRegistrationSchema,
} from '@farmplus/validation';
import { parse, requireActor } from '../../lib/http';
import { parseObjectId } from '../../lib/object-id';
import * as registrations from './registrations.service';

const decision =
  (kind: registrations.Decision): RequestHandler =>
  async (req, res) => {
    const { reason } = parse(registrationDecisionSchema, req.body);
    res.json({
      registration: await registrations.decide(
        requireActor(req),
        parseObjectId(req.params['id']),
        kind,
        reason,
      ),
    });
  };

export const registrationsController = {
  submit: (async (req, res) => {
    const body = parse(submitRegistrationSchema, req.body);
    res
      .status(201)
      .json({ registration: await registrations.submitRegistration(requireActor(req), body) });
  }) satisfies RequestHandler,

  mine: (async (req, res) => {
    res.json({
      registrations: await registrations.listMyRegistrations(
        parseObjectId(requireActor(req).userId),
      ),
    });
  }) satisfies RequestHandler,

  list: (async (req, res) => {
    res.json(await registrations.listRegistrations(parse(registrationListQuerySchema, req.query)));
  }) satisfies RequestHandler,

  get: (async (req, res) => {
    res.json({
      registration: await registrations.getRegistration(parseObjectId(req.params['id'])),
    });
  }) satisfies RequestHandler,

  review: (async (req, res) => {
    res.json({
      registration: await registrations.startReview(
        requireActor(req),
        parseObjectId(req.params['id']),
      ),
    });
  }) satisfies RequestHandler,

  approve: decision('approve'),
  reject: decision('reject'),
  suspend: decision('suspend'),
  reinstate: decision('reinstate'),
};
