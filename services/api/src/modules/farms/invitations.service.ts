import { Types } from 'mongoose';
import {
  grantableFarmPermissions,
  type FarmInvitationDTO,
  type FarmInvitationStatus,
  type FarmPermission,
  type FarmRole,
} from '@farmplus/shared-types';
import type { Actor } from '../../context';
import { conflict, forbidden, notFound } from '../../lib/errors';
import { Farm, FarmInvitation, FarmMember, User, type FarmInvitationDoc } from '../../models';
import { recordAudit } from '../../services/audit.service';
import { isDuplicateKey } from '../community/shared';
import {
  invitationAnswered,
  invitationReceived,
  joinRejected,
  joinRequested,
  memberAdded,
} from '../notifications/events';
import { assertFarmActive, requireFarmPermission, type FarmAccess } from './farm-access';

type AssignableRole = Exclude<FarmRole, 'owner'>;

/**
 * Invitations (owner → person) and join requests (person → farm).
 *
 * - Nobody gets farm access while an invitation is PENDING: the `farm_members` row is created only at the moment it
 *   becomes APPROVED (the invitee accepts an invitation, or the owner approves a request).
 * - Every transition is a compare-and-set on `status: 'PENDING'`, so two parallel answers cannot both win.
 * - Only holders of `members.manage` (the owner; platform `farms.manage` staff) can invite, approve, reject or cancel
 *   on a farm's behalf.
 */

/** A custom permission set must stay inside the role (the role is the ceiling: customising only narrows). */
export function assertPermissionsWithinRole(
  role: AssignableRole,
  permissions: readonly FarmPermission[] | null | undefined,
): FarmPermission[] | null {
  if (!permissions) return null;
  const allowed = new Set(grantableFarmPermissions(role));
  const above = permissions.filter((p) => p !== 'farm.read' && !allowed.has(p));
  if (above.length > 0) {
    throw forbidden(
      `These permissions are above the ${role} role: ${above.join(', ')}`,
      'PERMISSION_ESCALATION',
    );
  }
  return [...new Set(permissions.filter((p) => p !== 'farm.read'))];
}

async function ownerIds(farmId: Types.ObjectId): Promise<Types.ObjectId[]> {
  const rows = await FarmMember.find({ farmId, role: 'owner' }).select('userId');
  return rows.map((r) => r.userId);
}

async function toDTOs(
  rows: FarmInvitationDoc[],
  canSeeEmail: boolean,
): Promise<FarmInvitationDTO[]> {
  const [farms, users] = await Promise.all([
    Farm.find({ _id: { $in: [...new Set(rows.map((r) => String(r.farmId)))] } }).select('name'),
    User.find({ _id: { $in: [...new Set(rows.map((r) => String(r.userId)))] } }).select(
      'displayName avatarUrl email',
    ),
  ]);
  const farmById = new Map(farms.map((f) => [String(f._id), f]));
  const userById = new Map(users.map((u) => [String(u._id), u]));
  return rows.map((r) => {
    const f = farmById.get(String(r.farmId));
    const u = userById.get(String(r.userId));
    return {
      id: String(r._id),
      direction: r.direction,
      status: r.status,
      farm: { id: String(r.farmId), name: f?.name ?? 'Unknown farm' },
      user: {
        id: String(r.userId),
        displayName: u?.displayName ?? 'Unknown user',
        ...(u?.avatarUrl ? { avatarUrl: u.avatarUrl } : {}),
        ...(canSeeEmail && u?.email ? { email: u.email } : {}),
      },
      ...(r.role ? { role: r.role } : {}),
      permissions: r.permissions ?? null,
      ...(r.message ? { message: r.message } : {}),
      createdAt: r.createdAt.toISOString(),
      ...(r.decidedAt ? { decidedAt: r.decidedAt.toISOString() } : {}),
      ...(r.endedAt ? { endedAt: r.endedAt.toISOString() } : {}),
    };
  });
}

