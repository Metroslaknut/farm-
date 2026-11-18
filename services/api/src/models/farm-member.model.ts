import { Schema, model, type Types } from 'mongoose';
import { FARM_ROLES, type FarmRole } from '@farmplus/shared-types';

export interface FarmMemberAttrs {
  _id: Types.ObjectId;
  farmId: Types.ObjectId;
  userId: Types.ObjectId;
  /** Permissions are derived from the role (FARM_ROLE_PERMISSIONS), never stored per member, so they cannot drift. */
  role: FarmRole;
  addedBy: Types.ObjectId | null;
  createdAt: Date;
}

const schema = new Schema<FarmMemberAttrs>(
  {
    farmId: { type: Schema.Types.ObjectId, required: true, ref: 'Farm' },
    userId: { type: Schema.Types.ObjectId, required: true, ref: 'User', index: true },
    role: { type: String, enum: FARM_ROLES, required: true },
    addedBy: { type: Schema.Types.ObjectId, default: null },
    createdAt: { type: Date, default: Date.now },
  },
  { collection: 'farm_members' },
);
schema.index({ farmId: 1, userId: 1 }, { unique: true });
export const FarmMember = model<FarmMemberAttrs>('FarmMember', schema);
