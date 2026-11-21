import { Schema, model, type HydratedDocument, type Types } from 'mongoose';
import {
  FARM_STATUSES,
  type FarmContact,
  type FarmLocation,
  type FarmStatus,
} from '@farmplus/shared-types';

export interface FarmAttrs {
  _id: Types.ObjectId;
  name: string;
  description?: string | null;
  status: FarmStatus;
  location: FarmLocation;
  contact: FarmContact;
  /** Animal types the farm declares it raises (refs `animal_types`). Informational; animals are not restricted by it. */
  animalTypeIds: Types.ObjectId[];
  createdBy: Types.ObjectId;
  /** Counter used to issue the next generated animal code for this farm (atomic $inc). */
  animalSeq: number;
  /** Counter behind breeding record codes (BR-00001…). */
  breedingSeq?: number;
  archivedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const farmSchema = new Schema<FarmAttrs>(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, default: null },
    status: { type: String, enum: FARM_STATUSES, default: 'active', index: true },
    location: { type: Schema.Types.Mixed, default: {} },
    contact: { type: Schema.Types.Mixed, default: {} },
    animalTypeIds: { type: [{ type: Schema.Types.ObjectId, ref: 'AnimalType' }], default: [] },
    createdBy: { type: Schema.Types.ObjectId, required: true, ref: 'User' },
    animalSeq: { type: Number, default: 0 },
    breedingSeq: { type: Number, default: 0 },
    archivedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: 'farms' },
);
farmSchema.index({ name: 1 });
farmSchema.index({ createdAt: 1 }); // analytics: new farms by date
export type FarmDoc = HydratedDocument<FarmAttrs>;
export const Farm = model<FarmAttrs>('Farm', farmSchema);