const audit = (
  actor: Actor,
  action: string,
  farmId: Types.ObjectId,
  inv: FarmInvitationDoc,
  extra: Record<string, unknown> = {},
) =>
  recordAudit({
    actorId: actor.userId,
    action,
    targetType: 'farm',
    targetId: farmId,
    metadata: {
      invitationId: String(inv._id),
      direction: inv.direction,
      memberUserId: String(inv.userId),
      ...extra,
    },
    ip: actor.ip,
  });

/** Atomically move a PENDING invitation to `status`; null when it was not pending any more. */
async function transition(
  filter: Record<string, unknown>,
  status: FarmInvitationStatus,
  actorId: string,
  extra: Record<string, unknown> = {},
): Promise<FarmInvitationDoc | null> {
  return FarmInvitation.findOneAndUpdate(
    { ...filter, status: 'PENDING' },
    {
      $set: {
        status,
        decidedBy: new Types.ObjectId(actorId),
        decidedAt: new Date(),
        ...extra,
      },
    },
    { new: true },
  );
}

async function loadOrThrow(filter: Record<string, unknown>): Promise<FarmInvitationDoc> {
  const inv = await FarmInvitation.findOne(filter);
  if (!inv) throw notFound('Invitation not found');
  return inv;
}

const notPending = () =>
  conflict('This invitation has already been answered', 'INVITATION_NOT_PENDING');

