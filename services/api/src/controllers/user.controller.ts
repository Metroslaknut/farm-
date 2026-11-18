import type { RequestHandler } from 'express';
import {
  assignRoleSchema,
  listQuerySchema,
  setUserStatusSchema,
  updateProfileSchema,
} from '@farmplus/validation';
import { parse, requireActor } from '../lib/http';
import { parseObjectId } from '../lib/object-id';
import * as roles from '../services/role.service';
import * as users from '../services/user.service';

export const userController = {
  list: (async (req, res) => {
    res.json(await users.listUsers(parse(listQuerySchema, req.query)));
  }) satisfies RequestHandler,

  me: (async (req, res) => {
    res.json({ user: await users.getPublicUser(parseObjectId(requireActor(req).userId)) });
  }) satisfies RequestHandler,

  updateMe: (async (req, res) => {
    const actor = requireActor(req);
    const user = await users.updateProfile(
      actor,
      parseObjectId(actor.userId),
      parse(updateProfileSchema, req.body),
    );
    res.json({ user });
  }) satisfies RequestHandler,

  get: (async (req, res) => {
    res.json({ user: await users.getPublicUser(parseObjectId(req.params['id'])) });
  }) satisfies RequestHandler,

  update: (async (req, res) => {
    const user = await users.updateProfile(
      requireActor(req),
      parseObjectId(req.params['id']),
      parse(updateProfileSchema, req.body),
    );
    res.json({ user });
  }) satisfies RequestHandler,

  setStatus: (async (req, res) => {
    const body = parse(setUserStatusSchema, req.body);
    res.json({
      user: await users.setUserStatus(
        requireActor(req),
        parseObjectId(req.params['id']),
        body.status,
        body.reason,
      ),
    });
  }) satisfies RequestHandler,

  roles: (async (req, res) => {
    res.json({ roles: await roles.getUserRoleKeys(parseObjectId(req.params['id'])) });
  }) satisfies RequestHandler,

  assignRole: (async (req, res) => {
    const { roleKey } = parse(assignRoleSchema, req.body);
    const actor = requireActor(req);
    res
      .status(201)
      .json({ roles: await roles.assignRole(actor, parseObjectId(req.params['id']), roleKey) });
  }) satisfies RequestHandler,

  revokeRole: (async (req, res) => {
    const actor = requireActor(req);
    const roleKey = String(req.params['roleKey'] ?? '');
    res.json({ roles: await roles.revokeRole(actor, parseObjectId(req.params['id']), roleKey) });
  }) satisfies RequestHandler,
};
