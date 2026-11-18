import type { RequestHandler } from 'express';
import { adminUserListQuerySchema, setUserStatusSchema } from '@farmplus/validation';
import { parse, requireActor } from '../../lib/http';
import { parseObjectId } from '../../lib/object-id';
import { setUserStatus } from '../../services/user.service';
import { getAdminUserDetail, listAdminUsers } from './admin-users.service';
import { buildDashboard } from './dashboard.service';

export const adminController = {
  dashboard: (async (req, res) => {
    res.json(await buildDashboard(requireActor(req)));
  }) satisfies RequestHandler,

  listUsers: (async (req, res) => {
    res.json(await listAdminUsers(parse(adminUserListQuerySchema, req.query)));
  }) satisfies RequestHandler,

  getUser: (async (req, res) => {
    res.json(await getAdminUserDetail(requireActor(req), parseObjectId(req.params['id'])));
  }) satisfies RequestHandler,

  /** Reuses the Part 03 rules (no self-action, no acting on superiors, sessions revoked, audited). */
  setUserStatus: (async (req, res) => {
    const body = parse(setUserStatusSchema, req.body);
    const actor = requireActor(req);
    const id = parseObjectId(req.params['id']);
    await setUserStatus(actor, id, body.status, body.reason);
    res.json(await getAdminUserDetail(actor, id));
  }) satisfies RequestHandler,
};
