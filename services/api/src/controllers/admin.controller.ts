import type { RequestHandler } from 'express';
import { listQuerySchema, setRolePermissionsSchema } from '@farmplus/validation';
import { z } from 'zod';
import { parse, requireActor } from '../lib/http';
import { listAuditLogs } from '../services/audit.service';
import * as roles from '../services/role.service';

const auditQuerySchema = listQuerySchema.extend({
  action: z.string().max(100).optional(),
  actorId: z
    .string()
    .regex(/^[0-9a-f]{24}$/)
    .optional(),
});

export const adminController = {
  roles: (async (_req, res) => {
    res.json({ roles: await roles.listRoles() });
  }) satisfies RequestHandler,

  permissions: (async (_req, res) => {
    res.json({ permissions: await roles.listPermissions() });
  }) satisfies RequestHandler,

  setRolePermissions: (async (req, res) => {
    const { permissions } = parse(setRolePermissionsSchema, req.body);
    res.json({
      role: await roles.setRolePermissions(
        requireActor(req),
        String(req.params['key'] ?? ''),
        permissions,
      ),
    });
  }) satisfies RequestHandler,

  auditLogs: (async (req, res) => {
    res.json(await listAuditLogs(parse(auditQuerySchema, req.query)));
  }) satisfies RequestHandler,
};
