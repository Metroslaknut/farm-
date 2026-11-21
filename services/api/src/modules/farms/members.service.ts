import type { Types } from 'mongoose';
import { memberAdded, memberRemoved, memberRoleChanged } from '../notifications/events';
import { hub } from '../realtime/hub';
import {
  effectiveFarmPermissions,
  type FarmMemberSummary,
  type FarmPermission,
  type FarmRole,
} from '@farmplus/shared-types';
import type { Actor } from '../../context';
import { conflict, forbidden, notFound } from '../../lib/errors';
import { FarmMember, User } from '../../models';
import { recordAudit } from '../../services/audit.service';
import { isDuplicateKey } from '../community/shared';
import {
  actingRank,
  assertFarmActive,
  requireFarmPermission,
  roleRank,
  type FarmAccess,
} from './farm-access';
import { assertPermissionsWithinRole, markMembershipEnded } from './invitations.service';

type MemberDoc = Awaited<ReturnType<typeof FarmMember.find>>[number];

async function toSummaries(
  members: MemberDoc[],
  canSeeEmail: boolean,
): Promise<FarmMemberSummary[]> {
  const users = new Map(
    (
      await User.find({ _id: { $in: members.map((m) => m.userId) } }).select(
        'displayName email avatarUrl',
      )
    ).map((u) => [String(u._id), u]),
  );
  return members.map((m) => {
    const u = users.get(String(m.userId));
    return {
      id: String(m._id),
      userId: String(m.userId),
      displayName: u?.displayName ?? 'Unknown user',
      ...(u?.avatarUrl ? { avatarUrl: u.avatarUrl } : {}),
      ...(canSeeEmail && u?.email ? { email: u.email } : {}),
      role: m.role,
      joinedAt: m.createdAt.toISOString(),
      permissions: effectiveFarmPermissions(m.role, m.permissions),
      customPermissions: m.role !== 'owner' && Array.isArray(m.permissions),
      ...(m.invitedAt ? { invitedAt: m.invitedAt.toISOString() } : {}),
      ...(m.approvedAt ? { approvedAt: m.approvedAt.toISOString() } : {}),
    };
  });
}

export async function listMembers(access: FarmAccess): Promise<FarmMemberSummary[]> {
  requireFarmPermission(access, 'members.read');
  const members = await FarmMember.find({ farmId: access.farm._id }).sort({ createdAt: 1 });
  // E-mail addresses are only shown to people who manage membership.
  return toSummaries(members, access.permissions.has('members.manage'));
}

/** You may only hand out / change roles strictly below your own (a manager cannot create another manager). */
function assertMayAssign(access: FarmAccess, role: FarmRole): void {
  if (roleRank(role) >= actingRank(access)) {
    throw forbidden('You can only assign roles below your own', 'ROLE_ESCALATION');
  }
}

export async function addMember(
  actor: Actor,
  access: FarmAccess,
  input: {
    userId?: string | undefined;
    email?: string | undefined;
    role: Exclude<FarmRole, 'owner'>;
  },
): Promise<FarmMemberSummary> {
  requireFarmPermission(access, 'members.manage');
  // Farm owners let people in through invitations / join requests (the person must agree). Adding someone directly
  // is kept for platform staff (`farms.manage`, MFA) who fix accounts on a farm's behalf.
  if (!actor.access.permissions.has('farms.manage'))
    throw forbidden('Invite the person instead: they must accept first', 'USE_INVITATION');
  assertFarmActive(access);
  assertMayAssign(access, input.role);

  const user = await User.findOne(input.userId ? { _id: input.userId } : { email: input.email });
  if (!user || user.status !== 'active') throw notFound('No active account found for that user');
  if (await FarmMember.exists({ farmId: access.farm._id, userId: user._id })) {
    throw conflict('This user is already a member of the farm', 'ALREADY_MEMBER');
  }
  const member = await FarmMember.create({
    farmId: access.farm._id,
    userId: user._id,
    role: input.role,
    addedBy: actor.userId,
  }).catch((error: unknown) => {
    // a parallel request added the same person first (unique farm + user)
    if (isDuplicateKey(error))
      throw conflict('This user is already a member of the farm', 'ALREADY_MEMBER');
    throw error;
  });
  await recordAudit({
    actorId: actor.userId,
    action: 'farm.member_added',
    targetType: 'farm',
    targetId: access.farm._id,
    metadata: { memberUserId: String(user._id), role: input.role },
    ip: actor.ip,
  });
  await memberAdded(
    user._id,
    { id: String(access.farm._id), name: access.farm.name },
    input.role,
    actor.userId,
  );
  return (await toSummaries([member], true))[0]!;
}

