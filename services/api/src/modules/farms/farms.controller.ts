import type { Request, RequestHandler } from 'express';
import {
  addMemberSchema,
  approveJoinRequestSchema,
  createFarmInvitationSchema,
  createFarmSchema,
  farmInvitationListQuerySchema,
  updateMemberPermissionsSchema,
  farmListQuerySchema,
  updateFarmSchema,
  updateMemberSchema,
} from '@farmplus/validation';
import { parse, requireActor } from '../../lib/http';
import { parseObjectId } from '../../lib/object-id';
import { loadFarmAccess } from './farm-access';
import * as farms from './farms.service';
import * as invitations from './invitations.service';
import * as members from './members.service';

/** Resolve the caller and their access to `:farmId` (404 when they have none). */
export async function farmContext(req: Request) {
  const actor = requireActor(req);
  return { actor, access: await loadFarmAccess(actor, parseObjectId(req.params['farmId'])) };
}

export const farmsController = {
  create: (async (req, res) => {
    res
      .status(201)
      .json({ farm: await farms.createFarm(requireActor(req), parse(createFarmSchema, req.body)) });
  }) satisfies RequestHandler,

  list: (async (req, res) => {
    res.json(await farms.listFarms(requireActor(req), parse(farmListQuerySchema, req.query)));
  }) satisfies RequestHandler,

  me: (async (req, res) => {
    res.json(await farms.farmSetupStatus(requireActor(req)));
  }) satisfies RequestHandler,

  summary: (async (req, res) => {
    const { access } = await farmContext(req);
    res.json(await farms.farmAnimalSummary(access));
  }) satisfies RequestHandler,

  get: (async (req, res) => {
    const { access } = await farmContext(req);
    res.json({ farm: await farms.getFarmDetail(access) });
  }) satisfies RequestHandler,

  update: (async (req, res) => {
    const { actor, access } = await farmContext(req);
    res.json({ farm: await farms.updateFarm(actor, access, parse(updateFarmSchema, req.body)) });
  }) satisfies RequestHandler,

  archive: (async (req, res) => {
    const { actor, access } = await farmContext(req);
    res.json({ farm: await farms.setFarmArchived(actor, access, true) });
  }) satisfies RequestHandler,

  restore: (async (req, res) => {
    const { actor, access } = await farmContext(req);
    res.json({ farm: await farms.setFarmArchived(actor, access, false) });
  }) satisfies RequestHandler,

  listMembers: (async (req, res) => {
    const { access } = await farmContext(req);
    res.json({ members: await members.listMembers(access) });
  }) satisfies RequestHandler,

  addMember: (async (req, res) => {
    const { actor, access } = await farmContext(req);
    res
      .status(201)
      .json({ member: await members.addMember(actor, access, parse(addMemberSchema, req.body)) });
  }) satisfies RequestHandler,

  updateMember: (async (req, res) => {
    const { actor, access } = await farmContext(req);
    const { role } = parse(updateMemberSchema, req.body);
    res.json({
      member: await members.updateMemberRole(
        actor,
        access,
        parseObjectId(req.params['memberId']),
        role,
      ),
    });
  }) satisfies RequestHandler,

  removeMember: (async (req, res) => {
    const { actor, access } = await farmContext(req);
    await members.removeMember(actor, access, parseObjectId(req.params['memberId']));
    res.status(204).end();
  }) satisfies RequestHandler,

  updateMemberPermissions: (async (req, res) => {
    const { actor, access } = await farmContext(req);
    const { permissions } = parse(updateMemberPermissionsSchema, req.body);
    res.json({
      member: await members.updateMemberPermissions(
        actor,
        access,
        parseObjectId(req.params['memberId']),
        permissions,
      ),
    });
  }) satisfies RequestHandler,

  listInvitations: (async (req, res) => {
    const { access } = await farmContext(req);
    const { status } = parse(farmInvitationListQuerySchema, req.query);
    res.json({ invitations: await invitations.listFarmInvitations(access, status) });
  }) satisfies RequestHandler,

  createInvitation: (async (req, res) => {
    const { actor, access } = await farmContext(req);
    res.status(201).json({
      invitation: await invitations.createInvitation(
        actor,
        access,
        parse(createFarmInvitationSchema, req.body),
      ),
    });
  }) satisfies RequestHandler,

  cancelInvitation: (async (req, res) => {
    const { actor, access } = await farmContext(req);
    res.json({
      invitation: await invitations.cancelInvitation(
        actor,
        access,
        parseObjectId(req.params['invitationId']),
      ),
    });
  }) satisfies RequestHandler,

  approveRequest: (async (req, res) => {
    const { actor, access } = await farmContext(req);
    res.json({
      invitation: await invitations.approveRequest(
        actor,
        access,
        parseObjectId(req.params['invitationId']),
        parse(approveJoinRequestSchema, req.body),
      ),
    });
  }) satisfies RequestHandler,

  rejectRequest: (async (req, res) => {
    const { actor, access } = await farmContext(req);
    res.json({
      invitation: await invitations.rejectRequest(
        actor,
        access,
        parseObjectId(req.params['invitationId']),
      ),
    });
  }) satisfies RequestHandler,
};