/** Create the membership for an APPROVED invitation. Undone (status CANCELLED) if the person is already a member. */
async function createMembership(
  inv: FarmInvitationDoc,
  role: AssignableRole,
  permissions: FarmPermission[] | null,
  addedBy: string,
) {
  try {
    return await FarmMember.create({
      farmId: inv.farmId,
      userId: inv.userId,
      role,
      permissions,
      invitationId: inv._id,
      invitedAt: inv.createdAt,
      approvedAt: inv.decidedAt ?? new Date(),
      addedBy: new Types.ObjectId(addedBy),
    });
  } catch (error) {
    if (isDuplicateKey(error)) {
      await FarmInvitation.updateOne({ _id: inv._id }, { $set: { status: 'CANCELLED' } });
      throw conflict('This user is already a member of the farm', 'ALREADY_MEMBER');
    }
    // Leave nothing half-done: the invitation goes back to PENDING so it can be answered again.
    await FarmInvitation.updateOne(
      { _id: inv._id },
      { $set: { status: 'PENDING', decidedBy: null, decidedAt: null } },
    );
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Farm side (owner)
// ---------------------------------------------------------------------------
export async function listFarmInvitations(
  access: FarmAccess,
  status: FarmInvitationStatus | undefined,
): Promise<FarmInvitationDTO[]> {
  requireFarmPermission(access, 'members.manage');
  const rows = await FarmInvitation.find({
    farmId: access.farm._id,
    ...(status ? { status } : {}),
  })
    .sort({ createdAt: -1 })
    .limit(200);
  return toDTOs(rows, true);
}

export async function createInvitation(
  actor: Actor,
  access: FarmAccess,
  input: {
    email?: string | undefined;
    phone?: string | undefined;
    role: AssignableRole;
    permissions?: FarmPermission[] | undefined;
    message?: string | undefined;
  },
): Promise<FarmInvitationDTO> {
  requireFarmPermission(access, 'members.manage');
  assertFarmActive(access);
  const permissions = assertPermissionsWithinRole(input.role, input.permissions);

  // Exact match only (no partial names): a lookup cannot be used to list accounts. Rate limited at the route.
  const user = await User.findOne(input.email ? { email: input.email } : { phone: input.phone });
  if (!user || user.status !== 'active') throw notFound('No active account found for that user');
  if (String(user._id) === actor.userId)
    throw conflict('You cannot invite yourself', 'SELF_INVITE');
  if (await FarmMember.exists({ farmId: access.farm._id, userId: user._id }))
    throw conflict('This user is already a member of the farm', 'ALREADY_MEMBER');

  const inv = await FarmInvitation.create({
    farmId: access.farm._id,
    userId: user._id,
    direction: 'invite',
    role: input.role,
    permissions,
    message: input.message ?? null,
    createdBy: new Types.ObjectId(actor.userId),
  }).catch((error: unknown) => {
    if (isDuplicateKey(error))
      throw conflict(
        'There is already an open invitation or request for this user',
        'INVITATION_PENDING',
      );
    throw error;
  });
  await audit(actor, 'farm.invitation_created', access.farm._id, inv, { role: input.role });
  await invitationReceived(user._id, { name: access.farm.name }, input.role, actor.userId);
  return (await toDTOs([inv], true))[0]!;
}

/** The owner withdraws an invitation the invitee has not answered yet. */
export async function cancelInvitation(
  actor: Actor,
  access: FarmAccess,
  invitationId: Types.ObjectId,
): Promise<FarmInvitationDTO> {
  requireFarmPermission(access, 'members.manage');
  const scope = { _id: invitationId, farmId: access.farm._id, direction: 'invite' };
  await loadOrThrow(scope);
  const inv = await transition(scope, 'CANCELLED', actor.userId);
  if (!inv) throw notPending();
  await audit(actor, 'farm.invitation_cancelled', access.farm._id, inv);
  return (await toDTOs([inv], true))[0]!;
}

/** The owner approves a join request, choosing the role (and optionally narrowing its permissions). */
export async function approveRequest(
  actor: Actor,
  access: FarmAccess,
  invitationId: Types.ObjectId,
  input: { role: AssignableRole; permissions?: FarmPermission[] | undefined },
): Promise<FarmInvitationDTO> {
  requireFarmPermission(access, 'members.manage');
  assertFarmActive(access);
  const permissions = assertPermissionsWithinRole(input.role, input.permissions);
  const scope = { _id: invitationId, farmId: access.farm._id, direction: 'request' };
  await loadOrThrow(scope);
  const inv = await transition(scope, 'APPROVED', actor.userId, {
    role: input.role,
    permissions,
  });
  if (!inv) throw notPending();
  await createMembership(inv, input.role, permissions, actor.userId);
  await audit(actor, 'farm.join_request_approved', access.farm._id, inv, { role: input.role });
  await memberAdded(
    inv.userId,
    { id: String(access.farm._id), name: access.farm.name },
    input.role,
    actor.userId,
  );
  return (await toDTOs([inv], true))[0]!;
}

export async function rejectRequest(
  actor: Actor,
  access: FarmAccess,
  invitationId: Types.ObjectId,
): Promise<FarmInvitationDTO> {
  requireFarmPermission(access, 'members.manage');
  const scope = { _id: invitationId, farmId: access.farm._id, direction: 'request' };
  await loadOrThrow(scope);
  const inv = await transition(scope, 'REJECTED', actor.userId);
  if (!inv) throw notPending();
  await audit(actor, 'farm.join_request_rejected', access.farm._id, inv);
  await joinRejected(inv.userId, { name: access.farm.name }, actor.userId);
  return (await toDTOs([inv], true))[0]!;
}

// ---------------------------------------------------------------------------
// Person side (invitee / requester)
// ---------------------------------------------------------------------------
export async function listMine(
  actor: Actor,
  status: FarmInvitationStatus | undefined,
): Promise<FarmInvitationDTO[]> {
  const rows = await FarmInvitation.find({
    userId: actor.userId,
    ...(status ? { status } : {}),
  })
    .sort({ createdAt: -1 })
    .limit(200);
  return toDTOs(rows, false);
}

/** Scoped to the caller: someone else's invitation id is 404. */
const mine = (actor: Actor, id: Types.ObjectId, direction: 'invite' | 'request') => ({
  _id: id,
  userId: new Types.ObjectId(actor.userId),
  direction,
});

export async function acceptInvitation(
  actor: Actor,
  invitationId: Types.ObjectId,
): Promise<FarmInvitationDTO> {
  const scope = mine(actor, invitationId, 'invite');
  const pending = await loadOrThrow(scope);
  const farm = await Farm.findById(pending.farmId).select('name status');
  if (!farm) throw notFound('Invitation not found');
  if (farm.status === 'archived') throw conflict('This farm is archived', 'FARM_ARCHIVED');
  const inv = await transition(scope, 'APPROVED', actor.userId);
  if (!inv) throw notPending();
  await createMembership(inv, inv.role ?? 'viewer', inv.permissions ?? null, String(inv.createdBy));
  await audit(actor, 'farm.invitation_accepted', inv.farmId, inv, { role: inv.role });
  const me = await User.findById(actor.userId).select('displayName');
  await invitationAnswered(
    await ownerIds(inv.farmId),
    { id: String(inv.farmId), name: farm.name },
    me?.displayName ?? 'A user',
    true,
    actor.userId,
  );
  return (await toDTOs([inv], false))[0]!;
}

export async function declineInvitation(
  actor: Actor,
  invitationId: Types.ObjectId,
): Promise<FarmInvitationDTO> {
  const scope = mine(actor, invitationId, 'invite');
  await loadOrThrow(scope);
  const inv = await transition(scope, 'REJECTED', actor.userId);
  if (!inv) throw notPending();
  await audit(actor, 'farm.invitation_declined', inv.farmId, inv);
  const [farm, me] = await Promise.all([
    Farm.findById(inv.farmId).select('name'),
    User.findById(actor.userId).select('displayName'),
  ]);
  await invitationAnswered(
    await ownerIds(inv.farmId),
    { id: String(inv.farmId), name: farm?.name ?? '' },
    me?.displayName ?? 'A user',
    false,
    actor.userId,
  );
  return (await toDTOs([inv], false))[0]!;
}

export async function requestToJoin(
  actor: Actor,
  input: { farmId: string; message?: string | undefined },
): Promise<FarmInvitationDTO> {
  const farmId = new Types.ObjectId(input.farmId);
  const farm = await Farm.findById(farmId).select('name status');
  if (!farm) throw notFound('Farm not found');
  if (farm.status === 'archived') throw conflict('This farm is archived', 'FARM_ARCHIVED');
  if (await FarmMember.exists({ farmId, userId: actor.userId }))
    throw conflict('You are already a member of this farm', 'ALREADY_MEMBER');
  const inv = await FarmInvitation.create({
    farmId,
    userId: new Types.ObjectId(actor.userId),
    direction: 'request',
    message: input.message ?? null,
    createdBy: new Types.ObjectId(actor.userId),
  }).catch((error: unknown) => {
    if (isDuplicateKey(error))
      throw conflict(
        'There is already an open invitation or request for this farm',
        'INVITATION_PENDING',
      );
    throw error;
  });
  await audit(actor, 'farm.join_requested', farmId, inv);
  const me = await User.findById(actor.userId).select('displayName');
  await joinRequested(
    await ownerIds(farmId),
    { id: String(farmId), name: farm.name },
    me?.displayName ?? 'A user',
    actor.userId,
  );
  return (await toDTOs([inv], false))[0]!;
}

/** The requester withdraws their own unanswered join request. */
export async function cancelMyRequest(
  actor: Actor,
  invitationId: Types.ObjectId,
): Promise<FarmInvitationDTO> {
  const scope = mine(actor, invitationId, 'request');
  await loadOrThrow(scope);
  const inv = await transition(scope, 'CANCELLED', actor.userId);
  if (!inv) throw notPending();
  await audit(actor, 'farm.join_request_cancelled', inv.farmId, inv);
  return (await toDTOs([inv], false))[0]!;
}

/** Called when a membership ends: the invitation that created it becomes REVOKED (history of who had access). */
export async function markMembershipEnded(
  farmId: Types.ObjectId,
  userId: Types.ObjectId,
  endedBy: string,
): Promise<void> {
  await FarmInvitation.updateMany(
    { farmId, userId, status: 'APPROVED' },
    {
      $set: { status: 'REVOKED', endedBy: new Types.ObjectId(endedBy), endedAt: new Date() },
    },
  );
}
