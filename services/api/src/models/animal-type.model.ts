import { Schema, model, type HydratedDocument, type Types } from 'mongoose';
import { ANIMAL_TYPE_STATUSES, type AnimalTypeStatus } from '@farmplus/shared-types';

export interface BreedAttrs {
  key: string;
  name: string;
  nameTh?: string | null;
  active: boolean;
}

export interface AnimalTypeAttrs {
  _id: Types.ObjectId;
  key: string;
  name: string;
  nameTh?: string | null;
  status: AnimalTypeStatus;
  breeds: BreedAttrs[];
  /** Optional, administrator-supplied. FARM+ ships no biological values. */
  gestationDays?: number | null;
  minBreedingAgeDays?: number | null;
  maxWeightKg?: number | null;
  /** True for the starter data created at first run; purely informational, fully editable. */
  isSeeded: boolean;
}

const schema = new Schema<AnimalTypeAttrs>(
  {
    key: { type: String, required: true, unique: true },
    name: { type: String, required: true, trim: true },
    nameTh: { type: String, default: null },
    status: { type: String, enum: ANIMAL_TYPE_STATUSES, default: 'active' },
    breeds: {
      type: [
        {
          _id: false,
          key: String,
          name: String,
          nameTh: { type: String, default: null },
          active: { type: Boolean, default: true },
        },
      ],
      default: [],
    },
    gestationDays: { type: Number, default: null },
    minBreedingAgeDays: { type: Number, default: null },
    maxWeightKg: { type: Number, default: null },
    isSeeded: { type: Boolean, default: false },
  },
  { timestamps: true, collection: 'animal_types' },
);
export type AnimalTypeDoc = HydratedDocument<AnimalTypeAttrs>;
export const AnimalType = model<AnimalTypeAttrs>('AnimalType', schema);
