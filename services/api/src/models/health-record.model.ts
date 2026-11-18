import { Schema, model, type HydratedDocument, type Types } from 'mongoose';
import {
  HEALTH_OUTCOMES,
  HEALTH_SEVERITIES,
  HEALTH_TYPES,
  PRESCRIBED_BY,
  STATED_BY,
  type HealthType,
} from '@farmplus/shared-types';
import { recordBaseDefinition, type RecordBaseAttrs } from './record-base';

export interface HealthRecordAttrs extends RecordBaseAttrs {
  animalId: Types.ObjectId;
  type: HealthType;
  recordedOn: Date;
  title: string;
  symptoms?: string | null;
  condition?: string | null;
  conditionStatedBy?: (typeof STATED_BY)[number] | null;
  severity?: (typeof HEALTH_SEVERITIES)[number] | null;
  medication?: {
    name: string;
    dosage?: string | null;
    route?: string | null;
    batchNumber?: string | null;
  } | null;
  prescribedBy?: (typeof PRESCRIBED_BY)[number] | null;
  veterinarian?: { name: string; licenseNo?: string | null; clinic?: string | null } | null;
  withdrawalEndsOn?: Date | null;
  vaccine?: { name: string; batchNumber?: string | null; manufacturer?: string | null } | null;
  nextDueOn?: Date | null;
  relatedRecordId?: Types.ObjectId | null;
  outcome?: (typeof HEALTH_OUTCOMES)[number] | null;
  notes?: string | null;
}

const schema = new Schema<HealthRecordAttrs>(
  {
    ...recordBaseDefinition,
    animalId: { type: Schema.Types.ObjectId, required: true, ref: 'Animal' },
    type: { type: String, enum: HEALTH_TYPES, required: true },
    recordedOn: { type: Date, required: true },
    title: { type: String, required: true },
    symptoms: { type: String, default: null },
    condition: { type: String, default: null },
    conditionStatedBy: { type: String, enum: [...STATED_BY, null], default: null },
    severity: { type: String, enum: [...HEALTH_SEVERITIES, null], default: null },
    medication: { type: Schema.Types.Mixed, default: null },
    prescribedBy: { type: String, enum: [...PRESCRIBED_BY, null], default: null },
    veterinarian: { type: Schema.Types.Mixed, default: null },
    withdrawalEndsOn: { type: Date, default: null },
    vaccine: { type: Schema.Types.Mixed, default: null },
    nextDueOn: { type: Date, default: null },
    relatedRecordId: { type: Schema.Types.ObjectId, default: null },
    outcome: { type: String, enum: [...HEALTH_OUTCOMES, null], default: null },
    notes: { type: String, default: null },
  },
  { timestamps: true, collection: 'health_records' },
);
schema.index({ farmId: 1, animalId: 1, recordedOn: -1 });
schema.index({ farmId: 1, type: 1, recordedOn: -1 });
schema.index({ farmId: 1, recordedOn: 1 });
// Default list order (newest first, `_id` tie-break) straight from the index, without an in-memory sort.
schema.index({ farmId: 1, recordedOn: -1, _id: -1 });
export type HealthRecordDoc = HydratedDocument<HealthRecordAttrs>;
export const HealthRecord = model<HealthRecordAttrs>('HealthRecord', schema);
