import { Schema, model, type HydratedDocument, type Types } from 'mongoose';
import {
  ASSIGNABLE_FARM_ROLES,
  FARM_INVITATION_DIRECTIONS,
  FARM_INVITATION_STATUSES,
  FARM_PERMISSIONS,
  type FarmInvitationDirection,
  type FarmInvitationStatus,
  type FarmPermission,
  type FarmRole,
} from '@farmplus/shared-types';

/**
 * One invitation (owner → user) or join request (user → farm). Kept forever as the history of who was let in, by
 * whom and when; the membership itself lives in `farm_members` and only exists while the invitation is APPROVED.
 */
export interface FarmInvitationAttrs {
  _id: Types.ObjectId;
  farmId: Types.ObjectId;
  /** The person who would become a member. */
  userId: Types.ObjectId;
  direction: FarmInvitationDirection;
  status: FarmInvitationStatus;
  role?: Exclude<FarmRole, 'owner'> | null;
  permissions?: FarmPermission[] | null;
  message?: string | null;
  createdBy: Types.ObjectId;
  decidedBy?: Types.ObjectId | null;
  decidedAt?: Date | null;
  endedBy?: Types.ObjectId | null;
  endedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const schema = new Schema<FarmInvitationAttrs>(
  {
    farmId: { type: Schema.Types.ObjectId, required: true, ref: 'Farm' },
    userId: { type: Schema.Types.ObjectId, required: true, ref: 'User' },
    direction: { type: String, enum: FARM_INVITATION_DIRECTIONS, required: true },
    status: { type: String, enum: FARM_INVITATION_STATUSES, default: 'PENDING' },
    role: { type: String, enum: [...ASSIGNABLE_FARM_ROLES, null], default: null },
    permissions: { type: [{ type: String, enum: FARM_PERMISSIONS }], default: null },
    message: { type: String, default: null },
    createdBy: { type: Schema.Types.ObjectId, required: true },
    decidedBy: { type: Schema.Types.ObjectId, default: null },
    decidedAt: { type: Date, default: null },
    endedBy: { type: Schema.Types.ObjectId, default: null },
    endedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: 'farm_invitations' },
);
/** At most ONE open invitation/request per farm and person, so parallel requests cannot create duplicates. */
schema.index(
  { farmId: 1, userId: 1 },
  { unique: true, partialFilterExpression: { status: 'PENDING' } },
);
schema.index({ farmId: 1, status: 1, createdAt: -1 });
schema.index({ userId: 1, status: 1, createdAt: -1 });
export type FarmInvitationDoc = HydratedDocument<FarmInvitationAttrs>;
export const FarmInvitation = model<FarmInvitationAttrs>('FarmInvitation', schema);
