import type { RequestHandler } from 'express';
import {
  adminFarmListQuerySchema,
  adminUserListQuerySchema,
  setUserStatusSchema,
} from '@farmplus/validation';
import { parse, requireActor } from '../../lib/http';
import { parseObjectId } from '../../lib/object-id';
import { setUserStatus } from '../../services/user.service';
import { getAdminFarmDetail, listAdminFarms } from './admin-farms.service';
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

  /** Read-only farm list for platform staff (no actions in phase 1). */
  listFarms: (async (req, res) => {
    res.json(await listAdminFarms(requireActor(req), parse(adminFarmListQuerySchema, req.query)));
  }) satisfies RequestHandler,

  getFarm: (async (req, res) => {
    res.json(await getAdminFarmDetail(requireActor(req), parseObjectId(req.params['id'])));
  }) satisfies RequestHandler,
};
