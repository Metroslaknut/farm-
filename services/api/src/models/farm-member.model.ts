import { Schema, model, type Types } from 'mongoose';
import {
  FARM_PERMISSIONS,
  FARM_ROLES,
  type FarmPermission,
  type FarmRole,
} from '@farmplus/shared-types';

export interface FarmMemberAttrs {
  _id: Types.ObjectId;
  farmId: Types.ObjectId;
  userId: Types.ObjectId;
  /** The role's permissions (FARM_ROLE_PERMISSIONS) are the ceiling. */
  role: FarmRole;
  /**
   * Optional owner-chosen narrowing of the role's permissions. `null` (every membership created before this field
   * existed) means "the role's defaults", so older documents need no migration. Always intersected with the role at
   * read time (`effectiveFarmPermissions`), so a stored value can never widen access.
   */
  permissions?: FarmPermission[] | null;
  /** The invitation / join request that created this membership (absent for older and directly added members). */
  invitationId?: Types.ObjectId | null;
  invitedAt?: Date | null;
  approvedAt?: Date | null;
  addedBy: Types.ObjectId | null;
  createdAt: Date;
}

const schema = new Schema<FarmMemberAttrs>(
  {
    farmId: { type: Schema.Types.ObjectId, required: true, ref: 'Farm' },
    userId: { type: Schema.Types.ObjectId, required: true, ref: 'User', index: true },
    role: { type: String, enum: FARM_ROLES, required: true },
    permissions: { type: [{ type: String, enum: FARM_PERMISSIONS }], default: null },
    invitationId: { type: Schema.Types.ObjectId, default: null },
    invitedAt: { type: Date, default: null },
    approvedAt: { type: Date, default: null },
    addedBy: { type: Schema.Types.ObjectId, default: null },
    createdAt: { type: Date, default: Date.now },
  },
  { collection: 'farm_members' },
);
schema.index({ farmId: 1, userId: 1 }, { unique: true });
export const FarmMember = model<FarmMemberAttrs>('FarmMember', schema);