async function loadTarget(access: FarmAccess, memberId: Types.ObjectId) {
  const target = await FarmMember.findOne({ _id: memberId, farmId: access.farm._id }); // scoped: a member id from another farm is 404
  if (!target) throw notFound('Member not found');
  return target;
}

export async function updateMemberRole(
  actor: Actor,
  access: FarmAccess,
  memberId: Types.ObjectId,
  role: Exclude<FarmRole, 'owner'>,
): Promise<FarmMemberSummary> {
  requireFarmPermission(access, 'members.manage');
  assertFarmActive(access);
  const target = await loadTarget(access, memberId);
  if (target.role === 'owner')
    throw forbidden('The farm owner’s role cannot be changed', 'OWNER_IMMUTABLE');
  if (String(target.userId) === actor.userId)
    throw forbidden('You cannot change your own role', 'SELF_ROLE_CHANGE');
  if (roleRank(target.role) >= actingRank(access))
    throw forbidden('You cannot manage a member at or above your own level', 'ROLE_ESCALATION');
  assertMayAssign(access, role);
  if (target.role === role) throw conflict('Member already has this role', 'NO_CHANGE');

  const before = target.role;
  target.role = role;
  // A custom set belongs to the old role; the new role starts from its own defaults.
  target.permissions = null;
  await target.save();
  await recordAudit({
    actorId: actor.userId,
    action: 'farm.member_role_changed',
    targetType: 'farm',
    targetId: access.farm._id,
    metadata: { memberUserId: String(target.userId), from: before, to: role },
    ip: actor.ip,
  });
  await memberRoleChanged(
    target.userId,
    { id: String(access.farm._id), name: access.farm.name },
    role,
    actor.userId,
  );
  await hub.revalidateUser(String(target.userId));
  return (await toSummaries([target], true))[0]!;
}

/**
 * The owner switches individual permissions on/off for a member (`null` = back to the role's defaults). The role is
 * the ceiling; nobody can change their own permissions, and the owner's are fixed.
 */
export async function updateMemberPermissions(
  actor: Actor,
  access: FarmAccess,
  memberId: Types.ObjectId,
  permissions: FarmPermission[] | null,
): Promise<FarmMemberSummary> {
  requireFarmPermission(access, 'members.manage');
  assertFarmActive(access);
  const target = await loadTarget(access, memberId);
  if (target.role === 'owner')
    throw forbidden('The farm owner’s permissions cannot be changed', 'OWNER_IMMUTABLE');
  if (String(target.userId) === actor.userId)
    throw forbidden('You cannot change your own permissions', 'SELF_PERMISSION_CHANGE');
  if (roleRank(target.role) >= actingRank(access))
    throw forbidden('You cannot manage a member at or above your own level', 'ROLE_ESCALATION');
  const next = assertPermissionsWithinRole(target.role, permissions);

  const before = effectiveFarmPermissions(target.role, target.permissions);
  target.permissions = next;
  await target.save();
  const after = effectiveFarmPermissions(target.role, target.permissions);
  await recordAudit({
    actorId: actor.userId,
    action: 'farm.member_permissions_changed',
    targetType: 'farm',
    targetId: access.farm._id,
    metadata: {
      memberUserId: String(target.userId),
      added: after.filter((p) => !before.includes(p)),
      removed: before.filter((p) => !after.includes(p)),
      custom: next !== null,
    },
    ip: actor.ip,
  });
  await hub.revalidateUser(String(target.userId));
  return (await toSummaries([target], true))[0]!;
}

/** Members can always leave; removing someone else needs members.manage and a higher level than the target. */
export async function removeMember(
  actor: Actor,
  access: FarmAccess,
  memberId: Types.ObjectId,
): Promise<void> {
  const target = await loadTarget(access, memberId);
  if (target.role === 'owner')
    throw forbidden('The farm owner cannot be removed', 'OWNER_IMMUTABLE');
  const leaving = String(target.userId) === actor.userId;
  if (!leaving) {
    requireFarmPermission(access, 'members.manage');
    assertFarmActive(access);
    if (roleRank(target.role) >= actingRank(access))
      throw forbidden('You cannot remove a member at or above your own level', 'ROLE_ESCALATION');
  }
  await target.deleteOne();
  await markMembershipEnded(access.farm._id, target.userId, actor.userId);
  await recordAudit({
    actorId: actor.userId,
    action: leaving ? 'farm.member_left' : 'farm.member_removed',
    targetType: 'farm',
    targetId: access.farm._id,
    metadata: { memberUserId: String(target.userId), role: target.role },
    ip: actor.ip,
  });
  if (!leaving) await memberRemoved(target.userId, { name: access.farm.name }, actor.userId);
  await hub.revalidateUser(String(target.userId));
}
