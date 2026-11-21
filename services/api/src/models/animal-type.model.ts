import { Schema, model, type HydratedDocument, type Types } from 'mongoose';
import {
  ANIMAL_TYPE_STATUSES,
  REPRODUCTION_MODES,
  type AnimalTypeStatus,
  type ReproductionMode,
} from '@farmplus/shared-types';

export interface BreedAttrs {
  key: string;
  name: string;
  nameTh?: string | null;
  active: boolean;
  /** Key of the breed group (`breedGroups[].key`), if grouped. */
  groupKey?: string | null;
  /** Cross-breeds only: the breed GROUP keys it is made of (used to suggest an offspring's breed). */
  composition?: string[] | null;
}

/** A rearing type (e.g. fighting cock) or a breed group: catalogue entries, never deleted, only deactivated. */
export interface CatalogueEntryAttrs {
  key: string;
  name: string;
  nameTh?: string | null;
  active: boolean;
}
export interface BreedGroupAttrs extends CatalogueEntryAttrs {
  rearingTypeKey?: string | null;
}

export interface AnimalTypeAttrs {
  _id: Types.ObjectId;
  key: string;
  name: string;
  nameTh?: string | null;
  status: AnimalTypeStatus;
  breeds: BreedAttrs[];
  /** Missing on documents created before this field: read as `live_birth`. */
  reproduction?: ReproductionMode | null;
  rearingTypes: CatalogueEntryAttrs[];
  breedGroups: BreedGroupAttrs[];
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
          groupKey: { type: String, default: null },
          composition: { type: [String], default: undefined },
        },
      ],
      default: [],
    },
    reproduction: { type: String, enum: [...REPRODUCTION_MODES, null], default: 'live_birth' },
    rearingTypes: {
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
    breedGroups: {
      type: [
        {
          _id: false,
          key: String,
          name: String,
          nameTh: { type: String, default: null },
          active: { type: Boolean, default: true },
          rearingTypeKey: { type: String, default: null },
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
