import type { RequestHandler } from 'express';
import { createRoleSchema, updateRoleSchema } from '@farmplus/validation';
import { parse, requireActor } from '../../lib/http';
import { parseObjectId } from '../../lib/object-id';
import * as roles from '../../services/role.service';

export const rolesController = {
  list: (async (_req, res) => {
    res.json({ roles: await roles.listAdminRoles() });
  }) satisfies RequestHandler,

  get: (async (req, res) => {
    res.json({ role: await roles.getAdminRole(parseObjectId(req.params['id'])) });
  }) satisfies RequestHandler,

  create: (async (req, res) => {
    res
      .status(201)
      .json({ role: await roles.createRole(requireActor(req), parse(createRoleSchema, req.body)) });
  }) satisfies RequestHandler,

  update: (async (req, res) => {
    const role = await roles.updateRole(
      requireActor(req),
      parseObjectId(req.params['id']),
      parse(updateRoleSchema, req.body),
    );
    res.json({ role });
  }) satisfies RequestHandler,
};
