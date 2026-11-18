import { Schema, model, type Types } from 'mongoose';
import {
  REGISTRATION_STATUSES,
  REGISTRATION_TYPES,
  type RegistrationStatus,
  type RegistrationType,
} from '@farmplus/shared-types';

export interface RegistrationAttrs {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  type: RegistrationType;
  status: RegistrationStatus;
  businessName?: string;
  note?: string;
  documents: { kind: string; url: string }[];
  submittedAt: Date;
  review?: { by: Types.ObjectId; at: Date } | null;
  decision?: {
    outcome: 'APPROVED' | 'REJECTED' | 'SUSPENDED';
    by: Types.ObjectId;
    at: Date;
    reason: string;
  } | null;
}

const schema = new Schema<RegistrationAttrs>(
  {
    userId: { type: Schema.Types.ObjectId, required: true, ref: 'User', index: true },
    type: { type: String, enum: REGISTRATION_TYPES, required: true },
    status: {
      type: String,
      enum: REGISTRATION_STATUSES,
      required: true,
      default: 'PENDING',
      index: true,
    },
    businessName: { type: String },
    note: { type: String },
    documents: { type: [{ _id: false, kind: String, url: String }], default: [] },
    submittedAt: { type: Date, default: Date.now, index: true },
    review: { type: { _id: false, by: Schema.Types.ObjectId, at: Date }, default: null },
    decision: {
      type: { _id: false, outcome: String, by: Schema.Types.ObjectId, at: Date, reason: String },
      default: null,
    },
  },
  { collection: 'registrations' },
);
// One live application per user and type; a rejected one can be resubmitted.
schema.index(
  { userId: 1, type: 1 },
  {
    unique: true,
    partialFilterExpression: {
      status: { $in: ['PENDING', 'UNDER_REVIEW', 'APPROVED', 'SUSPENDED'] },
    },
  },
);
export const Registration = model<RegistrationAttrs>('Registration', schema);
