import { Schema, model, type HydratedDocument, type Types } from 'mongoose';
import {
  GROWTH_SOURCE_KINDS,
  GROWTH_STANDARD_KINDS,
  GROWTH_STANDARD_SEXES,
  type GrowthSourceKind,
  type GrowthStandardKind,
  type GrowthStandardSex,
} from '@farmplus/shared-types';

/**
 * Admin-managed growth criteria (weight/height/length for an age range, or a breeding/sale age window) per animal type,
 * optional breed and sex. Never deleted: a criterion is deactivated, so past comparisons stay explainable.
 */
export interface GrowthStandardAttrs {
  _id: Types.ObjectId;
  animalTypeId: Types.ObjectId;
  breed: string | null;
  sex: GrowthStandardSex;
  kind: GrowthStandardKind;
  ageFromDays: number;
  ageToDays: number;
  minWeightKg: number | null;
  maxWeightKg: number | null;
  minHeightCm: number | null;
  maxHeightCm: number | null;
  minLengthCm: number | null;
  maxLengthCm: number | null;
  source: { kind: GrowthSourceKind; citation?: string | null; note?: string | null };
  active: boolean;
  createdBy: Types.ObjectId;
  updatedBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const bound = { type: Number, default: null };
const schema = new Schema<GrowthStandardAttrs>(
  {
    animalTypeId: { type: Schema.Types.ObjectId, required: true, ref: 'AnimalType' },
    breed: { type: String, default: null },
    sex: { type: String, enum: GROWTH_STANDARD_SEXES, default: 'any' },
    kind: { type: String, enum: GROWTH_STANDARD_KINDS, required: true },
    ageFromDays: { type: Number, required: true },
    ageToDays: { type: Number, required: true },
    minWeightKg: bound,
    maxWeightKg: bound,
    minHeightCm: bound,
    maxHeightCm: bound,
    minLengthCm: bound,
    maxLengthCm: bound,
    source: {
      kind: { type: String, enum: GROWTH_SOURCE_KINDS, required: true },
      citation: { type: String, default: null },
      note: { type: String, default: null },
    },
    active: { type: Boolean, default: true },
    createdBy: { type: Schema.Types.ObjectId, required: true },
    updatedBy: { type: Schema.Types.ObjectId, required: true },
  },
  { timestamps: true, collection: 'animal_growth_standards' },
);
// Lookup by type when evaluating an animal; overlap checks narrow further in code.
schema.index({ animalTypeId: 1, kind: 1, active: 1, ageFromDays: 1 });
export type GrowthStandardDoc = HydratedDocument<GrowthStandardAttrs>;
export const GrowthStandard = model<GrowthStandardAttrs>('GrowthStandard', schema);
