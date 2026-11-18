import { Schema, model, type HydratedDocument, type Types } from 'mongoose';
import {
  BREEDING_METHODS,
  BREEDING_STATUSES,
  OFFSPRING_OUTCOMES,
  ANIMAL_SEXES,
  type AnimalSex,
  type BreedingStatus,
} from '@farmplus/shared-types';
import { recordBaseDefinition, type RecordBaseAttrs } from './record-base';

export interface OffspringAttrs {
  /** Reference to the animal's single identity (Part 07). Never a copy. Absent for stillbirths. */
  animalId?: Types.ObjectId | null;
  outcome: (typeof OFFSPRING_OUTCOMES)[number];
  sex?: AnimalSex | null;
  note?: string | null;
}

export interface BreedingRecordAttrs extends RecordBaseAttrs {
  damId: Types.ObjectId;
  sireId?: Types.ObjectId | null;
  sireExternal?: { name?: string | null; code?: string | null; note?: string | null } | null;
  method: (typeof BREEDING_METHODS)[number];
  breedingDate: Date;
  status: BreedingStatus;
  expectedDeliveryDate?: Date | null;
  pregnancyConfirmedOn?: Date | null;
  failedOn?: Date | null;
  failureReason?: string | null;
  delivery?: { date: Date; notes?: string | null; offspring: OffspringAttrs[] } | null;
  notes?: string | null;
  warnings: string[];
}

const schema = new Schema<BreedingRecordAttrs>(
  {
    ...recordBaseDefinition,
    damId: { type: Schema.Types.ObjectId, required: true, ref: 'Animal' },
    sireId: { type: Schema.Types.ObjectId, default: null, ref: 'Animal' },
    sireExternal: { type: Schema.Types.Mixed, default: null },
    method: { type: String, enum: BREEDING_METHODS, default: 'unknown' },
    breedingDate: { type: Date, required: true },
    status: { type: String, enum: BREEDING_STATUSES, default: 'bred' },
    expectedDeliveryDate: { type: Date, default: null },
    pregnancyConfirmedOn: { type: Date, default: null },
    failedOn: { type: Date, default: null },
    failureReason: { type: String, default: null },
    delivery: {
      type: new Schema(
        {
          date: { type: Date, required: true },
          notes: { type: String, default: null },
          offspring: {
            type: [
              new Schema(
                {
                  animalId: { type: Schema.Types.ObjectId, default: null },
                  outcome: { type: String, enum: OFFSPRING_OUTCOMES, required: true },
                  sex: { type: String, enum: [...ANIMAL_SEXES, null], default: null },
                  note: { type: String, default: null },
                },
                { _id: false },
              ),
            ],
            default: [],
          },
        },
        { _id: false },
      ),
      default: null,
    },
    notes: { type: String, default: null },
    warnings: { type: [String], default: [] },
  },
  { timestamps: true, collection: 'breeding_records' },
);
schema.index({ farmId: 1, damId: 1, breedingDate: -1 });
schema.index({ farmId: 1, sireId: 1, breedingDate: -1 });
schema.index({ farmId: 1, status: 1 });
// Default list order (newest first, `_id` tie-break) straight from the index, without an in-memory sort.
schema.index({ farmId: 1, breedingDate: -1, _id: -1 });
/**
 * An animal can be the offspring of at most ONE live (non-voided) breeding record: no identity is ever
 * attached to two births. Partial index so voiding a record frees its offspring to be re-linked.
 */
schema.index(
  { 'delivery.offspring.animalId': 1 },
  {
    unique: true,
    partialFilterExpression: {
      voided: false,
      'delivery.offspring.animalId': { $type: 'objectId' },
    },
  },
);
export type BreedingRecordDoc = HydratedDocument<BreedingRecordAttrs>;
export const BreedingRecord = model<BreedingRecordAttrs>('BreedingRecord', schema);
