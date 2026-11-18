import { Schema, model, type HydratedDocument, type Types } from 'mongoose';
import {
  ANIMAL_ORIGINS,
  ANIMAL_SEXES,
  ANIMAL_STATUSES,
  MEDIA_KINDS,
  type AnimalOriginKind,
  type AnimalSex,
  type AnimalStatus,
  type MediaKind,
} from '@farmplus/shared-types';

export interface AnimalMediaAttrs {
  _id: Types.ObjectId;
  kind: MediaKind;
  url: string;
  mimeType?: string | null;
  caption?: string | null;
  uploadedBy: Types.ObjectId;
  uploadedAt: Date;
}

export interface AnimalAttrs {
  _id: Types.ObjectId;
  farmId: Types.ObjectId;
  animalCode: string;
  animalTypeId: Types.ObjectId;
  breed?: string | null;
  name?: string | null;
  sex: AnimalSex;
  birthDate?: Date | null;
  birthDateEstimated: boolean;
  acquisitionDate?: Date | null;
  origin: { kind: AnimalOriginKind; note?: string | null };
  currentStatus: AnimalStatus;
  sireId?: Types.ObjectId | null;
  damId?: Types.ObjectId | null;
  media: AnimalMediaAttrs[];
  color?: string | null;
  notes?: string | null;
  archivedAt?: Date | null;
  archivedBy?: Types.ObjectId | null;
  archiveReason?: string | null;
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const schema = new Schema<AnimalAttrs>(
  {
    farmId: { type: Schema.Types.ObjectId, required: true, ref: 'Farm' },
    animalCode: { type: String, required: true, trim: true },
    animalTypeId: { type: Schema.Types.ObjectId, required: true, ref: 'AnimalType' },
    breed: { type: String, default: null },
    name: { type: String, default: null },
    sex: { type: String, enum: ANIMAL_SEXES, required: true },
    birthDate: { type: Date, default: null },
    birthDateEstimated: { type: Boolean, default: false },
    acquisitionDate: { type: Date, default: null },
    origin: {
      kind: { type: String, enum: ANIMAL_ORIGINS, default: 'born_on_farm' },
      note: { type: String, default: null },
    },
    currentStatus: { type: String, enum: ANIMAL_STATUSES, default: 'active' },
    sireId: { type: Schema.Types.ObjectId, default: null, ref: 'Animal' },
    damId: { type: Schema.Types.ObjectId, default: null, ref: 'Animal' },
    media: {
      type: [
        {
          kind: { type: String, enum: MEDIA_KINDS, required: true },
          url: { type: String, required: true },
          mimeType: { type: String, default: null },
          caption: { type: String, default: null },
          uploadedBy: { type: Schema.Types.ObjectId, required: true },
          uploadedAt: { type: Date, default: Date.now },
        },
      ],
      default: [],
    },
    color: { type: String, default: null },
    notes: { type: String, default: null },
    archivedAt: { type: Date, default: null },
    archivedBy: { type: Schema.Types.ObjectId, default: null },
    archiveReason: { type: String, default: null },
    createdBy: { type: Schema.Types.ObjectId, required: true },
  },
  { timestamps: true, collection: 'animals' },
);

/**
 * Identity: `animalCode` is unique WITHIN a farm, case-insensitively ("a-1" and "A-1" are the same animal tag),
 * and stays reserved after archiving so a retired tag is never reused for a different animal.
 */
schema.index(
  { farmId: 1, animalCode: 1 },
  { unique: true, collation: { locale: 'en', strength: 2 } },
);
schema.index({ farmId: 1, archivedAt: 1, currentStatus: 1 });
schema.index({ farmId: 1, animalTypeId: 1 });
schema.index({ farmId: 1, createdAt: -1 });
// The animal list's default order. It must carry the list query's collation, or MongoDB cannot use it for the sort.
schema.index(
  { farmId: 1, archivedAt: 1, createdAt: -1, _id: 1 },
  { collation: { locale: 'en', strength: 2, numericOrdering: true } },
);
schema.index({ sireId: 1 });
schema.index({ damId: 1 });

export type AnimalDoc = HydratedDocument<AnimalAttrs>;
export const Animal = model<AnimalAttrs>('Animal', schema);
