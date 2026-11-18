import { Schema, model, type HydratedDocument, type Types } from 'mongoose';
import { WEIGH_METHODS } from '@farmplus/shared-types';
import { recordBaseDefinition, type RecordBaseAttrs } from './record-base';

export interface WeightRecordAttrs extends RecordBaseAttrs {
  animalId: Types.ObjectId;
  weighedOn: Date;
  weightKg: number;
  method: (typeof WEIGH_METHODS)[number];
  heightCm?: number | null;
  lengthCm?: number | null;
  bodyCondition?: string | null;
  notes?: string | null;
}

const schema = new Schema<WeightRecordAttrs>(
  {
    ...recordBaseDefinition,
    animalId: { type: Schema.Types.ObjectId, required: true, ref: 'Animal' },
    weighedOn: { type: Date, required: true },
    weightKg: { type: Number, required: true },
    method: { type: String, enum: WEIGH_METHODS, default: 'scale' },
    heightCm: { type: Number, default: null },
    lengthCm: { type: Number, default: null },
    bodyCondition: { type: String, default: null },
    notes: { type: String, default: null },
  },
  { timestamps: true, collection: 'weight_records' },
);
schema.index({ farmId: 1, animalId: 1, weighedOn: 1 });
schema.index({ farmId: 1, weighedOn: 1 });
// Default list order (newest first, `_id` tie-break) straight from the index, without an in-memory sort.
schema.index({ farmId: 1, weighedOn: -1, _id: -1 });
export type WeightRecordDoc = HydratedDocument<WeightRecordAttrs>;
export const WeightRecord = model<WeightRecordAttrs>('WeightRecord', schema);
