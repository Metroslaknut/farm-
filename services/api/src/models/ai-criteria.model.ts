import { Schema, model, type HydratedDocument, type Types } from 'mongoose';
import type { CriteriaRules } from '@farmplus/shared-types';

/** Per-animal-type readiness rules. FARM+ ships none: an administrator supplies them, with their source. */
export interface AiCriteriaAttrs {
  _id: Types.ObjectId;
  animalTypeKey: string;
  version: number;
  active: boolean;
  rules: CriteriaRules;
  source: string;
  validated: boolean;
  validationReference?: string | null;
  createdBy: Types.ObjectId;
  createdAt: Date;
}

const schema = new Schema<AiCriteriaAttrs>(
  {
    animalTypeKey: { type: String, required: true },
    version: { type: Number, required: true },
    active: { type: Boolean, default: true },
    rules: { type: Schema.Types.Mixed, required: true },
    source: { type: String, required: true },
    validated: { type: Boolean, default: false },
    validationReference: { type: String, default: null },
    createdBy: { type: Schema.Types.ObjectId, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: 'ai_criteria' },
);
// Versions are never edited: a change is a new version, so every assessment can point at exactly what it used.
schema.index({ animalTypeKey: 1, version: 1 }, { unique: true });
schema.index(
  { animalTypeKey: 1 },
  { unique: true, name: 'one_active_per_type', partialFilterExpression: { active: true } },
);

export type AiCriteriaDoc = HydratedDocument<AiCriteriaAttrs>;
export const AiCriteria = model<AiCriteriaAttrs>('AiCriteria', schema);
