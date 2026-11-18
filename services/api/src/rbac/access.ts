import type { Types } from 'mongoose';
import { Permission, Role, RolePermission, UserRole } from '../models';

export interface Access {
  roleKeys: string[];
  /** Effective permissions for this session. */
  permissions: Set<string>;
  /** Permissions held through MFA-protected roles but withheld because the session is not MFA-verified. */
  withheld: Set<string>;
}

export async function resolveAccess(
  userId: Types.ObjectId | string,
  mfaVerified: boolean,
): Promise<Access> {
  return (await loadAccess(userId))(mfaVerified);
}

/**
 * Reads the user's roles and their permissions (3 round trips: roles and role-permissions are fetched together),
 * and returns the evaluation for a given MFA state, so callers can load it before the session is known.
 */
export async function loadAccess(
  userId: Types.ObjectId | string,
): Promise<(mfaVerified: boolean) => Access> {
  const roleIds = (await UserRole.find({ userId }).select('roleId').lean()).map((l) => l.roleId);
  const [roles, rolePerms] = await Promise.all([
    Role.find({ _id: { $in: roleIds } })
      .select('key requiresMfa')
      .lean(),
    RolePermission.find({ roleId: { $in: roleIds } })
      .select('roleId permissionId')
      .lean(),
  ]);
  const perms = await Permission.find({ _id: { $in: rolePerms.map((rp) => rp.permissionId) } })
    .select('key')
    .lean();
  const permKey = new Map(perms.map((p) => [String(p._id), p.key]));
  const keysOfRole = new Map<string, string[]>();
  for (const rp of rolePerms) {
    const key = permKey.get(String(rp.permissionId));
    if (!key) continue;
    const list = keysOfRole.get(String(rp.roleId)) ?? [];
    list.push(key);
    keysOfRole.set(String(rp.roleId), list);
  }

  return (mfaVerified) => {
    const permissions = new Set<string>();
    const withheld = new Set<string>();
    for (const role of roles) {
      const target = role.requiresMfa && !mfaVerified ? withheld : permissions;
      for (const key of keysOfRole.get(String(role._id)) ?? []) target.add(key);
    }
    for (const key of permissions) withheld.delete(key);
    return { roleKeys: roles.map((r) => r.key), permissions, withheld };
  };
}

export const isSubset = (subset: Iterable<string>, superset: Set<string>): boolean =>
  [...subset].every((item) => superset.has(item));

export async function permissionKeysOfRole(roleId: Types.ObjectId): Promise<string[]> {
  const rolePerms = await RolePermission.find({ roleId });
  const perms = await Permission.find({ _id: { $in: rolePerms.map((rp) => rp.permissionId) } });
  return perms.map((p) => p.key).sort();
}
