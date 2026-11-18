import { Schema, model, type Types } from 'mongoose';

export interface RoleAttrs {
  _id: Types.ObjectId;
  key: string;
  name: string;
  description: string;
  isSystem: boolean;
  /** Permissions from this role are only effective in an MFA-verified session. */
  requiresMfa: boolean;
  /** Short lease for serializing concurrent privilege changes; never client controlled. */
  mutationLockToken?: string;
  mutationLockUntil?: Date;
}
const roleSchema = new Schema<RoleAttrs>(
  {
    key: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    description: { type: String, default: '' },
    isSystem: { type: Boolean, default: false },
    requiresMfa: { type: Boolean, default: false },
    mutationLockToken: { type: String, select: false },
    mutationLockUntil: { type: Date, select: false },
  },
  { timestamps: true, collection: 'roles' },
);
export const Role = model<RoleAttrs>('Role', roleSchema);

export interface PermissionAttrs {
  _id: Types.ObjectId;
  key: string;
  description: string;
}
const permissionSchema = new Schema<PermissionAttrs>(
  {
    key: { type: String, required: true, unique: true },
    description: { type: String, default: '' },
  },
  { timestamps: true, collection: 'permissions' },
);
export const Permission = model<PermissionAttrs>('Permission', permissionSchema);

export interface UserRoleAttrs {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  roleId: Types.ObjectId;
  grantedBy: Types.ObjectId | null;
  grantedAt: Date;
}
const userRoleSchema = new Schema<UserRoleAttrs>(
  {
    userId: { type: Schema.Types.ObjectId, required: true, ref: 'User' },
    roleId: { type: Schema.Types.ObjectId, required: true, ref: 'Role' },
    grantedBy: { type: Schema.Types.ObjectId, default: null },
    grantedAt: { type: Date, default: Date.now },
  },
  { collection: 'user_roles' },
);
userRoleSchema.index({ userId: 1, roleId: 1 }, { unique: true });
userRoleSchema.index({ roleId: 1 });
export const UserRole = model<UserRoleAttrs>('UserRole', userRoleSchema);

export interface RolePermissionAttrs {
  _id: Types.ObjectId;
  roleId: Types.ObjectId;
  permissionId: Types.ObjectId;
}
const rolePermissionSchema = new Schema<RolePermissionAttrs>(
  {
    roleId: { type: Schema.Types.ObjectId, required: true, ref: 'Role' },
    permissionId: { type: Schema.Types.ObjectId, required: true, ref: 'Permission' },
  },
  { collection: 'role_permissions' },
);
rolePermissionSchema.index({ roleId: 1, permissionId: 1 }, { unique: true });
export const RolePermission = model<RolePermissionAttrs>('RolePermission', rolePermissionSchema);
