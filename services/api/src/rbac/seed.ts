import { PERMISSION_KEYS, ROLE_KEYS } from '@farmplus/shared-types';
import { Permission, Role, RolePermission } from '../models';
import { PERMISSION_DESCRIPTIONS, ROLE_DEFINITIONS, isMfaRole } from './definitions';

/** Idempotent. Safe to run on every startup. */
export async function syncRbac(): Promise<void> {
  for (const key of PERMISSION_KEYS) {
    await Permission.updateOne(
      { key },
      { $set: { description: PERMISSION_DESCRIPTIONS[key] } },
      { upsert: true },
    );
  }
  const permissions = await Permission.find({ key: { $in: PERMISSION_KEYS } });
  const permissionId = new Map(permissions.map((p) => [p.key, p._id]));

  for (const key of ROLE_KEYS) {
    const def = ROLE_DEFINITIONS[key];
    const existing = await Role.findOne({ key });
    const role =
      existing ??
      (await Role.create({
        key,
        name: def.name,
        description: def.description,
        isSystem: true,
        requiresMfa: isMfaRole(key),
      }));
    if (!existing) {
      await RolePermission.insertMany(
        def.permissions.map((p) => ({ roleId: role._id, permissionId: permissionId.get(p) })),
      );
    } else if (key === 'super_admin') {
      // Newly introduced permissions must reach super_admin automatically.
      for (const id of permissionId.values()) {
        await RolePermission.updateOne(
          { roleId: role._id, permissionId: id },
          {},
          { upsert: true },
        );
      }
    }
  }
}
