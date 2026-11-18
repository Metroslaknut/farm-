import { randomUUID } from 'node:crypto';
import type { Types } from 'mongoose';
import type { AdminRoleSummary, PermissionSummary, RoleSummary } from '@farmplus/shared-types';
import type { Actor } from '../context';
import { conflict, forbidden, notFound } from '../lib/errors';
import { Permission, Role, RolePermission, User, UserRole } from '../models';
import { isSubset, permissionKeysOfRole } from '../rbac/access';
import { PROTECTED_ROLE_KEYS } from '../rbac/definitions';
import { recordAudit } from './audit.service';
import { revokeAllSessions } from './session.service';

export async function listPermissions(): Promise<PermissionSummary[]> {
  const rows = await Permission.find().sort({ key: 1 });
  return rows.map((p) => ({ key: p.key, description: p.description }));
}

async function summarize(role: InstanceType<typeof Role>): Promise<RoleSummary> {
  return {
    key: role.key,
    name: role.name,
    description: role.description,
    isSystem: role.isSystem,
    requiresMfa: role.requiresMfa,
    permissions: await permissionKeysOfRole(role._id),
  };
}

export async function listRoles(): Promise<RoleSummary[]> {
  const roles = await Role.find().sort({ key: 1 });
  return Promise.all(roles.map(summarize));
}

async function requireRole(key: string) {
  const role = await Role.findOne({ key });
  if (!role) throw notFound('Role not found');
  return role;
}

/** Change what a role grants. Requires `permissions.manage`; the same rules as the admin role editor apply. */
export async function setRolePermissions(
  actor: Actor,
  roleKey: string,
  permissionKeys: string[],
): Promise<RoleSummary> {
  const role = await requireRole(roleKey);
  if (role.key === 'super_admin')
    throw forbidden('The super_admin role cannot be modified', 'ROLE_IMMUTABLE');
  const diff = await replaceRolePermissions(actor, role, permissionKeys);
  await recordAudit({
    actorId: actor.userId,
    action: 'role.permissions_changed',
    targetType: 'role',
    targetId: role.key,
    metadata: diff,
    ip: actor.ip,
  });
  return summarize(role);
}

/** Rules shared by assign and revoke. Throws unless `actor` may change `role` for `target`. */
async function assertMayChangeRole(
  actor: Actor,
  targetId: Types.ObjectId,
  role: InstanceType<typeof Role>,
): Promise<void> {
  if (String(targetId) === actor.userId)
    throw forbidden('You cannot change your own roles', 'SELF_ROLE_CHANGE');
  if (PROTECTED_ROLE_KEYS.includes(role.key) && !actor.access.roleKeys.includes('super_admin')) {
    throw forbidden('Only a super admin can grant or revoke this role', 'PRIVILEGE_ESCALATION');
  }
  const rolePerms = await permissionKeysOfRole(role._id);
  if (!isSubset(rolePerms, actor.access.permissions)) {
    throw forbidden(
      'You cannot manage a role with permissions you do not hold',
      'PRIVILEGE_ESCALATION',
    );
  }
}

export async function getUserRoleKeys(userId: Types.ObjectId): Promise<string[]> {
  const links = await UserRole.find({ userId });
  const roles = await Role.find({ _id: { $in: links.map((l) => l.roleId) } });
  return roles.map((r) => r.key).sort();
}

