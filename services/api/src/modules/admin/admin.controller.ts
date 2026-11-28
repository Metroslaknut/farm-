import type { RequestHandler } from 'express';
import {
  adminOrderListQuerySchema,
  adminUserListQuerySchema,
  setUserStatusSchema,
} from '@farmplus/validation';
import type { AppContext } from '../../context';
import { parse, requireActor } from '../../lib/http';
import { parseObjectId } from '../../lib/object-id';
import { setUserStatus } from '../../services/user.service';
import { getAdminOrder, listAdminOrders, revealOrderContact } from './admin-orders.service';
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

/** Admin orders (read-only). Handlers need the server secret that encrypts delivery addresses. */
export const adminOrdersController = (ctx: AppContext) => ({
  list: (async (req, res) => {
    res.json(await listAdminOrders(parse(adminOrderListQuerySchema, req.query)));
  }) satisfies RequestHandler,

  get: (async (req, res) => {
    res.json(await getAdminOrder(parseObjectId(req.params['id']), ctx.mfaKey));
  }) satisfies RequestHandler,

  /** Unmasked delivery contact: audited and rate limited (see admin.routes.ts). */
  contact: (async (req, res) => {
    res.json(
      await revealOrderContact(requireActor(req), parseObjectId(req.params['id']), ctx.mfaKey),
    );
  }) satisfies RequestHandler,
});