/** Serialize changes to a role across API instances; the lease recovers automatically after a crashed process. */
async function withRoleMutationLock<T>(
  roleId: Types.ObjectId,
  operation: () => Promise<T>,
): Promise<T> {
  const token = randomUUID();
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const now = new Date();
    const locked = await Role.findOneAndUpdate(
      {
        _id: roleId,
        $or: [{ mutationLockUntil: { $exists: false } }, { mutationLockUntil: { $lt: now } }],
      },
      {
        $set: {
          mutationLockToken: token,
          mutationLockUntil: new Date(now.getTime() + 60_000),
        },
      },
      { returnDocument: 'after' },
    );
    if (locked) {
      try {
        return await operation();
      } finally {
        await Role.updateOne(
          { _id: roleId, mutationLockToken: token },
          { $unset: { mutationLockToken: 1, mutationLockUntil: 1 } },
        );
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw conflict('Another role change is in progress. Retry shortly.', 'ROLE_CHANGE_BUSY');
}

export async function assignRole(
  actor: Actor,
  targetId: Types.ObjectId,
  roleKey: string,
): Promise<string[]> {
  if (!(await User.exists({ _id: targetId }))) throw notFound('User not found');
  const role = await requireRole(roleKey);
  await assertMayChangeRole(actor, targetId, role);
  const res = await UserRole.updateOne(
    { userId: targetId, roleId: role._id },
    { $setOnInsert: { grantedBy: actor.userId, grantedAt: new Date() } },
    { upsert: true },
  );
  if (res.upsertedCount === 0) throw conflict('User already has this role', 'NO_CHANGE');
  await recordAudit({
    actorId: actor.userId,
    action: 'user.role_assigned',
    targetType: 'user',
    targetId,
    metadata: { role: role.key },
    ip: actor.ip,
  });
  return getUserRoleKeys(targetId);
}

export async function revokeRole(
  actor: Actor,
  targetId: Types.ObjectId,
  roleKey: string,
): Promise<string[]> {
  if (!(await User.exists({ _id: targetId }))) throw notFound('User not found');
  const role = await requireRole(roleKey);
  await assertMayChangeRole(actor, targetId, role);
  const remove = async () => {
    if (role.key === 'super_admin' && (await UserRole.countDocuments({ roleId: role._id })) <= 1) {
      throw conflict('Cannot remove the last super admin', 'LAST_SUPER_ADMIN');
    }
    return UserRole.deleteOne({ userId: targetId, roleId: role._id });
  };
  const res =
    role.key === 'super_admin' ? await withRoleMutationLock(role._id, remove) : await remove();
  if (res.deletedCount === 0) throw conflict('User does not have this role', 'NO_CHANGE');
  // Cached nothing: permissions are resolved per request, so revocation is immediate.
  // Elevated roles also end the target's sessions so MFA-verified state cannot linger.
  if (role.requiresMfa) await revokeAllSessions(targetId, 'role_revoked');
  await recordAudit({
    actorId: actor.userId,
    action: 'user.role_revoked',
    targetType: 'user',
    targetId,
    metadata: { role: role.key },
    ip: actor.ip,
  });
  return getUserRoleKeys(targetId);
}

// ---------------------------------------------------------------------------
// Admin backoffice: role administration
// ---------------------------------------------------------------------------

async function toAdminSummary(role: InstanceType<typeof Role>): Promise<AdminRoleSummary> {
  return {
    ...(await summarize(role)),
    id: String(role._id),
    userCount: await UserRole.countDocuments({ roleId: role._id }),
  };
}

export async function listAdminRoles(): Promise<AdminRoleSummary[]> {
  const roles = await Role.find().sort({ key: 1 });
  return Promise.all(roles.map(toAdminSummary));
}

export async function getAdminRole(id: Types.ObjectId): Promise<AdminRoleSummary> {
  const role = await Role.findById(id);
  if (!role) throw notFound('Role not found');
  return toAdminSummary(role);
}

/** Any role that carries global permissions is privileged, so it always requires MFA. */
const needsMfa = (permissionCount: number, current = false): boolean =>
  current || permissionCount > 0;

/**
 * Create a custom (non-system) role. Granting permissions additionally needs `permissions.manage`
 * and the actor may only include permissions they hold themselves (no escalation).
 */
export async function createRole(
  actor: Actor,
  input: { key: string; name: string; description: string; permissions: string[] },
): Promise<AdminRoleSummary> {
  const permissionKeys = [...new Set(input.permissions)].sort();
  assertMayGrantPermissions(actor, permissionKeys);
  if (await Role.exists({ key: input.key }))
    throw conflict('A role with this key already exists', 'ROLE_EXISTS');

  const role = await Role.create({
    key: input.key,
    name: input.name,
    description: input.description,
    isSystem: false,
    requiresMfa: needsMfa(permissionKeys.length),
  });
  const perms = await Permission.find({ key: { $in: permissionKeys } });
  await RolePermission.insertMany(perms.map((p) => ({ roleId: role._id, permissionId: p._id })));
  await recordAudit({
    actorId: actor.userId,
    action: 'role.created',
    targetType: 'role',
    targetId: role.key,
    metadata: { name: input.name, permissions: permissionKeys },
    ip: actor.ip,
  });
  return toAdminSummary(role);
}

function assertMayGrantPermissions(actor: Actor, keys: string[]): void {
  if (keys.length === 0) return;
  if (!actor.access.permissions.has('permissions.manage')) {
    throw forbidden('Changing role permissions requires permissions.manage', 'FORBIDDEN');
  }
  if (!isSubset(keys, actor.access.permissions)) {
    throw forbidden('You cannot grant permissions you do not hold', 'PRIVILEGE_ESCALATION');
  }
}

/**
 * Replace the permissions a role grants (both the legacy and the admin endpoint). Requires `permissions.manage`; adding is
 * bounded by what the actor holds, and a role carrying permissions the actor lacks cannot be edited by them at all.
 * A role that becomes privileged requires MFA from then on, and its holders' existing sessions end. The caller saves `role`.
 */
async function replaceRolePermissions(
  actor: Actor,
  role: InstanceType<typeof Role>,
  permissionKeys: string[],
): Promise<{ added: string[]; removed: string[] }> {
  return withRoleMutationLock(role._id, async () => {
    const before = await permissionKeysOfRole(role._id);
    const after = [...new Set(permissionKeys)].sort();
    const added = after.filter((k) => !before.includes(k));
    // Removing is always allowed for permissions.manage holders; adding is bounded by what you hold.
    if (!actor.access.permissions.has('permissions.manage')) {
      throw forbidden('Changing role permissions requires permissions.manage', 'FORBIDDEN');
    }
    assertMayGrantPermissions(actor, added);
    // Roles with fewer-privileged semantics must not be edited by someone who lacks the role's powers.
    if (!isSubset(before, actor.access.permissions)) {
      throw forbidden(
        'You cannot modify a role with permissions you do not hold',
        'PRIVILEGE_ESCALATION',
      );
    }
    const perms = await Permission.find({ key: { $in: after } });
    if (needsMfa(after.length, role.requiresMfa) !== role.requiresMfa) {
      // Require MFA before exposing the new permissions; otherwise requests during this update could
      // observe a privileged role while its existing sessions still appear non-MFA.
      role.requiresMfa = true;
      await role.save();
      const holders = await UserRole.find({ roleId: role._id }).select('userId');
      for (const holder of holders)
        await revokeAllSessions(holder.userId, 'role_became_privileged');
    }
    await RolePermission.deleteMany({ roleId: role._id });
    await RolePermission.insertMany(perms.map((p) => ({ roleId: role._id, permissionId: p._id })));
    return { added, removed: before.filter((k) => !after.includes(k)) };
  });
}

export async function updateRole(
  actor: Actor,
  id: Types.ObjectId,
  input: {
    name?: string | undefined;
    description?: string | undefined;
    permissions?: string[] | undefined;
  },
): Promise<AdminRoleSummary> {
  const role = await Role.findById(id);
  if (!role) throw notFound('Role not found');
  if (role.key === 'super_admin')
    throw forbidden('The super_admin role cannot be modified', 'ROLE_IMMUTABLE');

  const changes: Record<string, unknown> = {};
  if (input.permissions !== undefined) {
    changes['permissions'] = await replaceRolePermissions(actor, role, input.permissions);
  }
  if (input.name !== undefined && input.name !== role.name) {
    changes['name'] = { from: role.name, to: input.name };
    role.name = input.name;
  }
  if (input.description !== undefined && input.description !== role.description) {
    changes['description'] = { from: role.description, to: input.description };
    role.description = input.description;
  }
  if (Object.keys(changes).length === 0) throw conflict('Nothing to change', 'NO_CHANGE');
  await role.save();
  await recordAudit({
    actorId: actor.userId,
    action: 'role.updated',
    targetType: 'role',
    targetId: role.key,
    metadata: changes,
    ip: actor.ip,
  });
  return toAdminSummary(role);
}

export async function permissionMatrix(): Promise<
  { key: string; description: string; roles: string[] }[]
> {
  const [permissions, roles, links] = await Promise.all([
    Permission.find().sort({ key: 1 }),
    Role.find(),
    RolePermission.find(),
  ]);
  const roleKey = new Map(roles.map((r) => [String(r._id), r.key]));
  return permissions.map((p) => ({
    key: p.key,
    description: p.description,
    roles: links
      .filter((l) => String(l.permissionId) === String(p._id))
      .flatMap((l) => roleKey.get(String(l.roleId)) ?? [])
      .sort(),
  }));
}

/**
 * Server-controlled grant/revoke used by approval workflows (e.g. registration approval).
 * NOT exposed directly: callers must have already authorised the action.
 */
export async function grantRoleInternal(
  userId: Types.ObjectId,
  roleKey: string,
  grantedBy: Types.ObjectId | string,
): Promise<void> {
  const role = await Role.findOne({ key: roleKey });
  if (!role) throw notFound('Role not found');
  await UserRole.updateOne(
    { userId, roleId: role._id },
    { $setOnInsert: { grantedBy, grantedAt: new Date() } },
    { upsert: true },
  );
}

export async function revokeRoleInternal(userId: Types.ObjectId, roleKey: string): Promise<void> {
  const role = await Role.findOne({ key: roleKey });
  if (role) await UserRole.deleteOne({ userId, roleId: role._id });
}
